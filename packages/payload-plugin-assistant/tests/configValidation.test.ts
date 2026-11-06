import { DEFAULT_CONVERSATION_CAPS } from "../src/conversations/caps";
import type { Config, PayloadRequest } from "payload";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantPlugin } from "../src/plugin";
import { buildEndpoints } from "../src/endpoints";
import { normalizeOptions, OPENROUTER_PROVIDER } from "../src/utils/normalizeOptions";
import type { AssistantPluginOptions } from "../src/types/options";

const incoming = { collections: [] } as unknown as Config;
const models = [
  { id: "model/a", label: "A" },
  { id: "model/b", label: "B" },
];
const valid: AssistantPluginOptions = { models, apiKey: "sk-test" };

afterEach(() => {
  vi.restoreAllMocks();
});

const reqFor = (user: unknown) =>
  ({ user, payload: { config: { admin: { user: "users" } } } }) as unknown as PayloadRequest;
const admin = { id: 1, collection: "users" };

describe("assistantPlugin", () => {
  it("returns the config untouched and silent when enabled is false", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(assistantPlugin({ ...valid, enabled: false })(incoming)).toBe(incoming);
    // Not even option validation runs.
    expect(assistantPlugin({ models: [], apiKey: undefined, enabled: false })(incoming)).toBe(incoming);
    expect(warn).not.toHaveBeenCalled();
  });

  it("registers the endpoint and the view, and keeps existing ones", () => {
    const config = assistantPlugin(valid)({
      ...incoming,
      endpoints: [{ path: "/other", method: "get", handler: () => new Response() }],
      admin: { components: { views: { existing: { Component: "x", path: "/x" } } } },
    } as unknown as Config);
    expect(config.endpoints?.map((e) => `${e.method} ${e.path}`)).toEqual([
      "get /other",
      "get /assistant/config",
      "post /assistant/chat",
      "get /assistant/chat",
      "get /assistant/approvals",
      "get /assistant/usage",
      "post /assistant/chat/stop",
      "get /assistant/conversations",
      "get /assistant/conversations/:threadId",
      "patch /assistant/conversations/:threadId",
      "delete /assistant/conversations/:threadId",
    ]);
    const views = config.admin?.components?.views as Record<string, any>;
    expect(Object.keys(views)).toEqual(["existing", "assistant"]);
    expect(views.assistant.path).toBe("/assistant");
    expect(views.assistant.Component.path).toBe("@cargo/payload-plugin-assistant/admin/AssistantView#AssistantView");
  });

  it("adds the nav link after existing ones, in any shape Payload accepts", () => {
    const nav = (afterNavLinks: unknown) =>
      (assistantPlugin(valid)({ ...incoming, admin: { components: { afterNavLinks } } } as unknown as Config).admin?.components
        ?.afterNavLinks ?? []) as unknown as Array<string | { path: string }>;
    const ours = { path: "@cargo/payload-plugin-assistant/admin/AssistantNavLink#AssistantNavLink", serverProps: { access: expect.any(Function) } };
    expect(nav(undefined)).toEqual([ours]);
    expect(nav(["a"])).toEqual(["a", ours]);
    expect(nav("b")).toEqual(["b", ours]);
  });

  it("registers the same shape without an API key, and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const keyed = assistantPlugin(valid)(incoming);
    const unkeyed = assistantPlugin({ ...valid, apiKey: undefined })(incoming);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("apiKey");
    expect(unkeyed.endpoints?.map((e) => e.path)).toEqual(keyed.endpoints?.map((e) => e.path));
    const view = (config: Config) => (config.admin?.components?.views as any).assistant;
    expect(view(unkeyed).Component.path).toBe(view(keyed).Component.path);
    expect(view(unkeyed).path).toBe(view(keyed).path);
    expect(view(unkeyed).Component.serverProps).toEqual({ configured: false, access: expect.any(Function) });
    expect(view(keyed).Component.serverProps).toEqual({ configured: true, access: expect.any(Function) });
  });

  it("throws on programmer errors", () => {
    const run = (options: Partial<AssistantPluginOptions>) => () =>
      assistantPlugin({ ...valid, ...options })(incoming);
    expect(run({ models: [] })).toThrow(/at least one model/);
    expect(run({ models: [models[0]!, models[0]!] })).toThrow(/duplicate model id/);
    expect(run({ defaultModel: "model/c" })).toThrow(/not one of the ids/);
    expect(run({ maxSteps: 0 })).toThrow(/maxSteps/);
    expect(run({ maxSteps: -1 })).toThrow(/maxSteps/);
    expect(run({ maxSteps: 1.5 })).toThrow(/maxSteps/);
    // Cloudflare's 32 Worker invocations per request (#116): at most 25 tool calls per run.
    expect(run({ maxToolCalls: 0 })).toThrow(/maxToolCalls/);
    expect(run({ maxToolCalls: 26 })).toThrow(/from 1 to 25.*32 per request/);
    expect(run({ maxToolCalls: 25 })).not.toThrow();
  });
});

describe("normalizeOptions", () => {
  it("fills in defaults", () => {
    const n = normalizeOptions(valid);
    expect(n).toMatchObject({
      configured: true,
      defaultModel: "model/a",
      maxSteps: 10,
      maxToolCalls: 20,
      conversations: { kind: "memory" },
    });
  });

  it("defaults access to users of the admin auth collection only", async () => {
    const { access } = normalizeOptions(valid);
    const req = { payload: { config: { admin: { user: "users" } } } } as unknown as PayloadRequest;
    expect(await access({ user: { id: 1, collection: "users" } as never, req })).toBe(true);
    expect(await access({ user: { id: 1, collection: "customers" } as never, req })).toBe(false);
    expect(await access({ user: { id: 1 } as never, req })).toBe(false);
  });

  it("uses the Durable Object namespaces when given, with retention and caps", () => {
    const stub = {
      fetch: async () => new Response(),
      claim: async () => ({}),
      transcript: async () => null,
      destroy: async () => false,
      store: async () => null,
    };
    const namespace = { idFromName: () => "id", get: () => stub };
    const index = { idFromName: () => "id", get: () => ({ call: async () => null }) };
    expect(normalizeOptions({ ...valid, conversations: { namespace, index } }).conversations).toEqual({
      kind: "durable-object",
      namespace,
      index,
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      caps: DEFAULT_CONVERSATION_CAPS,
    });
    const custom = normalizeOptions({
      ...valid,
      conversations: { namespace, index, retentionDays: 7, caps: { maxMessages: 50 } },
    }).conversations;
    expect(custom).toMatchObject({ retentionMs: 7 * 24 * 60 * 60 * 1000, caps: { maxMessages: 50, maxBytes: DEFAULT_CONVERSATION_CAPS.maxBytes } });
  });

  it("rejects half a Durable Object pair, bad retention and bad caps", () => {
    const namespace = { idFromName: () => "id", get: () => ({}) as never };
    expect(() => normalizeOptions({ ...valid, conversations: { namespace } })).toThrow(/go together/);
    expect(() => normalizeOptions({ ...valid, conversations: { retentionDays: 0 } })).toThrow(/retentionDays/);
    expect(() => normalizeOptions({ ...valid, conversations: { caps: { maxBytes: -1 } } })).toThrow(/caps.maxBytes/);
  });

  it("keeps OpenRouter provider options camelCase (snake_case is silently dropped by the SDK)", () => {
    const { provider } = normalizeOptions(valid).openRouter;
    expect(provider).toBe(OPENROUTER_PROVIDER);
    expect(provider).toEqual({ requireParameters: true, dataCollection: "deny" });
    expect(Object.keys(provider).some((key) => key.includes("_"))).toBe(false);
  });
});

describe("chat endpoint access", () => {
  const handler = (options: Partial<AssistantPluginOptions> = {}) =>
    buildEndpoints(normalizeOptions({ ...valid, ...options })).find((e) => e.path === "/assistant/chat" && e.method === "post")!
      .handler as (req: PayloadRequest) => Promise<Response>;

  it("denies an anonymous request", async () => {
    expect((await handler()(reqFor(null))).status).toBe(401);
  });

  it("denies a signed-in user the access function refuses", async () => {
    const res = await handler({ access: () => false })(reqFor(admin));
    expect(res.status).toBe(403);
  });

  it("denies a user of another auth collection by default", async () => {
    expect((await handler()(reqFor({ id: 2, collection: "customers" }))).status).toBe(403);
  });

  it("hands access the user and the request", async () => {
    const access = vi.fn(() => true);
    const req = reqFor(admin);
    await handler({ access })(req);
    expect(access).toHaveBeenCalledWith({ user: admin, req });
  });

  it("reports not configured without an API key", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handler({ apiKey: "" })(reqFor(admin));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not configured" });
  });

  it("answers 429 when rateLimit refuses, with the user's request", async () => {
    const rateLimit = vi.fn(() => false);
    const req = reqFor(admin);
    const res = await handler({ rateLimit })(req);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests", code: "rate_limited" });
    expect(rateLimit).toHaveBeenCalledWith(req);
  });
});
