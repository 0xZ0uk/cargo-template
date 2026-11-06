import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@payloadcms/plugin-mcp";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assistantPlugin } from "../../src";

/**
 * Real Payload 4 on in-memory SQLite, next to plugin-mcp (the tool source the assistant will use),
 * with requests going through Payload's own REST handler as the admin panel's do.
 */
let payload: Payload;
let config: SanitizedConfig;
let token: string;

const post = (path: string, init: { auth?: boolean } = {}) =>
  handleEndpoints({
    config,
    request: new Request(`http://localhost:3000/api${path}`, {
      method: "POST",
      headers: init.auth === false ? {} : { Authorization: `JWT ${token}` },
    }),
  });

beforeAll(async () => {
  config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: ":memory:" }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, fields: [] },
      { slug: "pages", fields: [{ name: "title", type: "text" }] },
    ],
    plugins: [
      mcpPlugin({ collections: { pages: { enabled: true } } }),
      assistantPlugin({ models: [{ id: "model/a", label: "A" }], apiKey: "sk-test" }),
    ],
  });
  payload = await getPayload({ config });
  await payload.create({
    collection: "users" as CollectionSlug,
    data: { email: "editor@example.com", password: "test-password" } as never,
    overrideAccess: true,
  });
  token = (
    await payload.login({
      collection: "users" as never,
      data: { email: "editor@example.com", password: "test-password" },
    })
  ).token!;
}, 60_000);

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.();
});

describe("Payload 4 boot", () => {
  it("adds no collections or globals", () => {
    expect(payload.config.collections.map((c) => c.slug).sort()).toEqual(
      expect.arrayContaining(["pages", "users"])
    );
    expect(payload.config.collections.some((c) => /assistant/.test(c.slug))).toBe(false);
    expect(payload.config.globals).toHaveLength(0);
  });

  it("registers the chat endpoint next to plugin-mcp's", () => {
    const endpoints = payload.config.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(endpoints).toContain("post /assistant/chat");
    expect(endpoints).toContain("post /mcp");
  });

  it("registers the admin view with the package's import-map path", () => {
    const view = (payload.config.admin.components.views as Record<string, any>).assistant;
    expect(view.path).toBe("/assistant");
    expect(view.Component).toEqual({
      path: "@cargo/payload-plugin-assistant/admin/AssistantView#AssistantView",
      serverProps: { configured: true },
    });
  });
});

describe("POST /api/assistant/chat", () => {
  it("refuses a visitor who isn't signed in", async () => {
    expect((await post("/assistant/chat", { auth: false })).status).toBe(401);
  });

  it("answers 501 to a signed-in user until the turn is implemented", async () => {
    const res = await post("/assistant/chat");
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "not implemented" });
  });
});

describe("without an API key", () => {
  it("keeps the same endpoint and view, and says not configured", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unkeyed = await buildConfig({
      secret: "test-secret",
      db: sqliteAdapter({ client: { url: ":memory:" }, push: true }),
      admin: { user: "users" },
      collections: [{ slug: "users", auth: true, fields: [] }],
      plugins: [assistantPlugin({ models: [{ id: "model/a", label: "A" }], apiKey: undefined })],
    });
    expect(unkeyed.endpoints.some((e) => e.path === "/assistant/chat" && e.method === "post")).toBe(true);
    const view = (unkeyed.admin.components.views as Record<string, any>).assistant;
    expect(view.Component.path).toBe("@cargo/payload-plugin-assistant/admin/AssistantView#AssistantView");
    expect(view.Component.serverProps).toEqual({ configured: false });
  });
});
