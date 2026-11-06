import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { StreamHub, sqlStreamDurability } from "../../src/do/sqlStream";
import { backend, bindings, newId, readEvents, turn } from "./helpers";

const joinRequest = (runId: string, lastEventId: string) =>
  new Request(`https://admin.example/api/assistant/chat?runId=${encodeURIComponent(runId)}`, {
    headers: { "Last-Event-ID": lastEventId },
  });

describe("stream durability (Durable Object SQLite)", () => {
  it("a run outlives its viewer: disconnect mid-run, rejoin with Last-Event-ID, get the rest", async () => {
    const alice = newId("users");
    const conversations = backend();
    const threadId = newId("thread");
    const start = turn(alice, threadId, { steps: 10, delayMs: 50, message: "write me a title" });

    // Read two events, then cancel the body: the tab closed.
    const first = await readEvents(await conversations.startTurn(start), 2);
    expect(first.map((event) => event.data.type)).toEqual(["RUN_STARTED", "TEXT_MESSAGE_CONTENT"]);
    const lastSeen = first.at(-1)!.id!;
    expect(lastSeen).toMatch(/^do1:/);

    // The run keeps going in the object. Rejoin later from the last id we saw.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const rest = await readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, lastSeen)));
    expect(rest[0]!.data).toMatchObject({ type: "TEXT_MESSAGE_CONTENT", delta: "part1 " });
    expect(rest.at(-1)!.data.type).toBe("RUN_FINISHED");
    const deltas = [...first, ...rest].filter((event) => event.data.type === "TEXT_MESSAGE_CONTENT");
    expect(deltas.map((event) => event.data.delta)).toEqual(Array.from({ length: 10 }, (_, i) => `part${i} `));

    // The producer finished on its own and saved the transcript.
    const transcript = await conversations.transcript(alice, threadId);
    expect(transcript?.messages.at(-1)).toMatchObject({ role: "assistant" });
    expect(transcript?.activeRun).toBeNull();

    // A second tab replays the whole finished run from the start.
    const replay = await readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, "-1")));
    expect(replay).toHaveLength(12);
  });

  it("a run id is used once (409), and joining an unknown run is a 404", async () => {
    const alice = newId("users");
    const conversations = backend();
    const threadId = newId("thread");
    const start = turn(alice, threadId, { steps: 1, delayMs: 1 });
    await readEvents(await conversations.startTurn(start));
    expect((await conversations.startTurn(start)).status).toBe(409);
    expect((await conversations.join(alice, threadId, joinRequest("nope", "-1"))).status).toBe(404);
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
