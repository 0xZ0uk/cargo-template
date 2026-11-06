import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { backend, bindings, DAY, newId, readEvents, turn } from "./helpers";

/** Pretend the conversation was last active `ms` ago (the alarm compares against the clock). */
async function age(threadId: string, ms: number) {
  const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(`UPDATE assistant_conversation SET last_active = last_active - ?`, ms);
  });
}

describe("retention (Durable Object alarm)", () => {
  it("deletes a conversation idle past the retention, and its index entry", async () => {
    const alice = newId("users");
    const conversations = backend(30 * DAY);
    const threadId = newId("thread");
    await readEvents(await conversations.startTurn(turn(alice, threadId, { steps: 1, delayMs: 1 })));
    expect((await conversations.transcript(alice, threadId))?.messages).toHaveLength(2);
    expect((await conversations.list(alice)).entries).toHaveLength(1);

    await age(threadId, 31 * DAY);
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await conversations.transcript(alice, threadId)).toBeNull();
    expect((await conversations.list(alice)).entries).toEqual([]);
    expect(await stub.store("messages", "loadThread", [threadId])).toEqual([]);
    expect(await stub.store("runs", "listByThread", [threadId])).toEqual([]);
    // Nothing left to schedule.
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("keeps a conversation that is not idle long enough, and re-arms for its deadline", async () => {
    const alice = newId("users");
    const conversations = backend(30 * DAY);
    const threadId = newId("thread");
    await conversations.claim(alice, threadId);
    await age(threadId, 29 * DAY);
    const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await conversations.transcript(alice, threadId)).not.toBeNull();
    expect((await conversations.list(alice)).entries).toHaveLength(1);
    expect(await runDurableObjectAlarm(stub)).toBe(true); // re-armed for last_active + 30 days
  });

  it("uses the retention the endpoint passes (configurable per deployment)", async () => {
    const alice = newId("users");
    const conversations = backend(7 * DAY);
    const threadId = newId("thread");
    await conversations.claim(alice, threadId);
    await age(threadId, 8 * DAY);
    expect(await runDurableObjectAlarm(bindings.ASSISTANT_CONVERSATIONS.getByName(threadId))).toBe(true);
    expect(await conversations.transcript(alice, threadId)).toBeNull();
  });
});
