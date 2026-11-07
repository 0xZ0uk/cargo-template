import type { FakeResponseStep } from "@tanstack/ai/testing";
import { describe, expect, it, vi } from "vitest";
import type { AssistantAuditEvent } from "../../src/audit";
import type { TurnSettings } from "../../src/conversations/types";
import { utcDay } from "../../src/usage";
import { backend, bindings, newId, readEvents, turn, type SseEvent } from "./helpers";
import { ADMIN_ORIGIN, USER } from "./worker";

/**
 * Budgets, the audit log and redaction (#68) in the Durable Objects: the real turn in the
 * conversation object (a `fakeText()` model that reports a cost), usage counted in the user's
 * index object, the conversation's total on its index entry, a spy audit sink in the object.
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
  // As the endpoint's `UserReader` resolves it from the config (`redactionPolicyOf`).
  redaction: {
    paths: { users: ["email", "sessions"] },
    relations: {
      authored: [
        { path: "author", relationTo: "users" },
        { path: "createdBy", relationTo: ["users"] },
      ],
    },
  },
};

const chatBody = (script: FakeResponseStep[], extra: { message?: string; resume?: unknown[]; tokensPerSecond?: number } = {}) => {
  const { message = "Hello", resume, ...rest } = extra;
  return {
    mode: "chat",
    script,
    messages: resume ? [] : [{ role: "user", content: message, id: newId("msg") }],
    ...(resume ? { resume } : {}),
    settings,
    ...rest,
  } as Record<string, unknown>;
};

const ofType = (events: SseEvent[], type: string) => events.filter((e) => e.data.type === type).map((e) => e.data);
const audited = async () => (await bindings.ASSISTANT_SELF.fetch("https://admin.example/test/audit")).json() as Promise<AssistantAuditEvent[]>;
const index = (user: string) => bindings.ASSISTANT_INDEX.get(bindings.ASSISTANT_INDEX.idFromName(user));

describe("usage in the index object", () => {
  it("each run's cost and tokens: the user's day, the conversation's entry (and the list)", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    expect(await conversations.usage(user, utcDay(), threadId)).toEqual({ day: utcDay(), costUsd: 0, tokens: 0, conversation: null });

    await readEvents(await conversations.startTurn(turn(user, threadId, chatBody([{ text: "Hi." }]))));
    const first = await conversations.usage(user, utcDay(), threadId);
    expect(first.tokens).toBeGreaterThan(0);
    expect(first.costUsd).toBeCloseTo(first.tokens / 1_000_000, 10);
    expect(first.conversation).toEqual({ costUsd: first.costUsd, tokens: first.tokens });

    // A second conversation adds to the day, not to the first conversation.
    const other = newId("thread");
    await readEvents(await conversations.startTurn(turn(user, other, chatBody([{ text: "Again." }]))));
    const day = await conversations.usage(user, utcDay(), threadId);
    expect(day.tokens).toBeGreaterThan(first.tokens);
    expect(day.conversation).toEqual(first.conversation);

    const { entries } = await conversations.list(user);
    expect(entries.find((e) => e.threadId === threadId)?.metadata).toMatchObject({ costUsd: first.costUsd, tokens: first.tokens });
    // Renaming keeps the total.
    expect(await conversations.rename(user, threadId, "Renamed")).toBe(true);
    expect((await conversations.usage(user, utcDay(), threadId)).conversation).toEqual(first.conversation);
    // Another user sees neither.
    expect(await conversations.usage(newId("users"), utcDay(), threadId)).toMatchObject({ costUsd: 0, tokens: 0, conversation: null });
  });

  it("is recorded when the viewer disconnected mid-run", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const response = await conversations.startTurn(turn(user, threadId, chatBody([{ text: "word ".repeat(200) }], { tokensPerSecond: 400 })));
    await readEvents(response, 2); // then cancel: the tab closed
    expect((await conversations.usage(user, utcDay())).tokens).toBe(0); // still running
    await vi.waitFor(async () => expect((await conversations.usage(user, utcDay(), threadId)).conversation?.tokens).toBeGreaterThan(0), {
      timeout: 10_000,
      interval: 100,
    });
  });

  it("counts by UTC day, atomically, and prunes old days", async () => {
    const user = newId("users");
    const stub = index(user);
    await Promise.all(Array.from({ length: 20 }, () => stub.addUsage(user, undefined, "2031-03-04", { costUsd: 0.25, tokens: 10 })));
    await stub.addUsage(user, undefined, "2031-03-05", { costUsd: 1, tokens: 1 });
    expect(await stub.usage(user, "2031-03-04")).toEqual({ day: "2031-03-04", costUsd: 5, tokens: 200 });
    expect(await stub.usage(user, "2031-03-05")).toEqual({ day: "2031-03-05", costUsd: 1, tokens: 1 });
    expect(await stub.usage(user, "2031-03-06")).toEqual({ day: "2031-03-06", costUsd: 0, tokens: 0 });
    // 35 days later the old rows are gone.
    await stub.addUsage(user, undefined, "2031-04-20", { costUsd: 0.1, tokens: 1 });
    expect(await stub.usage(user, "2031-03-04")).toMatchObject({ costUsd: 0, tokens: 0 });
  });

  it("a deleted conversation's spend still counts for the day", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    await readEvents(await conversations.startTurn(turn(user, threadId, chatBody([{ text: "Hi." }]))));
    const spent = (await conversations.usage(user, utcDay())).costUsd;
    expect(await conversations.remove(user, threadId)).toBe(true);
    expect(await conversations.usage(user, utcDay(), threadId)).toMatchObject({ costUsd: spent, conversation: null });
  });
});

describe("audit and redaction in the object", () => {
  it("one audit event for an approved write; none for the read or a rejection", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const before = (await audited()).length;
    const pause = async () => {
      const events = await readEvents(
        await conversations.startTurn(
          turn(user, threadId, chatBody([
            { toolCalls: [{ name: "findDocuments", input: {} }] },
            { toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: "1", title: "Audited" } }] },
          ]))
        )
      );
      return ofType(events, "RUN_FINISHED").at(-1)!.outcome.interrupts[0].id as string;
    };
    const decide = async (interruptId: string, approved: boolean) =>
      readEvents(
        await conversations.startTurn(
          turn(user, threadId, chatBody([{ text: "OK." }], { resume: [{ interruptId, status: "resolved", payload: approved ? { approved: true } : { approved: false, payload: { error: "no" } } }] }))
        )
      );

    await decide(await pause(), false);
    expect((await audited()).length).toBe(before);
    await decide(await pause(), true);
    const events = (await audited()).slice(before);
    expect(events).toEqual([
      expect.objectContaining({ userKey: user, tool: "updateDocument", collection: "pages", documentId: "1", conversationId: threadId, model: "fake-model" }),
    ]);
  });

  it("redacted fields never reach the model, the stream, the log or the stored transcript", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    let seen = "";
    const start = turn(user, threadId, chatBody([{ toolCalls: [{ name: "findDocuments", input: { slug: "users" } }] }, { text: "Seen." }]));
    // The fake's second answer can't be a function across the RPC boundary: read what it got from the stored transcript.
    const events = await readEvents(await conversations.startTurn(start));
    seen = JSON.stringify(ofType(events, "TOOL_CALL_RESULT"));
    expect(seen).toContain("Ann");
    expect(seen).not.toContain(USER.email);
    expect(seen).not.toContain("session-secret");

    const transcript = JSON.stringify(await conversations.transcript(user, threadId));
    expect(transcript).toContain("Ann");
    expect(transcript).not.toContain(USER.email);
    expect(transcript).not.toContain("session-secret");

    const replay = await readEvents(
      await conversations.join(user, threadId, new Request(`https://admin.example/api/assistant/chat?runId=${start.runId}`, { headers: { "Last-Event-ID": "-1" } }))
    );
    expect(JSON.stringify(replay.map((e) => e.data))).not.toContain(USER.email);
  });

  it("populated relations (author, createdBy) lose the related collection's fields, in the stream and the transcript", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const events = await readEvents(
      await conversations.startTurn(turn(user, threadId, chatBody([{ toolCalls: [{ name: "findDocuments", input: { slug: "authored" } }] }, { text: "Seen." }])))
    );
    const streamed = JSON.stringify(ofType(events, "TOOL_CALL_RESULT"));
    const transcript = JSON.stringify(await conversations.transcript(user, threadId));
    for (const text of [streamed, transcript]) {
      expect(text).toContain("Authored");
      expect(text).toContain("Ann");
      expect(text).not.toContain(USER.email);
      expect(text).not.toContain("session-secret");
    }
  });

  it("a query on a hidden field is refused before the tool runs", async () => {
    const conversations = backend();
    const [user, threadId] = [newId("users"), newId("thread")];
    const events = await readEvents(
      await conversations.startTurn(
        turn(user, threadId, chatBody([{ toolCalls: [{ name: "findDocuments", input: { slug: "users", where: { email: { like: "ann" } } } }] }, { text: "Refused." }]))
      )
    );
    const streamed = JSON.stringify(ofType(events, "TOOL_CALL_RESULT"));
    expect(streamed).toMatch(/hidden field/);
    expect(streamed).not.toContain("Ann");
  });
});
