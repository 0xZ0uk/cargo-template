import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { StreamChunk } from "@tanstack/ai";
import { memoryPersistence } from "@tanstack/ai-persistence";
import { describe, expect, it } from "vitest";
import type { ChatTurnBody, TurnSettings } from "../src/conversations/types";
import { classifyRunError } from "../src/server/errors";
import { createOpenRouterAdapter, createTurnRunner } from "../src/server/turn";

/**
 * The turn runner with the real OpenRouter adapter and no network: the SDK's `httpClient` is
 * replaced, so these tests see the exact request the adapter serialises and answer it like
 * OpenRouter would (an SSE stream, or an error status). The tools come from a stand-in MCP server.
 */
const ORIGIN = "https://admin.example";
const COOKIE = "payload-token=abc";

const mcp = createMcpHandler(({ requestInfo }) => {
  const server = new McpServer({ name: "stand-in-payload", version: "0.0.0" });
  if (requestInfo?.headers.get("Cookie") === COOKIE) {
    server.registerTool(
      "findDocuments",
      { description: "Find documents.", annotations: { readOnlyHint: true } },
      async () => ({ content: [{ type: "text", text: '{"docs":[{"title":"Home"}]}' }] })
    );
    server.registerTool("updateDocument", { description: "Update a document.", annotations: { readOnlyHint: false } }, async () => ({
      content: [{ type: "text", text: "updated" }],
    }));
  }
  return server;
});

const settings = (overrides: Partial<TurnSettings> = {}): TurnSettings => ({
  model: "deepseek/deepseek-v4.1-flash",
  apiKey: "sk-or-test",
  systemPrompt: "You are the assistant.",
  maxSteps: 4,
  maxContextTokens: 64_000,
  mcpEndpoint: `${ORIGIN}/api/mcp`,
  httpReferer: ORIGIN,
  appTitle: "Payload admin assistant",
  ...overrides,
});

type Sent = { url: string; headers: Record<string, string>; body: Record<string, any> };

const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const answer = (text: string) =>
  sse(
    { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    "[DONE]"
  );

async function runTurn(options: {
  respond: (sent: Sent) => Response;
  settings?: Partial<TurnSettings>;
  mcpFetch?: typeof fetch;
  signal?: AbortSignal;
}) {
  const sent: Sent[] = [];
  const runner = createTurnRunner({
    createAdapter: createOpenRouterAdapter({
      httpClient: {
        request: async (request: Request) => {
          const entry = { url: request.url, headers: Object.fromEntries(request.headers), body: JSON.parse(await request.text()) };
          sent.push(entry);
          return options.respond(entry);
        },
      },
    }),
  });
  const body: ChatTurnBody = { messages: [{ role: "user", content: "Which pages are there?", id: "m1" } as never], settings: settings(options.settings) };
  const chunks: StreamChunk[] = [];
  for await (const chunk of runner({
    input: { threadId: "thread-1", runId: "run-1", userKey: "users:1", body: body as never, auth: { cookie: COOKIE, origin: ORIGIN } },
    persistence: memoryPersistence() as never,
    mcpFetch: options.mcpFetch ?? (((request: Request) => mcp.fetch(request)) as typeof fetch),
    signal: options.signal ?? new AbortController().signal,
  })) {
    chunks.push(chunk);
  }
  return { sent, chunks: chunks as unknown as Array<Record<string, any>> };
}

describe("the OpenRouter request", () => {
  it("serialises the camelCase provider options to require_parameters / data_collection", async () => {
    const { sent, chunks } = await runTurn({ respond: () => answer("Hello") });
    expect(sent).toHaveLength(1);
    const [{ url, headers, body }] = sent as [Sent];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    // The wire body, not the options object: snake_case keys are what OpenRouter reads.
    expect(body.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(JSON.stringify(body)).not.toMatch(/requireParameters|dataCollection/);
    expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(body.session_id).toBe("thread-1");
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are the assistant." });
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: "Which pages are there?" });
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name).sort()).toEqual(["findDocuments", "updateDocument"]);
    expect(headers).toMatchObject({
      authorization: "Bearer sk-or-test",
      "http-referer": ORIGIN,
      "x-openrouter-title": "Payload admin assistant",
    });
    expect(chunks.at(-1)?.type).toBe("RUN_FINISHED");
  });

  it("marks the cacheable prefix for Anthropic models", async () => {
    const { sent } = await runTurn({ respond: () => answer("Hello"), settings: { model: "anthropic/claude-haiku-5-5" } });
    const body = sent[0]!.body;
    expect(JSON.stringify(body.messages[0])).toContain("cache_control");
    expect(JSON.stringify(body.tools.at(-1))).toContain("cache_control");
  });

  it("only offers the tools the app's toolFilter admitted", async () => {
    const { sent } = await runTurn({ respond: () => answer("Hello"), settings: { toolNames: ["findDocuments"] } });
    expect(sent[0]!.body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(["findDocuments"]);
  });
});

describe("error mapping", () => {
  const error = (status: number, message: string, metadata?: unknown) => () =>
    Response.json({ error: { code: status, message, ...(metadata ? { metadata } : {}) } }, { status });

  it.each([
    [401, "No auth credentials found", "openrouter_invalid_key", /API key/],
    [402, "Insufficient credits", "openrouter_out_of_credits", /out of credits/],
    [429, "Rate limit exceeded", "openrouter_rate_limited", /Too many requests/],
    [404, "No endpoints found that support tool use", "model_unavailable", /not available/],
    [503, "No available model provider", "model_unavailable", /not available/],
    [500, "Internal Server Error", "run_failed", /failed/],
  ])("OpenRouter %i → %s", async (status, providerMessage, code, message) => {
    const { chunks } = await runTurn({ respond: error(status, providerMessage) });
    const runError = chunks.find((chunk) => chunk.type === "RUN_ERROR")!;
    expect(runError).toMatchObject({ code, error: { code } });
    expect(runError.message).toMatch(message);
    // The provider's body is kept for debugging; the key is never in the event.
    expect(runError.rawEvent).toMatchObject({ code: status, message: providerMessage });
    expect(JSON.stringify(chunks)).not.toContain("sk-or-test");
  });

  it("a session /api/mcp refuses → not_signed_in, before any model call", async () => {
    const { sent, chunks } = await runTurn({
      respond: () => answer("never"),
      mcpFetch: ((request: Request) => {
        const headers = new Headers(request.headers);
        headers.set("Cookie", "payload-token=expired");
        return mcp.fetch(new Request(request, { headers }));
      }) as typeof fetch,
    });
    expect(sent).toHaveLength(0);
    expect(chunks.at(-1)).toMatchObject({ type: "RUN_ERROR", code: "not_signed_in" });
  });

  it("/api/mcp down → tools_unavailable", async () => {
    const { chunks } = await runTurn({
      respond: () => answer("never"),
      mcpFetch: (async () => new Response("boom", { status: 500 })) as typeof fetch,
    });
    expect(chunks.at(-1)).toMatchObject({ type: "RUN_ERROR", code: "tools_unavailable" });
  });

  it("classifies context overflow and aborts", () => {
    expect(classifyRunError({ type: "RUN_ERROR", code: "context_overflow" }, false)).toBe("context_overflow");
    expect(classifyRunError({ type: "RUN_ERROR", code: "aborted" }, false)).toBe("stopped");
    expect(classifyRunError({ type: "RUN_ERROR", message: "anything" }, true)).toBe("stopped");
  });
});
