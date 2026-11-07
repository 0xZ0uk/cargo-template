import type { PayloadRequest } from "payload";
import { conversationBackend } from "../conversations/backend";
import { userKeyOf, type ChatTurnBody, type ConversationBackend, type TurnSettings } from "../conversations/types";
import { PLUGIN_NAME } from "../constants";
import { inProcessDispatch, payloadToolSourceForRequest } from "../tools/inProcess";
import type { McpDispatch } from "../tools/payloadToolSource";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";
import { usesTestModel } from "../utils/testModel";
import { buildProposals, findStaleApprovals } from "./approvals";
import { buildSystemPrompt, siteUrls } from "./instructions";
import { createTurnRunner, type CreateAdapter } from "./turn";
import { isId, validateChatBody } from "./validate";
import { budgetExceeded, formatUsd, usageResponse, utcDay } from "../usage";
import { MESSAGE_METADATA_KEY } from "../references";
import { readerFor } from "./reader";
import { MAX_SEARCH_CHARS, resolveMessageReferences, searchDocuments } from "./references";

/** Collections whose title field is redacted (slug → singular label), for the config endpoint. */
export const redactedTitlesOf = (req: PayloadRequest, options: NormalizedAssistantOptions): Record<string, string> =>
  readerFor(req, options).redactedTitles();

/**
 * The assistant's endpoints, behind the checks in `endpoints/index.ts` (signed in, `access`…).
 * Loaded with `await import("./server/chat")`, so the AI runtime (`@tanstack/ai`, the MCP client,
 * the OpenRouter adapter) stays out of the import graph of `payload.config` and the admin bundle.
 * Import it from there only, never statically.
 */

/** Seams for tests and Node: the model adapter and the MCP dispatcher of the in-memory backend. */
export interface ChatDeps {
  /** Model adapter for turns run by the in-memory backend (the Durable Object has its own `turnRunner`). */
  createAdapter?: CreateAdapter;
  /** How the Worker reaches `/api/mcp` in process. Default: `handleEndpoints` on the request's config. */
  dispatch?: McpDispatch;
}

export const jsonError = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, code, ...extra }, { status });

const MAX_TITLE_CHARS = 200;

function userOf(req: PayloadRequest) {
  return userKeyOf(req.user as { collection?: string; id: string | number });
}

function dispatchFor(req: PayloadRequest, deps: ChatDeps): McpDispatch {
  return deps.dispatch ?? inProcessDispatch(req.payload.config);
}

function backendFor(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps): ConversationBackend {
  const dispatch = dispatchFor(req, deps);
  return conversationBackend(options, {
    turnRunner: createTurnRunner(deps.createAdapter ? { createAdapter: deps.createAdapter } : {}),
    // Node / in-memory only: the turn runs in this process, so MCP goes through Payload's router here.
    mcpFetch: () => ((input: RequestInfo | URL, init?: RequestInit) =>
      dispatch(input instanceof Request && !init ? input : new Request(input, init))) as typeof fetch,
  });
}

/** The URL of `req` (Payload's `PayloadRequest.url` is optional in its types). */
const requestUrl = (req: PayloadRequest) => new URL(req.url ?? "http://localhost/");

/** A plain `Request` view of the Payload request, for `join` / `hydrate` (query string + headers). */
const asRequest = (req: PayloadRequest) =>
  new Request(requestUrl(req), { headers: req.headers, ...(req.signal ? { signal: req.signal } : {}) });

/**
 * The tool names the app's `toolFilter` admits, evaluated here where the function lives (the
 * turn may run in a Durable Object, which only gets data). One extra in-process tool discovery
 * per turn, and only when a `toolFilter` is set.
 */
async function allowedToolNames(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps) {
  if (!options.toolFilter) return undefined;
  const source = payloadToolSourceForRequest(req, { toolFilter: options.toolFilter, dispatch: dispatchFor(req, deps) });
  try {
    return (await source.tools()).map((tool) => tool.name);
  } finally {
    await source.close();
  }
}

/** Copy a response with extra headers (a Durable Object's response has immutable headers). */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
}

/** A resume decision that applies nothing: cancelled, or an approval answered `approved: false` (`validate.ts`). */
const isRejection = (item: { status: string; payload?: unknown }): boolean =>
  item.status === "cancelled" ||
  (typeof item.payload === "object" && item.payload !== null && (item.payload as { approved?: unknown }).approved === false);

/** `POST /api/assistant/chat`: a new turn, or a resume with approval decisions. Answers the run's SSE. */
export async function handleChat(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  let raw: unknown;
  try {
    raw = await (req as unknown as Request).json();
  } catch {
    return jsonError(400, "invalid_body", "the body must be JSON");
  }
  const parsed = validateChatBody(raw, req.headers.get("X-Run-Id"));
  if (!parsed.ok) return jsonError(400, "invalid_body", parsed.error);
  const { threadId, messages, resume, seen, context, references } = parsed.value;
  // Every read and title of this request, and the redaction policy the turn gets (#133).
  const reader = readerFor(req, options);

  const model = parsed.value.model ?? options.defaultModel;
  if (!options.models.some((allowed) => allowed.id === model)) {
    return jsonError(400, "model_not_allowed", `model "${model}" is not in the assistant's allowlist`, {
      models: options.models.map((allowed) => allowed.id),
    });
  }

  // What the message is about (#69), resolved as the user: a document they can't read is refused,
  // and the stored message keeps the server's titles, never the client's. No content is added.
  if (context || references.length) {
    const resolved = await resolveMessageReferences(reader, { ...(context ? { context } : {}), references });
    if (!resolved.ok) return jsonError(resolved.status, resolved.code, resolved.error);
    const message = messages[0];
    if (message) message.metadata = { ...message.metadata, [MESSAGE_METADATA_KEY]: resolved.value };
  }

  const backend = backendFor(req, options, deps);
  // The daily budget (#68), before anything else that costs: no model call once a cap is reached.
  // A read here, a write only in the user's index object (single writer). A run already going
  // when the cap is crossed finishes, so one run may overshoot. A resume that only rejects (or
  // cancels) still goes through: it applies nothing and lets the paused run end, at the price of
  // the model's closing answer (one model call: `maxSteps` 1), so a rejection can overshoot slightly.
  const onlyRejects = Boolean(resume?.length) && resume!.every(isRejection);
  let overBudget = false;
  if (options.budget) {
    const usage = await backend.usage(userOf(req), utcDay());
    overBudget = budgetExceeded(usage, options.budget);
    if (overBudget && !onlyRejects) {
      const cap = options.budget.dailyCostUsd !== undefined && usage.costUsd >= options.budget.dailyCostUsd
        ? `today's assistant budget (${formatUsd(options.budget.dailyCostUsd)})`
        : `today's assistant token allowance (${options.budget.dailyTokens?.toLocaleString("en-US")} tokens)`;
      return jsonError(402, "budget_exceeded", `You have used ${cap}. It resets at midnight UTC.`, {
        usage: usageResponse(usage, options.budget),
      });
    }
  }
  // Approvals sent with the `updatedAt` their card showed: refuse the whole batch (TanStack
  // resumes a batch all or nothing) when one of those documents changed since, so the user
  // reviews the new diff first. Ownership first: another user's conversation is a 404.
  if (seen.length) {
    const transcript = await backend.transcript(userOf(req), threadId);
    if (!transcript) return jsonError(404, "not_found", "Not found");
    const stale = await findStaleApprovals(reader, transcript.pendingInterrupts, seen);
    if (stale.length) {
      return jsonError(409, "stale", "A document changed after you reviewed the change. Review it again.", { interruptIds: stale });
    }
  }

  const { site, api } = siteUrls(req);
  const origin = req.headers.get("origin") || requestUrl(req).origin;
  let toolNames: string[] | undefined;
  try {
    toolNames = await allowedToolNames(req, options, deps);
  } catch (error) {
    req.payload.logger.error({ err: error, msg: `[${PLUGIN_NAME}] tool discovery for toolFilter failed` });
    return jsonError(502, "tools_unavailable", "the assistant could not list Payload's tools");
  }
  const testModel = usesTestModel(options, req);
  if (options.testModel && !testModel) {
    req.payload.logger.error(`[${PLUGIN_NAME}] "testModel" is on but this request is not to localhost: using OpenRouter`);
  }
  const settings: TurnSettings = {
    model,
    apiKey: options.apiKey,
    systemPrompt: await buildSystemPrompt(req, options),
    maxSteps: overBudget ? 1 : options.maxSteps,
    maxToolCalls: options.maxToolCalls,
    maxContextTokens: options.maxContextTokens,
    mcpEndpoint: `${api}/mcp`,
    ...(toolNames ? { toolNames } : {}),
    httpReferer: site || origin,
    appTitle: options.appTitle,
    ...(testModel ? { testModel: true } : {}),
    redaction: reader.policy,
  };
  const body: ChatTurnBody = { messages, ...(resume ? { resume } : {}), settings };
  const runId = parsed.value.runId ?? crypto.randomUUID();
  const first = messages[0]?.content;

  const response = await backend.startTurn({
    userKey: userOf(req),
    threadId,
    runId,
    body: body as unknown as Record<string, unknown>,
    auth: { cookie: req.headers.get("cookie") ?? "", origin },
    ...(typeof first === "string" ? { title: first.trim().slice(0, MAX_TITLE_CHARS) } : {}),
  });
  return response.ok ? withHeaders(response, { "X-Run-Id": runId, "X-Thread-Id": threadId }) : response;
}

/**
 * `GET /api/assistant/chat?threadId=…`: with a run (`?runId=` or `X-Run-Id`) and an offset
 * (`Last-Event-ID` or `?offset=`, `-1` for the start), rejoin the run's stream from its log;
 * without, the conversation as `useChat`'s `hydrate()` expects it.
 */
export async function handleChatGet(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const url = requestUrl(req);
  const threadId = url.searchParams.get("threadId");
  if (!isId(threadId)) return jsonError(400, "invalid_query", '"threadId" is required');
  const backend = backendFor(req, options, deps);
  const runId = req.headers.get("X-Run-Id") ?? url.searchParams.get("runId");
  const offset = req.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
  if (runId || offset) {
    if (!isId(runId) || !offset) return jsonError(400, "invalid_query", "a rejoin needs a run id and an offset (Last-Event-ID or ?offset=-1)");
    return backend.join(userOf(req), threadId, asRequest(req));
  }
  return backend.hydrate(userOf(req), threadId, asRequest(req));
}

/**
 * `GET /api/assistant/approvals?threadId=…`: what each pending approval of the conversation
 * would change (`ApprovalsResponse`), read as the caller. 404 when the conversation isn't theirs.
 */
export async function handleApprovals(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const threadId = requestUrl(req).searchParams.get("threadId");
  if (!isId(threadId)) return jsonError(400, "invalid_query", '"threadId" is required');
  const transcript = await backendFor(req, options, deps).transcript(userOf(req), threadId);
  if (!transcript) return jsonError(404, "not_found", "Not found");
  return Response.json({ approvals: await buildProposals(readerFor(req, options), transcript.pendingInterrupts) });
}

/** `POST /api/assistant/chat/stop` `{ threadId, runId }`: abort a live run. */
export async function handleStop(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const body = (await (req as unknown as Request).json().catch(() => null)) as { threadId?: unknown; runId?: unknown } | null;
  if (!isId(body?.threadId) || !isId(body?.runId)) return jsonError(400, "invalid_body", '"threadId" and "runId" are required');
  const stopped = await backendFor(req, options, deps).stop(userOf(req), body.threadId, body.runId);
  return Response.json({ stopped });
}

/**
 * `GET /api/assistant/documents?q=`: the `@` search. Documents (and globals) whose title contains
 * `q`, read through plugin-mcp as the caller: `{ documents: [{ kind, slug, id?, title }] }`, at
 * most 8, never their content.
 */
export async function handleSearchDocuments(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const q = requestUrl(req).searchParams.get("q") ?? "";
  if (q.length > MAX_SEARCH_CHARS) return jsonError(400, "invalid_query", `"q" is longer than ${MAX_SEARCH_CHARS} characters`);
  try {
    const documents = await searchDocuments(readerFor(req, options), options, q, { dispatch: dispatchFor(req, deps) });
    return Response.json({ documents });
  } catch (error) {
    req.payload.logger.error({ err: error, msg: `[${PLUGIN_NAME}] document search failed` });
    return jsonError(502, "tools_unavailable", "the assistant could not search the documents");
  }
}

/** What the conversation list shows, per conversation. */
export interface ConversationSummary {
  threadId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  /** What the conversation has cost so far (USD, OpenRouter's figure), when it used any (#68). */
  costUsd?: number;
  tokens?: number;
}

/** `GET /api/assistant/conversations?limit=&cursor=&search=`: the caller's conversations, newest first. */
export async function handleListConversations(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const url = requestUrl(req);
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const search = url.searchParams.get("search")?.slice(0, 200) || undefined;
  const page = await backendFor(req, options, deps).list(userOf(req), {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
  });
  const conversations: ConversationSummary[] = page.entries.map((entry) => {
    const metadata = entry.metadata as { costUsd?: unknown; tokens?: unknown } | undefined;
    return {
      threadId: entry.threadId,
      title: entry.title ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(typeof metadata?.costUsd === "number" ? { costUsd: metadata.costUsd } : {}),
      ...(typeof metadata?.tokens === "number" ? { tokens: metadata.tokens } : {}),
    };
  });
  return Response.json({ conversations, nextCursor: page.cursor ?? null });
}

/**
 * `GET /api/assistant/usage?threadId=`: the caller's usage today (UTC), the caps, what is left and
 * when it resets; with `threadId`, the conversation's total too (`null` if it isn't theirs).
 */
export async function handleUsage(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const threadId = requestUrl(req).searchParams.get("threadId");
  if (threadId !== null && !isId(threadId)) return jsonError(400, "invalid_query", '"threadId" is not a valid id');
  const now = Date.now();
  const snapshot = await backendFor(req, options, deps).usage(userOf(req), utcDay(now), threadId ?? undefined);
  return Response.json(usageResponse(snapshot, options.budget, now));
}

const threadParam = (req: PayloadRequest): string | undefined => {
  const value = (req.routeParams as Record<string, unknown> | undefined)?.threadId;
  return isId(value) ? value : undefined;
};

/** `GET /api/assistant/conversations/:threadId`: the transcript (the `hydrate` body), 404 when not the caller's. */
export async function handleGetConversation(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const threadId = threadParam(req);
  if (!threadId) return jsonError(404, "not_found", "Not found");
  const backend = backendFor(req, options, deps);
  // `transcript` is the ownership check (null for missing or someone else's); `hydrate` is the body.
  if (!(await backend.transcript(userOf(req), threadId))) return jsonError(404, "not_found", "Not found");
  return backend.hydrate(userOf(req), threadId, asRequest(req));
}

/** `PATCH /api/assistant/conversations/:threadId` `{ title }`. */
export async function handleRenameConversation(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const threadId = threadParam(req);
  if (!threadId) return jsonError(404, "not_found", "Not found");
  const body = (await (req as unknown as Request).json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > MAX_TITLE_CHARS) return jsonError(400, "invalid_body", `"title" must be 1 to ${MAX_TITLE_CHARS} characters`);
  const renamed = await backendFor(req, options, deps).rename(userOf(req), threadId, title);
  return renamed ? Response.json({ threadId, title }) : jsonError(404, "not_found", "Not found");
}

/** `DELETE /api/assistant/conversations/:threadId`: everything, a live run included. */
export async function handleDeleteConversation(req: PayloadRequest, options: NormalizedAssistantOptions, deps: ChatDeps = {}): Promise<Response> {
  const threadId = threadParam(req);
  if (!threadId) return jsonError(404, "not_found", "Not found");
  const removed = await backendFor(req, options, deps).remove(userOf(req), threadId);
  return removed ? Response.json({ deleted: true }) : jsonError(404, "not_found", "Not found");
}
