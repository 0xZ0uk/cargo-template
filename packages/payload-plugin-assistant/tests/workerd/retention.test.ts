import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { backend, bindings, DAY, newId } from "./helpers";

/** Pretend the conversation was last active `ms` ago (the alarm compares against the clock). */
async function age(threadId: string, ms: number) {
  const stub = bindings.ASSISTANT_CONVERSATIONS.getByName(threadId);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(`UPDATE assistant_conversation SET last_active = last_active - ?`, ms);
  });
}

// Deleting idle conversations (rows, index entry, alarm) is in the lifecycle suite
// (tests/workerd/lifecycle.test.ts); this is the alarm's re-arming.
describe("retention (Durable Object alarm)", () => {
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
});
