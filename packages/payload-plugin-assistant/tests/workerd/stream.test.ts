import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pruneStreamLogs, StreamHub, sqlStreamDurability } from "../../src/do/sqlStream";
import { backend, bindings, newId, readEvents, turn } from "./helpers";

// Rejoins, run ids and delete during a run go through the lifecycle suite
// (tests/workerd/lifecycle.test.ts); these are the SQLite log's own guarantees.
describe("stream durability (Durable Object SQLite)", () => {
  it("a run id stays used after its stream log was pruned (409)", async () => {
    const alice = newId("users");
    const conversations = backend();
    const threadId = newId("thread");
    const start = turn(alice, threadId, { steps: 1, delayMs: 1 });
    await readEvents(await conversations.startTurn(start));
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    await runInDurableObject(stub, async (_instance, state) => {
      const storage = { sql: state.storage.sql, transactionSync: <T>(fn: () => T) => state.storage.transactionSync(fn) };
      // As the hourly prune would, an hour later.
      pruneStreamLogs(storage, 0, Date.now() + 1);
      expect(state.storage.sql.exec(`SELECT COUNT(*) AS n FROM assistant_stream_logs`).one().n).toBe(0);
    });
    expect((await conversations.startTurn(start)).status).toBe(409);
    expect((await conversations.transcript(alice, threadId))?.messages).toHaveLength(2);
  });

  it("caps oversized events before they are stored", async () => {
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(newId("thread"));
    await runInDurableObject(stub, async (_instance, state) => {
      const storage = { sql: state.storage.sql, transactionSync: <T>(fn: () => T) => state.storage.transactionSync(fn) };
      const log = sqlStreamDurability(storage, new StreamHub(), { runId: "big", offset: null, maxChunkBytes: 4096 });
      const huge = "x".repeat(100_000);
      await log.append([{ type: "TOOL_CALL_RESULT", toolCallId: "t", content: huge, timestamp: 1 } as never]);
      await log.close();
      const [stored] = await log.snapshot();
      expect(JSON.stringify(stored!.chunk).length).toBeLessThanOrEqual(4096);
      expect((stored!.chunk as unknown as { content: string }).content).toMatch(/truncated \d+ bytes/);
    });
  });
});

describe("interrupt commitBatch (one SQLite transaction)", () => {
  it("applies every approval or none", async () => {
    const object = bindings.ASSISTANT_CONVERSATIONS.getByName(newId("thread"));
    // `store()` returns `unknown`, which the RPC stub types map to `never`; widen for the test.
    const stub = { store: (name: string, method: string, args: unknown[]) => object.store(name as never, method, args) as Promise<any> };
    const base = { runId: "r", threadId: "t", payload: {} };
    await stub.store("interrupts", "create", [{ ...base, interruptId: "a", requestedAt: 1 }]);
    await stub.store("interrupts", "create", [{ ...base, interruptId: "b", requestedAt: 2 }]);
    const failed = await stub
      .store("interrupts", "commitBatch", [[{ interruptId: "a", status: "resolved", response: { approved: true } }, { interruptId: "missing", status: "cancelled" }]])
      .then(() => null, (error: unknown) => error);
    expect(String(failed)).toMatch(/missing id/);
    expect((await stub.store("interrupts", "listPending", ["t"])).map((i: { interruptId: string }) => i.interruptId)).toEqual(["a", "b"]);
    await stub.store("interrupts", "commitBatch", [[{ interruptId: "a", status: "resolved", response: { approved: true } }, { interruptId: "b", status: "cancelled" }]]);
    expect(await stub.store("interrupts", "listPending", ["t"])).toEqual([]);
    expect(await stub.store("interrupts", "get", ["a"])).toMatchObject({ status: "resolved", response: { approved: true } });
  });
});
