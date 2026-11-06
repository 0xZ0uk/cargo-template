import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";
import { durableObjectConversations } from "./durableObject";
import { createMemoryConversationState, memoryConversations, type MemoryConversationsOptions } from "./memory";
import type { ConversationBackend } from "./types";

/** The in-memory conversations of this process, shared by every memory backend built below. */
const memoryState = createMemoryConversationState();

/**
 * The conversation backend for the configured storage: the Durable Objects on Workers, or the
 * in-memory backend (Node dev, tests). #63's endpoint calls this per request: the memory backend
 * is rebuilt each call with that call's options (`turnRunner`, `mcpFetch`, retention, caps), over
 * one process-wide set of conversations, so no caller's options stick for the next one.
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
  return memoryConversations({
    ...memory,
    retentionMs: storage.retentionMs,
    caps: storage.caps,
    state: memoryState,
    ...(options.audit ? { audit: options.audit } : {}),
  });
}
