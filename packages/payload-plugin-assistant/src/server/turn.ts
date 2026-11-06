import { chat, maxIterations, type AnyTextAdapter, type StreamChunk } from "@tanstack/ai";
import { clearToolResults, composeStrategies, evictOldest, withCompaction } from "@tanstack/ai-compaction";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { withPersistence } from "@tanstack/ai-persistence";
import { DEFAULT_MAX_TOOL_CALLS, MCP_REQUESTS_PER_RUN } from "../constants";
import { OPENROUTER_PROVIDER } from "../utils/provider";
import type { ChatTurnBody, TurnContext, TurnRunner, TurnSettings } from "../conversations/types";
import { createPayloadToolSource, payloadToolsMcpOptions } from "../tools/payloadToolSource";
import { withAssistantErrors } from "./errors";
import { testModelAdapter } from "./testModel";

/** Builds the model adapter for a turn. Default: OpenRouter. Tests pass `fakeText()`. */
export type CreateAdapter = (settings: TurnSettings) => AnyTextAdapter;

export interface TurnRunnerOptions {
  createAdapter?: CreateAdapter;
}

/**
 * The OpenRouter adapter for a turn. The key goes in through `createOpenRouterText(model, apiKey)`
 * (the plugin never reads `process.env`); `appTitle` / `httpReferer` become the
 * `X-OpenRouter-Title` / `HTTP-Referer` attribution headers. The SDK's own retries are off: a
 * 429 or 402 should reach the user now, not after a silent backoff inside a run they are watching.
 */
export function createOpenRouterAdapter(sdk: OpenRouterSdkOverrides = {}): CreateAdapter {
  return (settings) =>
    createOpenRouterText(settings.model as Parameters<typeof createOpenRouterText>[0], settings.apiKey, {
      appTitle: settings.appTitle,
      httpReferer: settings.httpReferer,
      retryConfig: { strategy: "none" },
      ...sdk,
    }) as unknown as AnyTextAdapter;
}

/** Extra OpenRouter SDK options (a gateway `serverURL`, or an `httpClient` in tests). */
export type OpenRouterSdkOverrides = Omit<NonNullable<Parameters<typeof createOpenRouterText>[2]>, "apiKey">;

export const openRouterAdapter: CreateAdapter = createOpenRouterAdapter();

/** The default: OpenRouter, or the scripted test model when the endpoint said so (`settings.testModel`). */
export const defaultAdapter: CreateAdapter = (settings) =>
  settings.testModel ? testModelAdapter(settings) : openRouterAdapter(settings);

/**
 * The real chat turn (#63). Runs wherever the conversation lives: inside the conversation's
 * Durable Object on Workers, in the Worker process with the in-memory backend. It gets the
 * conversation's stores, the MCP `fetch` and the stop signal from the {@link TurnContext}, and
 * everything else (model, key, prompt, limits) from the body the endpoint resolved.
 *
 * - Tools: plugin-mcp's, as the admin who sent the turn (their Cookie and Origin, through
 *   `mcpFetch`), minus the built-in drops and, when the app has a `toolFilter`, limited to the
 *   names the endpoint admitted. Write tools pause with an approval interrupt.
 * - History: the conversation's stored transcript (`withPersistence`); the body only adds the new
 *   user message, or `resume` decisions for pending approvals.
 * - Limits: `maxIterations(maxSteps)`, `maxToolCalls` tool calls and {@link MCP_REQUESTS_PER_RUN} MCP
 *   requests (Cloudflare's 32 Worker invocations per request), compaction past `maxContextTokens`,
 *   the stop signal.
 * - Provider routing is fixed: `{ requireParameters: true, dataCollection: 'deny' }`, camelCase.
 */
export function createTurnRunner(options: TurnRunnerOptions = {}): TurnRunner {
  const createAdapter = options.createAdapter ?? defaultAdapter;
  return (context: TurnContext): AsyncIterable<StreamChunk> => {
    const { input, persistence, mcpFetch, signal } = context;
    const { threadId, runId } = input;
    const body = input.body as unknown as ChatTurnBody;
    const { settings } = body;

    const allowed = settings.toolNames ? new Set(settings.toolNames) : undefined;
    const source = createPayloadToolSource({
      endpoint: settings.mcpEndpoint,
      headers: { cookie: input.auth.cookie, origin: input.auth.origin },
      dispatch: (request) => mcpFetch(request),
      // Cloudflare's 32 Worker invocations per request: every MCP request is one (README).
      maxToolCalls: settings.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
      maxRequests: MCP_REQUESTS_PER_RUN,
      ...(allowed ? { toolFilter: (tool) => allowed.has(tool.name) } : {}),
    });

    // chat() takes an AbortController, the turn gets a signal: bridge them.
    const abortController = new AbortController();
    if (signal.aborted) abortController.abort(signal.reason);
    else signal.addEventListener("abort", () => abortController.abort(signal.reason), { once: true });

    const stream = chat({
      adapter: createAdapter(settings),
      threadId,
      runId,
      messages: body.messages,
      ...(body.resume?.length ? { resume: body.resume } : {}),
      systemPrompts: [settings.systemPrompt],
      mcp: payloadToolsMcpOptions(source),
      modelOptions: { provider: { ...OPENROUTER_PROVIDER } },
      // OpenRouter: `session_id` = the thread (sticky provider routing, so its cache is reused) and
      // cache markers on the system prompt, the last tool and the last message for Anthropic models.
      promptCache: { retention: "short", key: threadId },
      agentLoopStrategy: maxIterations(settings.maxSteps),
      abortController,
      middleware: [
        withPersistence(persistence),
        withCompaction({
          maxTokens: settings.maxContextTokens,
          // Old tool results (whole documents) go first; whole old turns only if that isn't enough.
          strategy: composeStrategies(clearToolResults(), evictOldest()),
        }),
      ],
    }) as AsyncIterable<StreamChunk>;

    return withAssistantErrors(stream, { threadId, runId }, signal);
  };
}
