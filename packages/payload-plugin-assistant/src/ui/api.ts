/**
 * The admin UI's side of the endpoint contract (README, "Endpoints"). Plain `fetch` with the
 * admin session cookie (`credentials: "same-origin"`); no Payload or server imports, so it is
 * safe in the client bundle.
 */

export interface AssistantModelOption {
  id: string;
  label: string;
}

export interface AssistantClientConfig {
  configured: boolean;
  models: AssistantModelOption[];
  defaultModel: string;
  maxSteps: number;
}

export interface ConversationSummary {
  threadId: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

/** An endpoint's JSON error (`{ error, code }`) with its HTTP status. */
export class AssistantApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "AssistantApiError";
    this.status = status;
    this.code = code;
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
  try {
    const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
    if (typeof body?.code === "string") code = body.code;
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // Not JSON (a proxy's HTML error page): keep the status.
  }
  return new AssistantApiError(response.status, code, message);
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

export function renameConversation(apiRoute: string, threadId: string, title: string) {
  return request<{ threadId: string; title: string }>(
    assistantUrl(apiRoute, `/conversations/${encodeURIComponent(threadId)}`),
    { method: "PATCH", body: JSON.stringify({ title }) }
  );
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
