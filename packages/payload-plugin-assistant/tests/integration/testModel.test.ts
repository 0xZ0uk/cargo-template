import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@shipment/payload-plugin-mcp";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));

import { assistantPluginWith } from "../../src/plugin";
import { answer } from "../../src/server/testModel";
import { inProcessDispatch } from "../../src/tools/inProcess";
import { isLoopbackRequest } from "../../src/utils/testModel";
import { ofType, readEvents, textOf } from "../sse";

/**
 * `testModel: true` with no API key: real turns through Payload's router with the default turn
 * runner (no `createAdapter` seam), so the scripted model is what the app gets. Only requests to
 * a loopback host may use it.
 */
const KEY = "assistant-test-model";
const LOCAL = "http://localhost:3000";
const REMOTE = "https://cms.example.com";
const MODELS = [{ id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek" }];

let tmpDir: string;
let app: { payload: Payload; config: SanitizedConfig };
let cookie: string;
let pageId: number | string;

const call = (method: string, path: string, body?: unknown, origin = LOCAL) =>
  handleEndpoints({
    config: app.config,
    payloadInstanceCacheKey: KEY,
    path: `/api${path.split("?")[0]}`,
    request: new Request(`${origin}/api${path}`, {
      method,
      headers: { Origin: origin, Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  });

const send = (threadId: string, message: string) => call("POST", "/assistant/chat", { threadId, message });
const pageTitle = async () =>
  ((await app.payload.findByID({ collection: "pages" as CollectionSlug, id: pageId, draft: true, overrideAccess: true })) as { title?: string })
    .title;
const update = (title: string) =>
  `/tool updateDocument ${JSON.stringify({ slug: "pages", id: String(pageId), draft: true, data: { title } })}`;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-test-model-"));
  const config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "test-model.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, fields: [] },
      { slug: "pages", versions: { drafts: true }, fields: [{ name: "title", type: "text" }] },
    ],
    plugins: [
      mcpPlugin({ collections: { pages: { description: "Website pages." } } }),
      assistantPluginWith(
        { models: MODELS, apiKey: undefined, testModel: true },
        { dispatch: (request) => inProcessDispatch(config, { payloadInstanceCacheKey: KEY })(request) }
      ),
    ],
  });
  app = { config, payload: await getPayload({ config, key: KEY }) };
  await app.payload.create({ collection: "users" as CollectionSlug, data: { email: "e@example.com", password: "pw-123456" } as never, overrideAccess: true });
  const { token } = await app.payload.login({ collection: "users" as never, data: { email: "e@example.com", password: "pw-123456" } });
  cookie = `payload-token=${token}`;
  pageId = (await app.payload.create({ collection: "pages" as CollectionSlug, data: { title: "Draft" } as never, overrideAccess: true })).id;
}, 120_000);

afterAll(async () => {
  await (app?.payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("only for loopback requests", () => {
  it("config: configured with the test model on localhost, not configured elsewhere", async () => {
    expect(await (await call("GET", "/assistant/config")).json()).toMatchObject({ configured: true, testModel: true });
    const remote = await (await call("GET", "/assistant/config", undefined, REMOTE)).json();
    expect(remote.configured).toBe(false);
    expect(remote).not.toHaveProperty("testModel");
  });

  it("a turn from another host still needs the API key: 503", async () => {
    const res = await call("POST", "/assistant/chat", { threadId: `thread-${crypto.randomUUID()}`, message: "hi" }, REMOTE);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("not_configured");
  });

  it("isLoopbackRequest", () => {
    for (const url of ["http://localhost:3000/x", "http://127.0.0.1:8787/", "http://[::1]:3000/", "http://app.localhost/"]) {
      expect(isLoopbackRequest({ url }), url).toBe(true);
    }
    for (const url of ["https://cms.example.com/", "https://localhost.example.com/", "https://x.workers.dev/", undefined]) {
      expect(isLoopbackRequest({ url }), String(url)).toBe(false);
    }
  });
});

describe("the scripted model", () => {
  it("plain text answers", () => {
    expect(answer([{ role: "user", content: "hello" }])).toEqual({ text: 'Test model: you said "hello".' });
    expect(answer([{ role: "user", content: "/tool findDocuments {oops" }]).text).toMatch(/not valid JSON/);
  });

  it("/tool calls a read tool, then answers with its result", async () => {
    const events = await readEvents(
      await send(`thread-${crypto.randomUUID()}`, '/tool findDocuments {"slug":"pages","select":{"title":true},"limit":5,"depth":0}')
    );
    expect(ofType(events, "TOOL_CALL_START")[0]).toMatchObject({ toolCallName: "findDocuments" });
    expect(textOf(events)).toMatch(/^Tool findDocuments finished: [\s\S]*"title":"Draft"/);
    expect(events.at(-1)!.data.type).toBe("RUN_FINISHED");
  });

  it("a write pauses for approval; approved, it is applied", async () => {
    const threadId = `thread-${crypto.randomUUID()}`;
    const events = await readEvents(await send(threadId, update("Approved title")));
    const outcome = ofType(events, "RUN_FINISHED").at(-1)?.outcome;
    expect(outcome?.type).toBe("interrupt");
    expect(await pageTitle()).toBe("Draft");
    const resumed = await readEvents(
      await call("POST", "/assistant/chat", {
        threadId,
        resume: [{ interruptId: outcome.interrupts[0].id, status: "resolved", payload: { approved: true } }],
      })
    );
    expect(textOf(resumed)).toMatch(/^Tool updateDocument finished:/);
    expect(await pageTitle()).toBe("Approved title");
  });

  it("rejected, nothing is written and the model says so", async () => {
    const before = await pageTitle();
    const threadId = `thread-${crypto.randomUUID()}`;
    const events = await readEvents(await send(threadId, update("Rejected title")));
    const [interrupt] = ofType(events, "RUN_FINISHED").at(-1)!.outcome.interrupts;
    const resumed = await readEvents(
      await call("POST", "/assistant/chat", { threadId, resume: [{ interruptId: interrupt.id, status: "resolved", payload: { approved: false } }] })
    );
    expect(textOf(resumed)).toBe("The change was rejected. Nothing was written.");
    expect(await pageTitle()).toBe(before);
  });
});
