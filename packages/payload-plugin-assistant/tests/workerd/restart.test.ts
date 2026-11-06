import { abortAllDurableObjects } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { backend, bindings, newId, readEvents, turn } from "./helpers";

const joinRequest = (runId: string, lastEventId: string) =>
  new Request(`https://admin.example/api/assistant/chat?runId=${encodeURIComponent(runId)}`, {
    headers: { "Last-Event-ID": lastEventId },
  });

describe("restart (Durable Object)", () => {
  it("an object restart mid-run seals the log with RUN_ERROR and fails the run, so a rejoin ends", async () => {
    const alice = newId("users");
    const conversations = backend();
    const threadId = newId("thread");
    const start = turn(alice, threadId, { steps: 50, delayMs: 100 });
    const first = await readEvents(await conversations.startTurn(start), 1);
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    // Kill every object (a crash or a deploy restart); storage survives.
    await abortAllDurableObjects();

    const rest = await readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, first[0]!.id!)));
    expect(rest.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "producer_lost" });
    expect(await stub.store("runs", "get", [start.runId])).toMatchObject({ status: "failed", error: { code: "producer_lost" } });
    expect((await conversations.transcript(alice, threadId))?.activeRun).toBeNull();
  });

});
