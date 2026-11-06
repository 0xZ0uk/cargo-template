import type { FakeResponseStep } from "@tanstack/ai/testing";
import { describe, expect, it } from "vitest";
import type { ChatTurnBody, TurnSettings } from "../../src/conversations/types";
import { validateChatBody } from "../../src/server/validate";
import { backend, bindings, newId, readEvents, turn, type SseEvent } from "./helpers";
import { ADMIN_ORIGIN } from "./worker";

/**
 * The real turn (`createTurnRunner`) inside the conversation's Durable Object, as on Workers:
 * stores and stream log in the object's SQLite, tools through `ASSISTANT_SELF` to the stand-in
 * `/api/mcp` as the admin, a scripted `fakeText()` model.
 */
const settings: TurnSettings = {
  model: "fake-model",
  apiKey: "sk-test",
  systemPrompt: "You are the assistant.",
  maxSteps: 5,
  maxContextTokens: 64_000,
  mcpEndpoint: `${ADMIN_ORIGIN}/api/mcp`,
  httpReferer: ADMIN_ORIGIN,
  appTitle: "test",
};

const chatBody = (script: FakeResponseStep[], extra: Partial<ChatTurnBody> & { tokensPerSecond?: number; message?: string } = {}) => {
  const { message = "Hello", ...rest } = extra;
  return {
    mode: "chat",
    script,
    messages: [{ role: "user", content: message, id: newId("msg") }],
    settings,
    ...rest,
  } as Record<string, unknown>;
};

const ofType = (events: SseEvent[], type: string) => events.filter((e) => e.data.type === type).map((e) => e.data);
const textOf = (events: SseEvent[]) => ofType(events, "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("");
const hydrate = async (conversations: ReturnType<typeof backend>, user: string, threadId: string) =>
  (await conversations.hydrate(user, threadId, new Request("https://admin.example/api/assistant/chat"))).json() as Promise<any>;
const titles = async () => (await bindings.ASSISTANT_SELF.fetch("https://admin.example/test/titles")).json() as Promise<Record<string, string>>;
const joinRequest = (runId: string, lastEventId: string) =>
  new Request(`https://admin.example/api/assistant/chat?runId=${encodeURIComponent(runId)}`, { headers: { "Last-Event-ID": lastEventId } });

describe("the chat turn in the Durable Object", () => {
  it("tool call, result, answer; transcript and run stored in the object", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const start = turn(user, threadId, chatBody([
      { toolCalls: [{ name: "findDocuments", input: {} }] },
      // Plain data: the script crosses into the object as JSON.
      { text: "One page: Home." },
    ]));
    const events = await readEvents(await conversations.startTurn(start));
    expect(ofType(events, "TOOL_CALL_RESULT")).toHaveLength(1);
    expect(JSON.stringify(ofType(events, "TOOL_CALL_RESULT")[0])).toContain("Home");
    expect(textOf(events)).toBe("One page: Home.");
    expect(events.at(-1)!.data.type).toBe("RUN_FINISHED");

    const hydrated = await hydrate(conversations, user, threadId);
    expect(hydrated.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(hydrated.runs).toEqual([expect.objectContaining({ runId: start.runId, status: "completed" })]);
    // Someone else sees a new, empty conversation.
    expect(await hydrate(conversations, newId("users"), threadId)).toEqual({ messages: [], activeRun: null, interrupts: null });
  });

  it("approval: pause, approve in a second run → applied; reject → not applied", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const id = crypto.randomUUID();
    const pause = async (title: string) => {
      const events = await readEvents(
        await conversations.startTurn(
          turn(user, threadId, chatBody([{ toolCalls: [{ name: "updateDocument", input: { id, title } }] }, { text: `Set to ${title}.` }], { message: `Rename to ${title}` }))
        )
      );
      const outcome = ofType(events, "RUN_FINISHED").at(-1)!.outcome;
      expect(outcome.type).toBe("interrupt");
      return outcome.interrupts[0];
    };
    const decide = async (interruptId: string, approved: boolean, text: string) =>
      readEvents(
        await conversations.startTurn(
          turn(user, threadId, { ...chatBody([{ text }]), messages: [], resume: [{ interruptId, status: "resolved", payload: { approved } }] })
        )
      );

    const first = await pause("Approved title");
    expect((await titles())[id]).toBeUndefined();
    expect((await hydrate(conversations, user, threadId)).interrupts.pending).toHaveLength(1);
    const approved = await decide(first.id, true, "Done.");
    expect(JSON.stringify(ofType(approved, "TOOL_CALL_RESULT"))).toContain("updated successfully");
    expect((await titles())[id]).toBe("Approved title");

    const second = await pause("Rejected title");
    await decide(second.id, false, "Left it.");
    expect((await titles())[id]).toBe("Approved title");
    expect((await hydrate(conversations, user, threadId)).interrupts).toBeNull();
  });

  it("reject with a reason: nothing written, and the reason is the denied call's result the model reads", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const id = crypto.randomUUID();
    const events = await readEvents(
      await conversations.startTurn(turn(user, threadId, chatBody([{ toolCalls: [{ name: "updateDocument", input: { id, title: "Nope" } }] }], { message: "Rename" })))
    );
    const [pending] = ofType(events, "RUN_FINISHED").at(-1)!.outcome.interrupts;
    // What the endpoint makes of the UI's answer.
    const parsed = validateChatBody({ threadId, resume: [{ interruptId: pending.id, status: "resolved", payload: { approved: false, reason: "Wrong page" } }] }, null);
    if (!parsed.ok) throw new Error(parsed.error);
    const resumed = await readEvents(
      await conversations.startTurn(turn(user, threadId, { ...chatBody([{ text: "OK." }]), messages: [], resume: parsed.value.resume }))
    );
    const result = JSON.stringify(ofType(resumed, "TOOL_CALL_RESULT"));
    expect(result).toContain("The user rejected this change");
    expect(result).toContain("Wrong page");
    expect(textOf(resumed)).toBe("OK.");
    expect((await titles())[id]).toBeUndefined();
  });

  it("disconnect mid-run: the run completes in the object, a rejoin replays the rest", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const answer = "This answer streams slowly enough to close the tab in the middle of it.";
    const start = turn(user, threadId, chatBody([{ text: answer }], { tokensPerSecond: 150 }));
    const first = await readEvents(await conversations.startTurn(start), 3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rest = await readEvents(await conversations.join(user, threadId, joinRequest(start.runId, first.at(-1)!.id!)));
    expect(rest.at(-1)!.data.type).toBe("RUN_FINISHED");
    expect(textOf([...first, ...rest])).toBe(answer);
    expect((await hydrate(conversations, user, threadId)).runs).toEqual([expect.objectContaining({ runId: start.runId, status: "completed" })]);
  });

  it("stop: the run ends with a stopped RUN_ERROR, in the log too", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const start = turn(user, threadId, chatBody([{ text: "word ".repeat(400) }], { tokensPerSecond: 100 }));
    const reading = readEvents(await conversations.startTurn(start));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await conversations.stop(newId("users"), threadId, start.runId)).toBe(false);
    expect(await conversations.stop(user, threadId, start.runId)).toBe(true);
    const events = await reading;
    expect(events.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "stopped" });
    // A rejoin sees the same ending.
    const replay = await readEvents(await conversations.join(user, threadId, joinRequest(start.runId, "-1")));
    expect(replay.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "stopped" });
    const hydrated = await hydrate(conversations, user, threadId);
    expect(hydrated.activeRun).toBeNull();
    expect(hydrated.runs).toEqual([expect.objectContaining({ runId: start.runId, status: "aborted" })]);
    expect(await conversations.stop(user, threadId, start.runId)).toBe(false);
  });

  it("stop during the second model call: one stopped RUN_ERROR, in the log too", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const start = turn(
      user,
      threadId,
      chatBody([{ toolCalls: [{ name: "findDocuments", input: {} }] }, { text: "word ".repeat(400) }], { tokensPerSecond: 100 })
    );
    const reading = readEvents(await conversations.startTurn(start));
    // Wait until the text of step 2 is streaming (after the tool result), then stop.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await conversations.stop(user, threadId, start.runId)).toBe(true);
    const events = await reading;
    expect(ofType(events, "TOOL_CALL_RESULT")).toHaveLength(1);
    expect(textOf(events).length).toBeGreaterThan(0);
    expect(ofType(events, "RUN_ERROR")).toHaveLength(1);
    expect(events.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "stopped" });
    // A rejoin replays the same ending.
    const replay = await readEvents(await conversations.join(user, threadId, joinRequest(start.runId, "-1")));
    expect(ofType(replay, "RUN_ERROR")).toHaveLength(1);
    expect(replay.at(-1)!.data).toMatchObject({ type: "RUN_ERROR", code: "stopped" });
    expect((await hydrate(conversations, user, threadId)).activeRun).toBeNull();
  });
});
