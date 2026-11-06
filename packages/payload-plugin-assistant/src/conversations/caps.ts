import type { ModelMessage } from "@tanstack/ai";
import type { AIPersistence, MessageStore } from "@tanstack/ai-persistence";

/** Size limits for one conversation. Applied before anything is stored. */
export interface ConversationCaps {
  /** Most messages kept in the stored transcript. Older turns are dropped first. Default 400. */
  maxMessages: number;
  /** Most bytes (UTF-8 JSON) of the stored transcript. Older turns are dropped first. Default 1 MiB. */
  maxBytes: number;
  /**
   * Most bytes of one tool result in the transcript. A larger result (a `find` returning whole
   * documents) is cut and marked. Default 16 KiB.
   */
  maxToolResultBytes: number;
  /**
   * Most bytes of one event in the stream log (replayed on reconnect). Larger string fields are
   * cut so a row stays far below SQLite's 2 MB value limit. Default 256 KiB.
   */
  maxStreamChunkBytes: number;
}

export const DEFAULT_CONVERSATION_CAPS: ConversationCaps = {
  maxMessages: 400,
  maxBytes: 1024 * 1024,
  maxToolResultBytes: 16 * 1024,
  maxStreamChunkBytes: 256 * 1024,
};

const encoder = new TextEncoder();
export const byteLength = (text: string): number => encoder.encode(text).length;

/** Marker appended to every cut string, so the model and the UI can tell. */
export const truncationMarker = (droppedBytes: number) => `\n…[truncated ${droppedBytes} bytes]`;

/** Cut `text` to at most `maxBytes` UTF-8 bytes (marker included), on a character boundary. */
export function truncateText(text: string, maxBytes: number): string {
  const total = byteLength(text);
  if (total <= maxBytes) return text;
  const marker = truncationMarker(total - maxBytes);
  const budget = Math.max(0, maxBytes - byteLength(marker));
  // Walk code points so a surrogate pair is never split.
  let used = 0;
  let end = 0;
  for (const char of text) {
    const size = byteLength(char);
    if (used + size > budget) break;
    used += size;
    end += char.length;
  }
  return text.slice(0, end) + truncationMarker(total - used);
}

/**
 * Shrink a JSON value until its serialisation fits `maxBytes`, by repeatedly halving its
 * longest string. Structure and keys are kept. Gives up after a bounded number of rounds and
 * returns the best effort (a value made of many short strings can stay large).
 */
export function capJsonSize<T>(value: T, maxBytes: number): T {
  if (byteLength(JSON.stringify(value) ?? "") <= maxBytes) return value;
  const copy = JSON.parse(JSON.stringify(value)) as T;
  for (let round = 0; round < 32; round++) {
    const size = byteLength(JSON.stringify(copy));
    if (size <= maxBytes) break;
    let longest: { holder: Record<string, unknown> | unknown[]; key: string | number; length: number } | undefined;
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => {
          if (typeof item === "string" && (!longest || item.length > longest.length)) {
            longest = { holder: node, key: index, length: item.length };
          } else visit(item);
        });
      } else if (node && typeof node === "object") {
        for (const [key, item] of Object.entries(node)) {
          if (typeof item === "string" && (!longest || item.length > longest.length)) {
            longest = { holder: node as Record<string, unknown>, key, length: item.length };
          } else visit(item);
        }
      }
    };
    visit(copy);
    if (!longest || longest.length < 64) break;
    const holder = longest.holder as Record<string | number, string>;
    const text = holder[longest.key]!;
    const excess = size - maxBytes;
    holder[longest.key] = truncateText(text, Math.max(64, Math.min(byteLength(text) - excess - 64, byteLength(text) / 2)));
  }
  return copy;
}

/** Cut the content of a tool message (string, or text parts) to `maxBytes`. Other roles pass through. */
export function truncateToolResult(message: ModelMessage, maxBytes: number): ModelMessage {
  if (message.role !== "tool") return message;
  const { content } = message;
  if (typeof content === "string") {
    const cut = truncateText(content, maxBytes);
    return cut === content ? message : { ...message, content: cut };
  }
  if (Array.isArray(content)) {
    let changed = false;
    const parts = content.map((part) => {
      if (part && part.type === "text" && typeof part.content === "string") {
        const cut = truncateText(part.content, maxBytes);
        if (cut !== part.content) {
          changed = true;
          return { ...part, content: cut };
        }
      }
      return part;
    });
    return changed ? { ...message, content: parts } : message;
  }
  return message;
}

/**
 * Apply the caps to a full transcript: cut tool results, then drop the oldest turns until the
 * message and byte limits hold. A turn starts at a user message, so a tool result never loses
 * the assistant tool call it answers (providers reject an orphaned tool message). The newest
 * turn is always kept, even alone over the limit.
 */
export function capTranscript(messages: ModelMessage[], caps: ConversationCaps): ModelMessage[] {
  const cut = messages.map((message) => truncateToolResult(message, caps.maxToolResultBytes));
  const sizes = cut.map((message) => byteLength(JSON.stringify(message)));
  const turnStarts = cut.flatMap((message, index) => (message.role === "user" ? [index] : []));
  let start = 0;
  let bytes = sizes.reduce((sum, size) => sum + size, 0);
  for (const turnStart of turnStarts) {
    if (cut.length - start <= caps.maxMessages && bytes <= caps.maxBytes) break;
    if (turnStart <= start) continue;
    // Drop everything before this turn; the turn itself (and every later one) stays.
    for (let i = start; i < turnStart; i++) bytes -= sizes[i]!;
    start = turnStart;
  }
  return start === 0 ? cut : cut.slice(start);
}

/** Wrap a message store so every `saveThread` stores the capped transcript. */
export function cappedMessageStore(store: MessageStore, caps: ConversationCaps): MessageStore {
  return {
    // Bound: stores may be class instances (`memoryPersistence()`'s are).
    loadThread: store.loadThread.bind(store),
    saveThread: (threadId, messages) => store.saveThread(threadId, capTranscript(messages, caps)),
  };
}

/**
 * The persistence `chat()` gets: the same stores, with the message store capped. The raw
 * stores stay faithful to the contract (the conformance suite runs against them); the caps are
 * a policy on top.
 */
export function withConversationCaps<P extends AIPersistence<{ messages: MessageStore }>>(
  persistence: P,
  caps: Partial<ConversationCaps> = {}
): P {
  const resolved = { ...DEFAULT_CONVERSATION_CAPS, ...caps };
  return {
    ...persistence,
    stores: { ...persistence.stores, messages: cappedMessageStore(persistence.stores.messages, resolved) },
  };
}

/** Validates caps from options: positive integers only. */
export function resolveCaps(caps: Partial<ConversationCaps> | undefined, prefix: string): ConversationCaps {
  const resolved = { ...DEFAULT_CONVERSATION_CAPS, ...caps };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${prefix} "conversations.caps.${key}" must be a positive integer (got ${String(value)}).`);
    }
  }
  return resolved;
}
