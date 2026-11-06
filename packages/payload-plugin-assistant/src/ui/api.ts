/**
 * The admin UI's side of the endpoint contract (README, "Endpoints"). Plain `fetch` with the
 * admin session cookie (`credentials: "same-origin"`); no Payload or server imports, so it is
 * safe in the client bundle.
 */

import type { ApprovalProposal, ApprovalsResponse } from "../approvals/types";
import type { UsageResponse } from "../usage";

export type { UsageResponse };
import type { DocumentReference } from "../references";

export interface AssistantModelOption {
  id: string;
  label: string;
}

export interface AssistantClientConfig {
  configured: boolean;
  models: AssistantModelOption[];
  defaultModel: string;
  maxSteps: number;
  /** Collections whose title field is redacted (slug → singular label): documents there are named `User #12`, never by the hidden value. */
  redactedTitles?: Record<string, string>;
}

export interface ConversationSummary {
  threadId: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  /** What the conversation has cost so far, USD (#68). Absent until its first model call. */
  costUsd?: number;
  tokens?: number;
}

/** An endpoint's JSON error (`{ error, code }`) with its HTTP status. */
export class AssistantApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** The whole JSON body (e.g. a 409 `stale`'s `interruptIds`), when there was one. */
  readonly body: Record<string, unknown> | undefined;
  constructor(status: number, code: string | undefined, message: string, body?: Record<string, unknown>) {
    super(message);
    this.name = "AssistantApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** `/api` + `/assistant/…`, without a doubled slash. */
export function assistantUrl(apiRoute: string, path: string): string {
  return `${apiRoute.replace(/\/+$/, "")}/assistant${path}`;
}

/** The chat URL the `useChat` connection uses: `?threadId=` lets hydrate, rejoin and reconnect find the run. */
export function chatUrl(apiRoute: string, threadId: string): string {
  return `${assistantUrl(apiRoute, "/chat")}?threadId=${encodeURIComponent(threadId)}`;
}

/** A new conversation id, in the shape the endpoint accepts (`[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`). */
export function newThreadId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `thread_${random}`;
}

export function isValidThreadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

/** Reads `{ error, code }` from a failed response; tolerates any other body. */
export async function readApiError(response: Response): Promise<AssistantApiError> {
  let code: string | undefined;
  let message = `Request failed (${response.status})`;
  let json: Record<string, unknown> | undefined;
  try {
    const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
    if (body && typeof body === "object" && !Array.isArray(body)) json = body as Record<string, unknown>;
    if (typeof body?.code === "string") code = body.code;
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // Not JSON (a proxy's HTML error page): keep the status.
  }
  return new AssistantApiError(response.status, code, message, json);
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw await readApiError(response);
  return (await response.json()) as T;
}

export function fetchAssistantConfig(apiRoute: string): Promise<AssistantClientConfig> {
  return request(assistantUrl(apiRoute, "/config"));
}

export async function listConversations(apiRoute: string): Promise<ConversationSummary[]> {
  const body = await request<{ conversations?: ConversationSummary[] }>(
    `${assistantUrl(apiRoute, "/conversations")}?limit=100`
  );
  return Array.isArray(body.conversations) ? body.conversations : [];
}

/** The caller's usage today, the budget and, with `threadId`, the conversation's total (#68). */
export function fetchUsage(apiRoute: string, threadId?: string): Promise<UsageResponse> {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return request(`${assistantUrl(apiRoute, "/usage")}${query}`);
}

export function renameConversation(apiRoute: string, threadId: string, title: string) {
  return request<{ threadId: string; title: string }>(
    assistantUrl(apiRoute, `/conversations/${encodeURIComponent(threadId)}`),
    { method: "PATCH", body: JSON.stringify({ title }) }
  );
}

/** What each pending approval of a conversation would change (`GET /approvals?threadId=`). */
export async function fetchApprovals(apiRoute: string, threadId: string): Promise<ApprovalProposal[]> {
  const body = await request<Partial<ApprovalsResponse>>(
    `${assistantUrl(apiRoute, "/approvals")}?threadId=${encodeURIComponent(threadId)}`
  );
  return Array.isArray(body.approvals) ? body.approvals : [];
}

/** The interrupt ids of a 409 `stale` resume: their documents changed after the card showed them. */
export function staleInterruptIds(error: AssistantApiError | undefined): string[] {
  if (error?.status !== 409 || error.code !== "stale") return [];
  const ids = error.body?.interruptIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export function deleteConversation(apiRoute: string, threadId: string) {
  return request<{ deleted: boolean }>(assistantUrl(apiRoute, `/conversations/${encodeURIComponent(threadId)}`), {
    method: "DELETE",
  });
}

/**
 * A `fetch` for the chat connection that remembers the JSON error body of the last failed
 * response. `@tanstack/ai-client` turns a non-2xx answer into a `StreamHttpError` that keeps only
 * the status; the code (`not_configured`, `rate_limited`, `model_not_allowed`…) comes from here.
 */
export function recordingFetch(): {
  fetch: typeof fetch;
  lastError: () => AssistantApiError | undefined;
  reset: () => void;
} {
  let last: AssistantApiError | undefined;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok && response.status !== 0) last = await readApiError(response);
    return response;
  };
  return {
    fetch: wrapped,
    lastError: () => last,
    reset: () => {
      last = undefined;
    },
  };
}

/** The `@` search (`GET /documents?q=`): addresses and titles of documents the user can read. */
export async function searchDocuments(apiRoute: string, query: string, signal?: AbortSignal): Promise<DocumentReference[]> {
  const body = await request<{ documents?: DocumentReference[] }>(
    `${assistantUrl(apiRoute, "/documents")}?q=${encodeURIComponent(query)}`,
    signal ? { signal } : {}
  );
  return Array.isArray(body.documents) ? body.documents : [];
}

/**
 * The saved document as the edit view loads it (Payload's `getDocumentData`): `depth=0`, the
 * latest draft, no locale fallback. For reloading the form after the assistant changed it.
 */
export async function fetchSavedDocument(
  apiRoute: string,
  ref: { kind: "collection" | "global"; slug: string; id?: string },
  locale?: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ depth: "0", draft: "true", "fallback-locale": "none" });
  if (locale) params.set("locale", locale);
  const base = apiRoute.replace(/\/+$/, "");
  const path =
    ref.kind === "global"
      ? `/globals/${encodeURIComponent(ref.slug)}`
      : `/${encodeURIComponent(ref.slug)}/${encodeURIComponent(ref.id ?? "")}`;
  return request<Record<string, unknown>>(`${base}${path}?${params}`);
}
