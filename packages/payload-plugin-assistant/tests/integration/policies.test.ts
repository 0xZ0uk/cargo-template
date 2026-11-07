import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@shipment/payload-plugin-mcp";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import type { AnyTextAdapter, ModelMessage } from "@tanstack/ai";
import { fakeText, type FakeResponseStep } from "@tanstack/ai/testing";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));

import type { AssistantAuditEvent } from "../../src/audit";
import type { ApprovalProposal } from "../../src/approvals/types";
import { assistantPluginWith } from "../../src/plugin";
import { withMarkdownRichText } from "../../src/richText/tool";
import { withFakeCost } from "../../src/server/testModel";
import { inProcessDispatch } from "../../src/tools/inProcess";
import type { UsageResponse } from "../../src/usage";
import { ofType, readEvents } from "../sse";

/**
 * Budgets, the audit log and field redaction (#68), end to end in Node: real Payload 4 on SQLite
 * with plugin-mcp, every request through Payload's router with a user's cookie, the in-memory
 * conversation backend, `fakeText()` with a cost of $1 per million tokens as the model, and a spy
 * audit sink. The Durable Object side (usage in the index object, a disconnect) is in
 * `tests/workerd/policies.test.ts`.
 */
const KEY = "assistant-policies";
const ORIGIN = "http://localhost:3000";
/**
 * Room for a few ordinary fake turns (the request's tools and prompt are a few thousand tokens
 * at $1/M); `SPEND` (a 400,000-character answer, ~100,000 tokens) crosses it in one.
 */
const DAILY_COST_USD = 0.05;
const SPEND: FakeResponseStep = { text: "y".repeat(400_000) };
/** Low, so a test can cross it (#116's cap; every policy must still hold under it). */
const MAX_TOOL_CALLS = 3;

let tmpDir: string;
let app: { payload: Payload; config: SanitizedConfig };
let fake = fakeText();
const script = (steps: FakeResponseStep[]) => {
  fake = fakeText();
  fake.setResponses(steps);
};
const audited: AssistantAuditEvent[] = [];

const notReadonly = ({ req }: { req: { user?: { email?: string } | null } }) => Boolean(req.user) && !req.user?.email?.startsWith("readonly");

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-policies-"));
  const config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "policies.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: { useAPIKey: true }, admin: { useAsTitle: "email" }, fields: [{ name: "name", type: "text" }] },
      {
        slug: "pages",
        admin: { useAsTitle: "title" },
        access: { read: () => true, create: notReadonly, update: notReadonly, delete: notReadonly },
        fields: [
          { name: "title", type: "text" },
          { name: "internalNote", type: "text" },
          { name: "body", type: "richText", editor: lexicalEditor() },
          {
            name: "layout",
            type: "blocks",
            blocks: [{ slug: "cta", fields: [{ name: "label", type: "text" }, { name: "trackingId", type: "text" }] }],
          },
        ],
      },
    ],
    plugins: [
      mcpPlugin({
        collections: {
          // Rich text as Markdown in write results too (#116), like the app's collections.
          pages: withMarkdownRichText("pages", { description: "Website pages." }),
          users: { description: "Admin users.", tools: { delete: true } as never },
        },
      }),
      assistantPluginWith(
        {
          models: [{ id: "m", label: "M" }],
          apiKey: "sk-test",
          budget: { dailyCostUsd: DAILY_COST_USD },
          maxToolCalls: MAX_TOOL_CALLS,
          redact: { pages: ["internalNote", "layout.trackingId"] },
          audit: (event) => {
            audited.push(event);
          },
        },
        {
          createAdapter: () => withFakeCost(fake as unknown as AnyTextAdapter),
          dispatch: (request) => inProcessDispatch(config, { payloadInstanceCacheKey: KEY })(request),
        }
      ),
    ],
  });
  app = { config, payload: await getPayload({ config, key: KEY }) };
}, 120_000);

afterAll(async () => {
  await (app?.payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
  audited.length = 0;
});

/** A fresh signed-in user (budgets are per user): their cookie and id. */
async function newUser(prefix = "editor") {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const user = (await app.payload.create({ collection: "users" as CollectionSlug, data: { email, password: "pw-123456", name: "Ed" } as never, overrideAccess: true })) as unknown as { id: number };
  const { token } = await app.payload.login({ collection: "users" as never, data: { email, password: "pw-123456" } });
  return { cookie: `payload-token=${token}`, id: user.id, email };
}

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  handleEndpoints({
    config: app.config,
    payloadInstanceCacheKey: KEY,
    path: `/api${path.split("?")[0]}`,
    request: new Request(`${ORIGIN}/api${path}`, {
      method,
      headers: { Origin: ORIGIN, Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  });

const newThread = () => `thread-${crypto.randomUUID()}`;
const send = (cookie: string, threadId: string, message = "Hello") => call(cookie, "POST", "/assistant/chat", { threadId, message });
const usage = async (cookie: string, threadId?: string) =>
  (await (await call(cookie, "GET", `/assistant/usage${threadId ? `?threadId=${threadId}` : ""}`)).json()) as UsageResponse;
const resume = (cookie: string, threadId: string, decisions: Array<{ interruptId: string; payload: unknown }>) =>
  call(cookie, "POST", "/assistant/chat", { threadId, resume: decisions.map((d) => ({ ...d, status: "resolved" })) });

async function pauseOn(cookie: string, threadId: string) {
  const events = await readEvents(await send(cookie, threadId, "Please change it"));
  const outcome = ofType(events, "RUN_FINISHED").at(-1)?.outcome;
  expect(outcome?.type).toBe("interrupt");
  return outcome.interrupts as Array<{ id: string }>;
}

/** A Lexical value with one paragraph. */
const paragraph = (text: string) => ({
  root: {
    type: "root",
    format: "",
    indent: 0,
    version: 1,
    direction: "ltr",
    children: [{ type: "paragraph", format: "", indent: 0, version: 1, direction: "ltr", textFormat: 0, children: [{ type: "text", text, format: 0, detail: 0, mode: "normal", style: "", version: 1 }] }],
  },
});

const newPage = async (data: Record<string, unknown>) =>
  (await app.payload.create({ collection: "pages" as CollectionSlug, data: data as never, overrideAccess: true })) as unknown as { id: number };

/** A page created by a user: Payload 4 sets its `createdBy` / `updatedBy` to them. */
async function newPageBy(userId: number, data: Record<string, unknown>) {
  const user = await app.payload.findByID({ collection: "users" as CollectionSlug, id: userId, overrideAccess: true });
  return (await app.payload.create({ collection: "pages" as CollectionSlug, data: data as never, user: { ...user, collection: "users" } as never, overrideAccess: true })) as unknown as { id: number };
}

describe("budgets", () => {
  it("records each run's cost and tokens, for the day and the conversation", async () => {
    const { cookie } = await newUser();
    const before = await usage(cookie);
    expect(before).toMatchObject({ costUsd: 0, tokens: 0, budget: { dailyCostUsd: DAILY_COST_USD }, exceeded: false });
    expect(before.remaining.costUsd).toBe(DAILY_COST_USD);
    expect(Date.parse(before.resetsAt)).toBeGreaterThan(Date.now());
    expect(before.resetsAt).toMatch(/T00:00:00\.000Z$/);

    const threadId = newThread();
    script([{ text: "Hi there." }]);
    await readEvents(await send(cookie, threadId));
    const after = await usage(cookie, threadId);
    expect(after.tokens).toBeGreaterThan(0);
    expect(after.costUsd).toBeCloseTo(after.tokens / 1_000_000, 10);
    // One conversation so far: its total is the day's.
    expect(after.conversation).toEqual({ costUsd: after.costUsd, tokens: after.tokens });

    const list = (await (await call(cookie, "GET", "/assistant/conversations")).json()) as { conversations: Array<{ threadId: string; costUsd?: number; tokens?: number }> };
    expect(list.conversations.find((c) => c.threadId === threadId)).toMatchObject({ costUsd: after.costUsd, tokens: after.tokens });
  });

  it("refuses a turn with 402 budget_exceeded before calling the model, sends and approvals alike", async () => {
    const { cookie } = await newUser();
    script([SPEND]);
    await readEvents(await send(cookie, newThread()));
    expect((await usage(cookie)).exceeded).toBe(true);

    script([{ text: "Never sent." }]);
    const refused = await send(cookie, newThread());
    expect(refused.status).toBe(402);
    const body = (await refused.json()) as { code: string; error: string; usage: UsageResponse };
    expect(body.code).toBe("budget_exceeded");
    expect(body.error).toMatch(/resets at midnight UTC/);
    expect(body.usage.exceeded).toBe(true);
    expect(body.usage.remaining.costUsd).toBe(0);
    expect(fake.state.callCount).toBe(0);
    // Approving resumes the run, which calls the model too.
    expect((await resume(cookie, newThread(), [{ interruptId: "approval_x", payload: { approved: true } }])).status).toBe(402);
    expect(fake.state.callCount).toBe(0);
  });

  it("over budget, approving a pending change is refused but rejecting it goes through and ends the run", async () => {
    const { cookie } = await newUser();
    const page = await newPage({ title: "Pending" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Changed" } } }] }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    // Another conversation uses up the day while the change waits.
    script([SPEND]);
    await readEvents(await send(cookie, newThread()));
    expect((await usage(cookie)).exceeded).toBe(true);

    // The model tries another write after the rejection: with the day used up, the run gets only
    // its closing model call, so the second call never runs or asks.
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Again" } } }] }, { text: "Never sent." }]);
    const approve = await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]);
    expect(approve.status).toBe(402);
    expect(((await approve.json()) as { code: string }).code).toBe("budget_exceeded");
    expect(fake.state.callCount).toBe(0);

    script([{ text: "OK, I left it as it was." }, { text: "Never sent." }]);
    const reject = await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: false, reason: "Not today." } }]);
    expect(reject.status).toBe(200);
    const events = await readEvents(reject);
    expect(ofType(events, "RUN_FINISHED").at(-1)?.outcome?.type).not.toBe("interrupt");
    // One model call: the closing answer, recorded (the documented overshoot).
    expect(fake.state.callCount).toBe(1);
    expect(audited).toEqual([]);
    const after = (await app.payload.findByID({ collection: "pages" as CollectionSlug, id: page.id, overrideAccess: true })) as unknown as { title: string };
    expect(after.title).toBe("Pending");
    const transcript = await (await call(cookie, "GET", `/assistant/conversations/${threadId}`)).json();
    expect(JSON.stringify(transcript)).toContain("OK, I left it as it was.");
  });

  it("over budget, a rejection gets only the closing model call: a read it asks for doesn't loop back to the model", async () => {
    const { cookie } = await newUser();
    const page = await newPage({ title: "Pending" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Changed" } } }] }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    script([SPEND]);
    await readEvents(await send(cookie, newThread()));

    script([{ toolCalls: [{ name: "findDocuments", input: { slug: "pages", limit: 1, depth: 0 } }] }, { text: "Never sent." }]);
    const events = await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: false } }]));
    // `maxSteps` 1: the read runs, but its result goes to no further model call; the run ends.
    expect(fake.state.callCount).toBe(1);
    expect(ofType(events, "TOOL_CALL_RESULT").map((event) => event.toolCallId)).toHaveLength(2);
    expect(ofType(events, "RUN_FINISHED").at(-1)?.outcome?.type).not.toBe("interrupt");
    expect(ofType(events, "RUN_ERROR")).toEqual([]);
  });

  it("is per user", async () => {
    const spender = await newUser();
    script([SPEND]);
    await readEvents(await send(spender.cookie, newThread()));
    expect((await usage(spender.cookie)).exceeded).toBe(true);
    const other = await newUser();
    script([{ text: "Fine." }]);
    expect((await send(other.cookie, newThread())).status).toBe(200);
  });

  it("resets at midnight UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2031-03-04T23:50:00Z") });
    const { cookie } = await newUser();
    script([SPEND]);
    await readEvents(await send(cookie, newThread()));
    expect((await usage(cookie)).exceeded).toBe(true);
    expect((await usage(cookie)).resetsAt).toBe("2031-03-05T00:00:00.000Z");
    expect((await send(cookie, newThread())).status).toBe(402);

    vi.setSystemTime(new Date("2031-03-05T00:00:01Z"));
    expect(await usage(cookie)).toMatchObject({ day: "2031-03-05", costUsd: 0, exceeded: false });
    script([{ text: "A new day." }]);
    expect((await send(cookie, newThread())).status).toBe(200);
  });

  it("records the usage of a run whose viewer disconnected", async () => {
    const { cookie } = await newUser();
    script([{ text: "a long answer ".repeat(50) }]);
    const response = await send(cookie, newThread());
    await response.body!.cancel(); // closed tab: the run goes on
    await vi.waitFor(async () => expect((await usage(cookie)).tokens).toBeGreaterThan(0), { timeout: 5000 });
  });
});

describe("audit log", () => {
  it("one event per approved write, with who, what and where; none for reads", async () => {
    const { cookie, id } = await newUser();
    const page = await newPage({ title: "Before" });
    const threadId = newThread();
    script([
      { toolCalls: [{ name: "findDocuments", input: { slug: "pages", limit: 1, depth: 0 } }] },
      { toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "After" } } }] },
      { text: "Done." },
    ]);
    // findDocuments runs (a read: no event), then updateDocument pauses for approval.
    const [interrupt] = await pauseOn(cookie, threadId);
    expect(audited).toEqual([]);
    await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    expect(audited).toEqual([
      expect.objectContaining({
        userKey: `users:${id}`,
        userId: String(id),
        tool: "updateDocument",
        collection: "pages",
        documentId: String(page.id),
        conversationId: threadId,
        model: "m",
      }),
    ]);
    // No content in the event.
    expect(JSON.stringify(audited)).not.toContain("After");
  });

  it("a create carries the new document's id", async () => {
    const { cookie } = await newUser();
    const threadId = newThread();
    script([{ toolCalls: [{ name: "createDocuments", input: { slug: "pages", documents: [{ data: { title: "New page" } }] } }] }, { text: "Created." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    expect(audited).toHaveLength(1);
    const created = await app.payload.find({ collection: "pages" as CollectionSlug, where: { title: { equals: "New page" } }, overrideAccess: true });
    expect(audited[0]).toMatchObject({ tool: "createDocuments", collection: "pages", documentId: String(created.docs[0]!.id) });
  });

  it("under the tool-call cap: one event per write that ran, none for the calls past the cap", async () => {
    const { cookie } = await newUser();
    const pages = await Promise.all([1, 2, 3, 4].map((n) => newPage({ title: `Cap ${n}` })));
    const threadId = newThread();
    script([
      { toolCalls: pages.map((page) => ({ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Capped" } } })) },
      { text: "Three of four." },
    ]);
    const interrupts = await pauseOn(cookie, threadId);
    expect(interrupts).toHaveLength(pages.length);
    const events = await readEvents(await resume(cookie, threadId, interrupts.map((i) => ({ interruptId: i.id, payload: { approved: true } }))));
    // MAX_TOOL_CALLS calls ran; the last one failed with the cap's error and sent nothing.
    expect(JSON.stringify(ofType(events, "TOOL_CALL_RESULT"))).toMatch(/tool calls/i);
    expect(audited).toHaveLength(MAX_TOOL_CALLS);
    expect(audited.every((event) => event.tool === "updateDocument" && event.conversationId === threadId)).toBe(true);
    const changed = await app.payload.find({ collection: "pages" as CollectionSlug, where: { title: { equals: "Capped" } }, overrideAccess: true });
    expect(changed.totalDocs).toBe(MAX_TOOL_CALLS);
    expect(new Set(audited.map((event) => event.documentId))).toEqual(new Set(changed.docs.map((doc) => String(doc.id))));
  });

  it("an update by where: one event per changed document, each with its own id", async () => {
    const { cookie } = await newUser();
    const tag = `bulk-${crypto.randomUUID().slice(0, 8)}`;
    const pages = await Promise.all([1, 2, 3].map((n) => newPage({ title: `${tag} ${n}` })));
    await newPage({ title: "Not matched" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", where: { title: { like: tag } }, data: { internalNote: "bulk" } } }] }, { text: "Done." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    expect(audited.map((event) => event.documentId).sort()).toEqual(pages.map((page) => String(page.id)).sort());
    expect(audited.every((event) => event.tool === "updateDocument" && event.collection === "pages" && event.conversationId === threadId)).toBe(true);
  });

  it("a delete by where: one event per deleted document, each with its own id", async () => {
    const { cookie } = await newUser();
    const tag = `gone-${crypto.randomUUID().slice(0, 8)}`;
    const pages = await Promise.all([1, 2].map((n) => newPage({ title: `${tag} ${n}` })));
    const threadId = newThread();
    script([{ toolCalls: [{ name: "deleteDocuments", input: { slug: "pages", where: { title: { like: tag } } } }] }, { text: "Deleted." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    expect(audited.map((event) => event.documentId).sort()).toEqual(pages.map((page) => String(page.id)).sort());
    expect(audited.every((event) => event.tool === "deleteDocuments")).toBe(true);
  });

  it("a create of several documents: one event per created document", async () => {
    const { cookie } = await newUser();
    const tag = `many-${crypto.randomUUID().slice(0, 8)}`;
    const threadId = newThread();
    script([{ toolCalls: [{ name: "createDocuments", input: { slug: "pages", documents: [{ data: { title: `${tag} a` } }, { data: { title: `${tag} b` } }] } }] }, { text: "Created." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    const created = await app.payload.find({ collection: "pages" as CollectionSlug, where: { title: { like: tag } }, overrideAccess: true });
    expect(created.totalDocs).toBe(2);
    expect(audited.map((event) => event.documentId).sort()).toEqual(created.docs.map((doc) => String(doc.id)).sort());
  });

  it("no event for a rejected approval", async () => {
    const { cookie } = await newUser();
    const page = await newPage({ title: "Keep" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "No" } } }] }, { text: "OK." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: false, reason: "No." } }]));
    expect(audited).toEqual([]);
  });

  it("no event for an approved write that failed (access denied at apply time)", async () => {
    const { cookie } = await newUser("readonly");
    const page = await newPage({ title: "Protected" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Hacked" } } }] }, { text: "It failed." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    const events = await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    expect(JSON.stringify(ofType(events, "TOOL_CALL_RESULT"))).toMatch(/error/i);
    expect(audited).toEqual([]);
  });
});

describe("redaction", () => {
  /** The tool results the model was sent, from the fake's requests. */
  const seenByModel: string[] = [];
  const recordTools: FakeResponseStep = ({ request }) => {
    for (const message of request.messages as ModelMessage[]) {
      if (message.role === "tool") seenByModel.push(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
    }
    return { text: "Seen." };
  };

  it("users' email, API key and sessions never reach the model, the stream or the stored transcript", async () => {
    const { cookie, id, email } = await newUser();
    await app.payload.update({ collection: "users" as CollectionSlug, id, data: { enableAPIKey: true, apiKey: "secret-api-key-123" } as never, overrideAccess: true });
    seenByModel.length = 0;
    const threadId = newThread();
    script([
      { toolCalls: [{ name: "findDocuments", input: { slug: "users", where: { id: { equals: id } }, depth: 0 } }] },
      recordTools,
      { toolCalls: [{ name: "findDocuments", input: { slug: "users", id: String(id), depth: 0 } }] },
      recordTools,
    ]);
    const first = await readEvents(await send(cookie, threadId, "Who am I?"));
    const second = await readEvents(await send(cookie, threadId, "And by id?"));

    expect(seenByModel.length).toBeGreaterThanOrEqual(2);
    const all = [...seenByModel, JSON.stringify(ofType([...first, ...second], "TOOL_CALL_RESULT"))].join("\n");
    expect(all).toContain('"name":"Ed"'); // the rest of the document is there
    expect(all).not.toContain(email);
    expect(all).not.toContain("secret-api-key-123");
    expect(all).not.toMatch(/"sessions"|"apiKey"|"enableAPIKey"|"email"/);

    const stored = await (await call(cookie, "GET", `/assistant/conversations/${threadId}`)).text();
    expect(stored).toContain("Ed");
    expect(stored).not.toContain(email);
    expect(stored).not.toMatch(/sessions|secret-api-key/);
  });

  it("the app's paths, through blocks rows", async () => {
    const { cookie } = await newUser();
    const page = await newPage({
      title: "Landing",
      internalNote: "do-not-show-note",
      layout: [{ blockType: "cta", label: "Buy", trackingId: "do-not-show-tracking" }],
    });
    seenByModel.length = 0;
    script([{ toolCalls: [{ name: "findDocuments", input: { slug: "pages", id: String(page.id), depth: 0 } }] }, recordTools]);
    await readEvents(await send(cookie, newThread(), "Show it"));
    const seen = seenByModel.join("\n");
    expect(seen).toContain("Landing");
    expect(seen).toContain("Buy");
    expect(seen).not.toContain("do-not-show");
  });

  it("an updateDocument result with rich text as Markdown (#116) is redacted too", async () => {
    const { cookie } = await newUser();
    const page = await newPage({ title: "Rich", internalNote: "do-not-show-note", body: paragraph("Hello rich world") });
    seenByModel.length = 0;
    const threadId = newThread();
    script([
      { toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Rich 2" }, returning: true, depth: 0 } }] },
      recordTools,
    ]);
    const [interrupt] = await pauseOn(cookie, threadId);
    const events = await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    const streamed = JSON.stringify(ofType(events, "TOOL_CALL_RESULT"));
    const seen = seenByModel.join("\n");
    for (const text of [seen, streamed]) {
      // Converted (the body is Markdown, not Lexical JSON) and redacted.
      expect(text).toContain("Hello rich world");
      expect(text).toContain("Rich 2");
      expect(text).not.toMatch(/\\?"root\\?"/);
      expect(text).not.toContain("do-not-show");
    }
    const stored = await (await call(cookie, "GET", `/assistant/conversations/${threadId}`)).text();
    expect(stored).toContain("Hello rich world");
    expect(stored).not.toContain("do-not-show");
  });

  it("a page's populated createdBy / updatedBy (depth ≥ 1) never shows the user's email", async () => {
    const { cookie, id, email } = await newUser();
    await app.payload.update({ collection: "users" as CollectionSlug, id, data: { enableAPIKey: true, apiKey: "nested-api-key-456" } as never, overrideAccess: true });
    const tag = `authored-${crypto.randomUUID().slice(0, 8)}`;
    const page = await newPageBy(id, { title: tag });
    seenByModel.length = 0;
    const threadId = newThread();
    script([
      // plugin-mcp defaults `depth` to 0, but the model may ask for more: the authorship relations are populated.
      { toolCalls: [{ name: "findDocuments", input: { slug: "pages", id: String(page.id), depth: 1 } }] },
      recordTools,
      { toolCalls: [{ name: "findDocuments", input: { slug: "pages", where: { title: { equals: tag } }, depth: 2 } }] },
      recordTools,
    ]);
    const first = await readEvents(await send(cookie, threadId, "Who made it?"));
    const second = await readEvents(await send(cookie, threadId, "Find it by title"));
    const streamed = JSON.stringify(ofType([...first, ...second], "TOOL_CALL_RESULT"));
    const seen = seenByModel.join("\n");
    for (const text of [seen, streamed]) {
      expect(text).toContain(tag);
      expect(text).toContain("createdBy");
      expect(text).toMatch(/\\?"name\\?":\s*\\?"Ed/); // the populated user is there, without its hidden fields
      expect(text).not.toContain(email);
      expect(text).not.toContain("nested-api-key-456");
      expect(text).not.toMatch(/sessions|apiKeyLast4/);
    }
    const stored = await (await call(cookie, "GET", `/assistant/conversations/${threadId}`)).text();
    expect(stored).toContain(tag);
    expect(stored).not.toContain(email);
    expect(stored).not.toContain("nested-api-key-456");

    // The approval card for a change to that page: its current value's createdBy loses the email too.
    const cardThread = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), data: { title: "Renamed" }, depth: 1 } }] }]);
    await pauseOn(cookie, cardThread);
    const card = await (await call(cookie, "GET", `/assistant/approvals?threadId=${cardThread}`)).text();
    expect(card).toContain(tag);
    expect(card).not.toContain(email);
  });

  it("findDistinct on a hidden field is refused before it runs", async () => {
    const { cookie, email } = await newUser();
    seenByModel.length = 0;
    const threadId = newThread();
    script([{ toolCalls: [{ name: "findDistinct", input: { slug: "users", field: "email" } }] }, recordTools]);
    const events = await readEvents(await send(cookie, threadId, "List every email"));
    const streamed = JSON.stringify(ofType(events, "TOOL_CALL_RESULT"));
    const seen = seenByModel.join("\n");
    for (const text of [seen, streamed]) {
      expect(text).toMatch(/hidden field/);
      expect(text).not.toContain(email);
      expect(text).not.toContain("@example.com");
    }
    const stored = await (await call(cookie, "GET", `/assistant/conversations/${threadId}`)).text();
    expect(stored).not.toContain("@example.com");
  });

  it("findDistinct on a visible field still works", async () => {
    const { cookie } = await newUser();
    seenByModel.length = 0;
    script([{ toolCalls: [{ name: "findDistinct", input: { slug: "users", field: "name" } }] }, recordTools]);
    await readEvents(await send(cookie, newThread(), "Names?"));
    expect(seenByModel.join("\n")).toMatch(/Distinct values for \\?"name/);
    expect(seenByModel.join("\n")).toContain("Ed");
  });

  it("where and sort on a hidden field (also through a relation) are refused; the model can't probe values", async () => {
    const { cookie, id, email } = await newUser();
    await newPageBy(id, { title: "Probe" });
    seenByModel.length = 0;
    script([
      {
        toolCalls: [
          { name: "findDocuments", input: { slug: "users", where: { email: { like: email.slice(0, 10) } }, depth: 0 } },
          { name: "countDocuments", input: { slug: "users", where: { email: { equals: email } } } },
          { name: "findDocuments", input: { slug: "users", sort: "-email", depth: 0 } },
          { name: "findDocuments", input: { slug: "pages", where: { "createdBy.email": { equals: email } }, depth: 0 } },
        ],
      },
      recordTools,
    ]);
    await readEvents(await send(cookie, newThread(), "Is this email registered?"));
    expect(seenByModel).toHaveLength(4);
    for (const result of seenByModel) {
      expect(result).toMatch(/hidden field/);
      expect(result).not.toMatch(/Total|totalDocs|"id"/);
    }
  });

  it("a write by where on a hidden field: the card says it will be refused; approved anyway, it is refused and not audited", async () => {
    const { cookie, email } = await newUser();
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "users", where: { email: { equals: email } }, data: { name: "Changed" } } }] }, { text: "OK." }]);
    const [interrupt] = await pauseOn(cookie, threadId);
    const { approvals } = (await (await call(cookie, "GET", `/assistant/approvals?threadId=${threadId}`)).json()) as { approvals: ApprovalProposal[] };
    expect(approvals[0]!.notice).toMatch(/hidden field “email”/);
    const events = await readEvents(await resume(cookie, threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }]));
    expect(JSON.stringify(ofType(events, "TOOL_CALL_RESULT"))).toMatch(/hidden field/);
    expect(audited).toEqual([]);
    const user = await app.payload.find({ collection: "users" as CollectionSlug, where: { email: { equals: email } }, overrideAccess: true });
    expect((user.docs[0] as unknown as { name: string }).name).toBe("Ed");
  });

  it("approval cards never show a redacted current value", async () => {
    const { cookie } = await newUser();
    const target = await newUser("target");
    const page = await newPage({ title: "Card", internalNote: "do-not-show-note" });
    const threadId = newThread();
    script([
      {
        toolCalls: [
          { name: "deleteDocuments", input: { slug: "users", id: String(target.id) } },
          { name: "deleteDocuments", input: { slug: "pages", id: String(page.id) } },
        ],
      },
    ]);
    await pauseOn(cookie, threadId);
    const res = await call(cookie, "GET", `/assistant/approvals?threadId=${threadId}`);
    const { approvals } = (await res.json()) as { approvals: ApprovalProposal[] };
    expect(approvals).toHaveLength(2);
    const text = JSON.stringify(approvals);
    expect(text).toContain("Card");
    expect(text).toContain('"name"'); // the user's other fields are listed
    expect(text).not.toContain(target.email);
    expect(text).not.toContain("do-not-show-note");
    expect(text).not.toMatch(/"path":"(email|sessions|internalNote)"/);
  });
});
