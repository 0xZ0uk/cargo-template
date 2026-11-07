import type React from "react";
import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@cargo/payload-plugin-mcp";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The admin UI packages import CSS, which Node can't load; the view's access gate runs before any of it renders.
vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));
// The chat UI (client entry) is a leaf here: the tests are about the server-side gate around it.
vi.mock("@cargo/payload-plugin-assistant/client", () => ({
  AssistantChat: () => null,
  AssistantNavLinkClient: function AssistantNavLinkClient() {
    return null;
  },
}));

import { assistantPlugin } from "../../src";
import { AssistantNavLink } from "../../src/admin/AssistantNavLink";
import { AssistantView } from "../../src/admin/AssistantView";
import type { AssistantPluginOptions } from "../../src/types/options";

/**
 * Real Payload 4 on in-memory SQLite, next to plugin-mcp (the tool source the assistant will use),
 * with requests going through Payload's own REST handler as the admin panel's do. A second auth
 * collection (`customers`) stands for front-office accounts.
 */
interface Booted {
  payload: Payload;
  config: SanitizedConfig;
  tokens: { editor: string; customer: string };
}

let app: Booted;
let denying: Booted;
let payload: Payload;
let tmpDir: string;

/**
 * `shareWith` boots a second config (another `access`) on the first one's database: the schema
 * is pushed once per process, and the users and their tokens are already there.
 */
const boot = async (
  key: string,
  access?: AssistantPluginOptions["access"],
  shareWith?: Booted
): Promise<Booted> => {
  const config = await buildConfig({
    secret: "test-secret",
    // A file, not `:memory:`, so a second config can share it.
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "assistant.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, fields: [] },
      { slug: "customers", auth: true, fields: [] },
      { slug: "pages", fields: [{ name: "title", type: "text" }] },
    ],
    plugins: [
      mcpPlugin({ collections: { pages: { enabled: true } } }),
      assistantPlugin({ models: [{ id: "model/a", label: "A" }], apiKey: "sk-test", access }),
    ],
  });
  const instance = await getPayload({ config, key });
  if (shareWith) return { payload: instance, config, tokens: shareWith.tokens };
  const login = async (collection: "users" | "customers", email: string) => {
    await instance.create({
      collection: collection as CollectionSlug,
      data: { email, password: "test-password" } as never,
      overrideAccess: true,
    });
    return (
      await instance.login({
        collection: collection as never,
        data: { email, password: "test-password" },
      })
    ).token!;
  };
  return {
    payload: instance,
    config,
    tokens: {
      editor: await login("users", "editor@example.com"),
      customer: await login("customers", "customer@example.com"),
    },
  };
};

const post = (
  target: Booted,
  path: string,
  init: { as?: "editor" | "customer" | null } = {}
) =>
  handleEndpoints({
    config: target.config,
    request: new Request(`http://localhost:3000/api${path}`, {
      method: "POST",
      headers:
        init.as === null ? {} : { Authorization: `JWT ${target.tokens[init.as ?? "editor"]}` },
    }),
  });

/** The signed-in user as `initPageResult.req` would carry it (`collection` is set by Payload). */
const viewResult = async (target: Booted, as: "editor" | "customer" | null) => {
  const { user } = as
    ? await target.payload.auth({
        headers: new Headers({ Authorization: `JWT ${target.tokens[as]}` }),
      })
    : { user: null };
  return { req: { user, payload: target.payload } };
};

/** Renders the view as Payload would; `server.redirect` throws like Next's `redirect()`. */
const renderView = async (target: Booted, as: "editor" | "customer" | null) => {
  const props = (target.config.admin.components.views as Record<string, any>).assistant.Component
    .serverProps;
  const redirect = (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  };
  return AssistantView({
    ...props,
    initPageResult: await viewResult(target, as),
    server: { redirect },
    params: {},
    searchParams: {},
  } as never);
};

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-boot-"));
  app = await boot("assistant-app");
  denying = await boot("assistant-denying", () => false, app);
  ({ payload } = app);
}, 120_000);

afterAll(async () => {
  for (const { payload: p } of [app, denying]) {
    await (p as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
  rmSync(tmpDir, { recursive: true, force: true });
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
      serverProps: { configured: true, access: expect.any(Function) },
    });
  });
});

describe("POST /api/assistant/chat", () => {
  it("refuses a visitor who isn't signed in", async () => {
    expect((await post(app, "/assistant/chat", { as: null })).status).toBe(401);
  });

  it("validates an admin user's body (the turns themselves are in chat.test.ts)", async () => {
    const res = await post(app, "/assistant/chat");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_body" });
  });

  it("refuses a user of another auth collection by default", async () => {
    expect((await post(app, "/assistant/chat", { as: "customer" })).status).toBe(403);
  });

  it("refuses an admin user a custom access denies", async () => {
    // handleEndpoints resolves the cached default instance, so call the denying config's own handler.
    const endpoint = denying.config.endpoints.find((e) => e.path === "/assistant/chat")!;
    const { req } = await viewResult(denying, "editor");
    expect((await endpoint.handler(req as never)).status).toBe(403);
  });
});

describe("the admin view", () => {
  it("sends an anonymous visitor to login", async () => {
    await expect(renderView(app, null)).rejects.toThrow("REDIRECT /admin/login");
  });

  it("sends a user of another auth collection to unauthorized", async () => {
    await expect(renderView(app, "customer")).rejects.toThrow("REDIRECT /admin/unauthorized");
  });

  it("sends an admin user a custom access denies to unauthorized", async () => {
    await expect(renderView(denying, "editor")).rejects.toThrow("REDIRECT /admin/unauthorized");
  });

  it("renders for an admin user the access admits", async () => {
    expect(await renderView(app, "editor")).toBeTruthy();
  });
});

/** Renders the nav link as Payload's DefaultNav does: `payload`, `user`, `i18n`, `locale`, no request. */
const renderNavLink = async (target: Booted, as: "editor" | "customer" | null, access?: AssistantPluginOptions["access"]) => {
  const navLinks = target.config.admin.components.afterNavLinks as unknown as Array<{ path: string; serverProps: any }>;
  const entry = navLinks.find((c) => c.path.includes("AssistantNavLink"))!;
  const { req } = await viewResult(target, as);
  return AssistantNavLink({ ...entry.serverProps, ...(access ? { access } : {}), payload: target.payload, user: req.user } as never);
};

describe("the nav link", () => {
  it("is registered after the existing nav links, with the plugin's access", () => {
    const navLinks = payload.config.admin.components.afterNavLinks as unknown as Array<{ path: string; serverProps: any }>;
    expect(navLinks.at(-1)).toEqual({
      path: "@cargo/payload-plugin-assistant/admin/AssistantNavLink#AssistantNavLink",
      serverProps: { access: expect.any(Function) },
    });
  });

  it("shows for an admin user the access admits", async () => {
    const link = (await renderNavLink(app, "editor")) as React.ReactElement | null;
    expect(link).not.toBeNull();
    expect((link!.type as { name?: string }).name).toBe("AssistantNavLinkClient");
  });

  it("is hidden from a visitor, a user of another auth collection, and a user access denies", async () => {
    expect(await renderNavLink(app, null)).toBeNull();
    expect(await renderNavLink(app, "customer")).toBeNull();
    expect(await renderNavLink(denying, "editor")).toBeNull();
  });

  it("fails closed when access throws (it has no request headers to read)", async () => {
    const throwing = () => {
      throw new Error("needs headers");
    };
    expect(await renderNavLink(app, "editor", throwing)).toBeNull();
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
    expect(view.Component.serverProps).toEqual({ configured: false, access: expect.any(Function) });
  });
});
