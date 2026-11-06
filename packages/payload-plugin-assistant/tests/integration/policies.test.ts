import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@payloadcms/plugin-mcp";
import type { AnyTextAdapter, ModelMessage } from "@tanstack/ai";
import { fakeText, type FakeResponseStep } from "@tanstack/ai/testing";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));

import type { AssistantAuditEvent } from "../../src/audit";
import type { ApprovalProposal } from "../../src/approvals/types";
import { assistantPluginWith } from "../../src/plugin";
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
          pages: { description: "Website pages." },
          users: { description: "Admin users.", tools: { delete: true } as never },
        },
      }),
      assistantPluginWith(
        {
          models: [{ id: "m", label: "M" }],
          apiKey: "sk-test",
          budget: { dailyCostUsd: DAILY_COST_USD },
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

const newPage = async (data: Record<string, unknown>) =>
  (await app.payload.create({ collection: "pages" as CollectionSlug, data: data as never, overrideAccess: true })) as unknown as { id: number };

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
    // A resume calls the model too.
    expect((await resume(cookie, newThread(), [{ interruptId: "approval_x", payload: { approved: false } }])).status).toBe(402);
    expect(fake.state.callCount).toBe(0);
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
