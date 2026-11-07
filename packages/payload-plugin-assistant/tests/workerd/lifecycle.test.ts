import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import type { AssistantAuditEvent } from "../../src/audit";
import { runLifecycleSuite } from "../lifecycle/suite";
import { backend, bindings, DAY } from "./helpers";

// The lifecycle over the Durable Object's SQLite (the test Worker's conversation class runs
// `lifecycleTurn` by default). tests/lifecycle.test.ts runs the same suite over process memory.
const TABLES = [
  "assistant_conversation",
  "assistant_runs",
  "assistant_messages",
  "assistant_interrupts",
  "assistant_stream_logs",
  "assistant_stream_entries",
  "assistant_run_ids",
];

runLifecycleSuite("Durable Object", {
  backend: (options = {}) => backend(options.retentionMs ?? 30 * DAY),
  async idle(threadId, ms) {
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(`UPDATE assistant_conversation SET last_active = last_active - ?`, ms);
    });
    await runDurableObjectAlarm(stub);
  },
  async leftovers(threadId) {
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    const left: string[] = [];
    await runInDurableObject(stub, async (_instance, state) => {
      for (const table of TABLES) {
        const exists = state.storage.sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, table).toArray().length > 0;
        if (exists && Number(state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n) > 0) left.push(table);
      }
      if ((await state.storage.getAlarm()) !== null) left.push("alarm");
    });
    return left;
  },
  audited: async () => (await bindings.ASSISTANT_SELF.fetch("https://admin.example/test/audit")).json() as Promise<AssistantAuditEvent[]>,
});
