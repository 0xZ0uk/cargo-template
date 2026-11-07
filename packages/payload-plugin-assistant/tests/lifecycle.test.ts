import type { AssistantAuditEvent } from "../src/audit";
import { createMemoryConversationState, memoryConversations } from "../src/conversations/memory";
import { lifecycleTurn } from "./lifecycle/runner";
import { runLifecycleSuite } from "./lifecycle/suite";

// The lifecycle over process memory (Node dev, tests). tests/workerd/lifecycle.test.ts runs the
// same suite over the Durable Object's SQLite.
const state = createMemoryConversationState();
const audited: AssistantAuditEvent[] = [];
const backend = (retentionMs?: number) =>
  memoryConversations({
    state,
    turnRunner: lifecycleTurn,
    audit: (event) => {
      audited.push(event);
    },
    ...(retentionMs !== undefined ? { retentionMs } : {}),
  });

runLifecycleSuite("memory", {
  backend: (options = {}) => backend(options.retentionMs),
  async idle(threadId, ms) {
    // Older by `ms`: move its last activity back rather than the clock, so other threads keep theirs.
    const storage = state.conversations.get(threadId)?.storage;
    const record = storage?.record();
    if (record) storage!.update({ lastActive: record.lastActive - ms });
    await backend().sweep();
  },
  async leftovers(threadId) {
    const entry = state.conversations.get(threadId);
    const left: string[] = [];
    if (entry?.storage.record()) left.push("record");
    if (entry?.conversation.running) left.push("live run");
    return left;
  },
  audited: async () => audited,
});
