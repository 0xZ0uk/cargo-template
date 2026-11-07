import { describe, expect, it, vi } from "vitest";
import type { AssistantAuditEvent } from "../../src/audit";
import type { ConversationBackend, TurnInput } from "../../src/conversations/types";
import { utcDay } from "../../src/usage";
import { readEvents } from "../sse";
import type { LifecycleTurnBody } from "./runner";

/**
 * One storage under the conversation lifecycle, for {@link runLifecycleSuite}: memory in Node
 * (tests/lifecycle.test.ts), the Durable Object under workerd (tests/workerd/lifecycle.test.ts).
 * Its turn runner is `lifecycleTurn` (./runner.ts), and its audit sink records what it gets.
 */
export interface LifecycleHarness {
  /** A backend over this storage, with the endpoint's retention. */
  backend(options?: { retentionMs?: number }): ConversationBackend;
  /** Make the conversation `ms` older, then run retention (the alarm, or the lazy sweep). */
  idle(threadId: string, ms: number): Promise<void>;
  /** What storage still holds of the conversation (rows, the alarm…), as names; `[]` when nothing. */
  leftovers(threadId: string): Promise<string[]>;
  /** The audit events the app's sink received so far. */
  audited(): Promise<AssistantAuditEvent[]>;
}

const DAY = 24 * 60 * 60 * 1000;
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const turn = (userKey: string, threadId: string, body: LifecycleTurnBody = {}): TurnInput => ({
  userKey,
  threadId,
  runId: newId("run"),
  body: body as Record<string, unknown>,
  auth: { cookie: "payload-token=x", origin: "https://admin.example" },
});

const joinRequest = (runId: string, lastEventId: string) =>
  new Request(`https://admin.example/api/assistant/chat?runId=${encodeURIComponent(runId)}`, { headers: { "Last-Event-ID": lastEventId } });

const types = (events: Array<{ data: Record<string, any> }>) => events.map((event) => event.data.type);

/**
 * The conversation lifecycle (`Conversation`, src/conversations/conversation.ts), run against a
 * storage adapter: ownership, turns and rejoins, run ids, stop, delete during a run (the epoch
 * fence), retention, usage and audit. Each test uses its own users and threads (storage is shared
 * between the tests of a file under workerd).
 */
export function runLifecycleSuite(name: string, harness: LifecycleHarness): void {
  describe(`conversation lifecycle: ${name}`, () => {
    it("the first claim wins; another user can neither claim, read, rejoin, start, stop, rename nor delete", async () => {
      const conversations = harness.backend();
      const [alice, mallory, threadId] = [newId("users"), newId("users"), newId("thread")];
      expect(await conversations.claim(alice, threadId)).toEqual({ ok: true, created: true });
      expect(await conversations.claim(alice, threadId)).toEqual({ ok: true, created: false });

      const start = turn(alice, threadId, { steps: 2, delayMs: 1, message: "secret draft" });
      expect(types(await readEvents(await conversations.startTurn(start))).at(-1)).toBe("RUN_FINISHED");
      expect((await conversations.transcript(alice, threadId))?.messages[0]).toMatchObject({ content: "secret draft" });

      expect(await conversations.claim(mallory, threadId)).toEqual({ ok: false });
      expect(await conversations.claim("", threadId)).toEqual({ ok: false });
      expect(await conversations.transcript(mallory, threadId)).toBeNull();
      expect(await (await conversations.hydrate(mallory, threadId, new Request("https://admin.example/x"))).json()).toEqual({
        messages: [],
        activeRun: null,
        interrupts: null,
      });
      expect((await conversations.join(mallory, threadId, joinRequest(start.runId, "-1"))).status).toBe(404);
      expect((await conversations.startTurn(turn(mallory, threadId, { steps: 1 }))).status).toBe(404);
      expect(await conversations.stop(mallory, threadId, start.runId)).toBe(false);
      expect((await conversations.list(mallory)).entries).toEqual([]);
      expect(await conversations.rename(mallory, threadId, "mine now")).toBe(false);
      expect(await conversations.remove(mallory, threadId)).toBe(false);

      // Alice still has everything, and can rejoin her own run.
      expect(types(await readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, "-1")))).at(-1)).toBe("RUN_FINISHED");
      expect((await conversations.list(alice)).entries.map((entry) => entry.threadId)).toEqual([threadId]);
      const hydrated = (await (await conversations.hydrate(alice, threadId, new Request("https://admin.example/x"))).json()) as { messages: unknown[] };
      expect(hydrated.messages).toHaveLength(2);
    });

    it("rename and delete by the owner update the list and drop the data; the id is free again", async () => {
      const conversations = harness.backend();
      const [alice, bob, threadId] = [newId("users"), newId("users"), newId("thread")];
      await readEvents(await conversations.startTurn({ ...turn(alice, threadId, { steps: 1, delayMs: 1 }), title: "First message" }));
      expect((await conversations.list(alice)).entries[0]).toMatchObject({ threadId, title: "First message" });
      expect(await conversations.rename(alice, threadId, "Meta descriptions")).toBe(true);
      expect((await conversations.list(alice, { search: "meta" })).entries[0]).toMatchObject({ threadId, title: "Meta descriptions" });

      expect(await conversations.remove(alice, threadId)).toBe(true);
      expect(await conversations.transcript(alice, threadId)).toBeNull();
      expect(await conversations.rename(alice, threadId, "gone")).toBe(false);
      expect((await conversations.list(alice)).entries).toEqual([]);
      expect(await harness.leftovers(threadId)).toEqual([]);
      // Whoever claims it next starts an empty conversation.
      expect(await conversations.claim(bob, threadId)).toEqual({ ok: true, created: true });
      expect((await conversations.transcript(bob, threadId))?.messages).toEqual([]);
    });

    it("a run outlives its viewer: disconnect mid-run, rejoin from the last event id, get the rest", async () => {
      const conversations = harness.backend();
      const [alice, threadId] = [newId("users"), newId("thread")];
      const start = turn(alice, threadId, { steps: 10, delayMs: 30 });
      const first = await readEvents(await conversations.startTurn(start), 2);
      expect(types(first)).toEqual(["RUN_STARTED", "TEXT_MESSAGE_CONTENT"]);

      await sleep(100);
      // The run id comes from the offset when the request doesn't name it.
      const offsetOnly = new Request("https://admin.example/api/assistant/chat", { headers: { "Last-Event-ID": first.at(-1)!.id! } });
      const rest = await readEvents(await conversations.join(alice, threadId, offsetOnly));
      expect(rest[0]!.data).toMatchObject({ type: "TEXT_MESSAGE_CONTENT", delta: "part1 " });
      expect(rest.at(-1)!.data.type).toBe("RUN_FINISHED");
      const deltas = [...first, ...rest].filter((event) => event.data.type === "TEXT_MESSAGE_CONTENT").map((event) => event.data.delta);
      expect(deltas).toEqual(Array.from({ length: 10 }, (_, i) => `part${i} `));

      const transcript = await conversations.transcript(alice, threadId);
      expect(transcript?.messages.at(-1)).toMatchObject({ role: "assistant" });
      expect(transcript?.activeRun).toBeNull();
      // A second tab replays the whole finished run from the start.
      expect(await readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, "-1")))).toHaveLength(12);
    });

    it("a run id is used once (409); an unknown run is a 404; a rejoin needs an offset (400)", async () => {
      const conversations = harness.backend();
      const [alice, threadId] = [newId("users"), newId("thread")];
      const start = turn(alice, threadId, { steps: 1, delayMs: 1 });
      await readEvents(await conversations.startTurn(start));
      expect((await conversations.startTurn(start)).status).toBe(409);
      expect((await conversations.join(alice, threadId, joinRequest("nope", "-1"))).status).toBe(404);
      const noOffset = new Request(`https://admin.example/api/assistant/chat?runId=${start.runId}`);
      expect((await conversations.join(alice, threadId, noOffset)).status).toBe(400);
      expect((await conversations.startTurn({ ...turn(alice, threadId), runId: "" })).status).toBe(400);
    });

    it("stop: the run ends with a stopped RUN_ERROR, for every viewer; then it isn't live any more", async () => {
      const conversations = harness.backend();
      const [alice, threadId] = [newId("users"), newId("thread")];
      const start = turn(alice, threadId, { steps: 50, delayMs: 20 });
      const response = await conversations.startTurn(start);
      await sleep(60);
      expect(await conversations.stop(alice, threadId, start.runId)).toBe(true);
      const events = await readEvents(response);
      expect(events.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "stopped" });
      const replay = await readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, "-1")));
      expect(replay.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "stopped" });
      await vi.waitFor(async () => expect(await conversations.stop(alice, threadId, start.runId)).toBe(false));
    });

    it("deleting a conversation during a live run: readers end, nothing the run writes later lands, the id is free", async () => {
      const conversations = harness.backend();
      const [alice, threadId] = [newId("users"), newId("thread")];
      const start = turn(alice, threadId, { steps: 20, delayMs: 30, lateUsage: { costUsd: 7, tokens: 70, delayMs: 300 } });
      const first = await readEvents(await conversations.startTurn(start), 2);
      expect(types(first)).toEqual(["RUN_STARTED", "TEXT_MESSAGE_CONTENT"]);
      // A second tab is tailing the live run.
      const joined = readEvents(await conversations.join(alice, threadId, joinRequest(start.runId, first.at(-1)!.id!)));

      expect(await conversations.remove(alice, threadId)).toBe(true);
      // The reader ends instead of waiting on a log that no longer exists.
      await joined;
      // The id is free at once: claim it again before the old run's late usage arrives.
      expect(await conversations.claim(alice, threadId)).toEqual({ ok: true, created: true });
      // Give the killed run time to try to write its last events, rows, activity and usage.
      await sleep(20 * 30 + 200);

      expect((await conversations.transcript(alice, threadId))?.messages).toEqual([]);
      expect((await conversations.transcript(alice, threadId))?.activeRun).toBeNull();
      // Its spend counts for the day, but not for the new conversation of the same id (fenced).
      const usage = await conversations.usage(alice, utcDay(), threadId);
      expect(usage).toMatchObject({ costUsd: 7, tokens: 70, conversation: null });
      // A fresh run in the new conversation works.
      expect(types(await readEvents(await conversations.startTurn(turn(alice, threadId, { steps: 1, delayMs: 1 })))).at(-1)).toBe("RUN_FINISHED");
      expect((await conversations.transcript(alice, threadId))?.messages).toHaveLength(2);

      expect(await conversations.remove(alice, threadId)).toBe(true);
      expect(await harness.leftovers(threadId)).toEqual([]);
    });

    it("retention: an idle conversation is deleted with its list entry; an active one is kept", async () => {
      const conversations = harness.backend({ retentionMs: 7 * DAY });
      const [alice, idle, active] = [newId("users"), newId("thread"), newId("thread")];
      await readEvents(await conversations.startTurn(turn(alice, idle, { steps: 1, delayMs: 1 })));
      await conversations.claim(alice, active);
      expect((await conversations.list(alice)).entries).toHaveLength(2);

      await harness.idle(idle, 8 * DAY);
      await harness.idle(active, 6 * DAY);
      expect(await conversations.transcript(alice, idle)).toBeNull();
      expect(await conversations.transcript(alice, active)).not.toBeNull();
      expect((await conversations.list(alice)).entries.map((entry) => entry.threadId)).toEqual([active]);
      expect(await harness.leftovers(idle)).toEqual([]);
    });

    it("usage: the user's day and the conversation's total; a rename keeps it; nobody else sees it", async () => {
      const conversations = harness.backend();
      const [alice, mallory, threadId, other] = [newId("users"), newId("users"), newId("thread"), newId("thread")];
      await readEvents(await conversations.startTurn(turn(alice, threadId, { steps: 1, delayMs: 1, usage: { costUsd: 0.5, tokens: 50 } })));
      await readEvents(await conversations.startTurn(turn(alice, other, { steps: 1, delayMs: 1, usage: { costUsd: 0.25, tokens: 25 } })));

      expect(await conversations.usage(alice, utcDay())).toEqual({ day: utcDay(), costUsd: 0.75, tokens: 75 });
      expect((await conversations.usage(alice, utcDay(), threadId)).conversation).toEqual({ costUsd: 0.5, tokens: 50 });
      const { entries } = await conversations.list(alice);
      expect(entries.find((entry) => entry.threadId === threadId)?.metadata).toMatchObject({ costUsd: 0.5, tokens: 50 });
      expect(await conversations.rename(alice, threadId, "Renamed")).toBe(true);
      expect((await conversations.usage(alice, utcDay(), threadId)).conversation).toEqual({ costUsd: 0.5, tokens: 50 });
      expect(await conversations.usage(mallory, utcDay(), threadId)).toMatchObject({ costUsd: 0, tokens: 0, conversation: null });
    });

    it("audit: the run reports applied writes to the app's sink", async () => {
      const conversations = harness.backend();
      const [alice, threadId] = [newId("users"), newId("thread")];
      const start = turn(alice, threadId, { steps: 1, delayMs: 1, audit: true });
      await readEvents(await conversations.startTurn(start));
      const events = (await harness.audited()).filter((event) => event.runId === start.runId);
      expect(events).toEqual([expect.objectContaining({ userKey: alice, conversationId: threadId, tool: "updateDocument", documentId: "1" })]);
    });
  });
}
