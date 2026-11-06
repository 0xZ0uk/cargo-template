import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";
import { durableObjectConversations } from "./durableObject";
import { memoryConversations, type MemoryConversationsOptions } from "./memory";
import type { ConversationBackend } from "./types";

let memoryBackend: ConversationBackend | undefined;

/**
 * The conversation backend for the configured storage: the Durable Objects on Workers, or one
 * process-wide in-memory backend (Node dev, tests). #63's endpoint calls this per request.
 */
export function conversationBackend(
  options: NormalizedAssistantOptions,
  memory: MemoryConversationsOptions = {}
): ConversationBackend {
  const storage = options.conversations;
  if (storage.kind === "durable-object") {
    return durableObjectConversations({
      conversations: storage.namespace,
      index: storage.index,
      retentionMs: storage.retentionMs,
      caps: storage.caps,
    });
  }
  memoryBackend ??= memoryConversations({ ...memory, retentionMs: storage.retentionMs, caps: storage.caps });
  return memoryBackend;
}
