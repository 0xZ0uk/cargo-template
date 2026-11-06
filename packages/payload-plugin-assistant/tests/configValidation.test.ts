import type { Config, PayloadRequest } from "payload";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantPlugin } from "../src/plugin";
import { buildChatHandler } from "../src/endpoints/chat";
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

const reqFor = (user: unknown) => ({ user }) as unknown as PayloadRequest;

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
    expect(config.endpoints?.map((e) => `${e.method} ${e.path}`)).toEqual(["get /other", "post /assistant/chat"]);
    const views = config.admin?.components?.views as Record<string, any>;
    expect(Object.keys(views)).toEqual(["existing", "assistant"]);
    expect(views.assistant.path).toBe("/assistant");
    expect(views.assistant.Component.path).toBe("@cargo/payload-plugin-assistant/admin/AssistantView#AssistantView");
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
    expect(view(unkeyed).Component.serverProps).toEqual({ configured: false });
    expect(view(keyed).Component.serverProps).toEqual({ configured: true });
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
  });
});

describe("normalizeOptions", () => {
  it("fills in defaults", () => {
    const n = normalizeOptions(valid);
    expect(n).toMatchObject({
      configured: true,
      defaultModel: "model/a",
      maxSteps: 10,
      conversations: { kind: "memory" },
    });
    expect(n.access({ id: 1 } as never)).toBe(true);
    expect(n.access(null as never)).toBe(false);
  });

  it("uses the Durable Object namespace when given", () => {
    const namespace = { idFromName: () => "id", get: () => ({ fetch: async () => new Response() }) };
    expect(normalizeOptions({ ...valid, conversations: { namespace } }).conversations).toEqual({
      kind: "durable-object",
      namespace,
    });
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
    buildChatHandler(normalizeOptions({ ...valid, ...options }));

  it("denies an anonymous request", async () => {
    expect((await handler()(reqFor(null))).status).toBe(401);
  });

  it("denies a signed-in user the access function refuses", async () => {
    const res = await handler({ access: () => false })(reqFor({ id: 1 }));
    expect(res.status).toBe(403);
  });

  it("reports not configured without an API key", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handler({ apiKey: "" })(reqFor({ id: 1 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not configured" });
  });

  it("answers 429 when rateLimit refuses, and 501 from the stub otherwise", async () => {
    expect((await handler({ rateLimit: () => false })(reqFor({ id: 1 }))).status).toBe(429);
    const ok = await handler({ rateLimit: async () => true })(reqFor({ id: 1 }));
    expect(ok.status).toBe(501);
    expect(await ok.json()).toEqual({ error: "not implemented" });
  });
});
