/**
 * What the chat shows for an endpoint error (HTTP status + `code`) or a `RUN_ERROR` code
 * (`ASSISTANT_ERROR_CODES`, `src/server/errors.ts`). Pure, so it is unit tested.
 */

export type AssistantNoticeType = "danger" | "warning" | "default";

export interface AssistantNotice {
  type: AssistantNoticeType;
  /** Stable key for tests and for the UI to special-case (e.g. offer a model switch). */
  kind:
    | "stopped"
    | "not_configured"
    | "invalid_key"
    | "out_of_credits"
    | "rate_limited"
    | "model_unavailable"
    | "context_overflow"
    | "not_signed_in"
    | "forbidden"
    | "tools_unavailable"
    | "not_found"
    | "invalid_request"
    | "failed";
  message: string;
}

const NOTICES: Record<AssistantNotice["kind"], Omit<AssistantNotice, "kind">> = {
  stopped: { type: "default", message: "Stopped." },
  not_configured: {
    type: "warning",
    message:
      "The assistant is not configured: no OpenRouter API key is set. Ask an administrator to set OPENROUTER_API_KEY.",
  },
  invalid_key: {
    type: "danger",
    message: "OpenRouter refused the API key. Ask an administrator to check OPENROUTER_API_KEY.",
  },
  out_of_credits: {
    type: "danger",
    message: "The OpenRouter account is out of credits. Ask an administrator to top it up.",
  },
  rate_limited: { type: "warning", message: "Too many requests. Wait a moment and try again." },
  model_unavailable: {
    type: "danger",
    message: "This model is not available right now. Pick another model and try again.",
  },
  context_overflow: {
    type: "warning",
    message: "This conversation is too long for the model. Start a new conversation.",
  },
  not_signed_in: { type: "danger", message: "You are signed out. Sign in again to keep chatting." },
  forbidden: { type: "danger", message: "You don't have access to the assistant." },
  tools_unavailable: {
    type: "warning",
    message: "The assistant could not reach the site's content tools. Try again.",
  },
  not_found: { type: "warning", message: "This conversation no longer exists. Start a new one." },
  invalid_request: { type: "danger", message: "The assistant could not read that request." },
  failed: { type: "danger", message: "Something went wrong. Try again." },
};

const BY_CODE: Record<string, AssistantNotice["kind"]> = {
  stopped: "stopped",
  not_configured: "not_configured",
  openrouter_invalid_key: "invalid_key",
  openrouter_out_of_credits: "out_of_credits",
  openrouter_rate_limited: "rate_limited",
  rate_limited: "rate_limited",
  model_unavailable: "model_unavailable",
  model_not_allowed: "model_unavailable",
  context_overflow: "context_overflow",
  not_signed_in: "not_signed_in",
  unauthorized: "not_signed_in",
  forbidden: "forbidden",
  tools_unavailable: "tools_unavailable",
  not_found: "not_found",
  invalid_body: "invalid_request",
  invalid_query: "invalid_request",
  run_failed: "failed",
};

const BY_STATUS: Record<number, AssistantNotice["kind"]> = {
  400: "invalid_request",
  401: "not_signed_in",
  403: "forbidden",
  404: "not_found",
  429: "rate_limited",
  502: "tools_unavailable",
  503: "not_configured",
};

const notice = (kind: AssistantNotice["kind"]): AssistantNotice => ({ kind, ...NOTICES[kind] });

/** A `RUN_ERROR` from the stream. `message` is the server's, used only for unknown codes. */
export function noticeForRunError(code: string | undefined, message?: string): AssistantNotice {
  const kind = code ? BY_CODE[code] : undefined;
  if (kind) return notice(kind);
  return { ...notice("failed"), ...(message ? { message } : {}) };
}

/** A failed request: the JSON `code` wins, then the status. */
export function noticeForHttpError(status: number | undefined, code?: string): AssistantNotice {
  const kind = (code && BY_CODE[code]) || (status ? BY_STATUS[status] : undefined);
  return notice(kind ?? "failed");
}

/**
 * Any error `useChat` reports. `StreamHttpError` (and our `AssistantApiError`) carry a numeric
 * `status`; the recorded body gives the code. Anything else (a dropped connection that could not
 * be resumed) is a generic failure with its message.
 */
export function noticeForClientError(
  error: unknown,
  recorded?: { status: number; code: string | undefined }
): AssistantNotice {
  const status =
    typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
  if (status !== undefined) {
    const code = recorded && recorded.status === status ? recorded.code : (error as { code?: string }).code;
    return noticeForHttpError(status, typeof code === "string" ? code : undefined);
  }
  const message = error instanceof Error && error.message ? error.message : undefined;
  return { ...notice("failed"), ...(message ? { message: `Something went wrong: ${message}` } : {}) };
}
