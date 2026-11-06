import type { StreamChunk } from "@tanstack/ai";
import { AssistantNotSignedInError, AssistantToolDiscoveryError } from "../tools/payloadToolSource";

/**
 * The `code` of every `RUN_ERROR` the assistant sends, so the admin UI can show a message (and
 * pick an action) without parsing provider text. The `message` is already user-facing.
 */
export const ASSISTANT_ERROR_CODES = {
  /** OpenRouter refused the API key (HTTP 401). */
  invalidKey: "openrouter_invalid_key",
  /** The OpenRouter account or key has no credit left (HTTP 402). */
  outOfCredits: "openrouter_out_of_credits",
  /** OpenRouter or the upstream provider rate limited the call (HTTP 429). */
  rateLimited: "openrouter_rate_limited",
  /** No provider can serve the model with these settings (tools, data policy), or it is down. */
  modelUnavailable: "model_unavailable",
  /** The conversation is longer than the model's context window, even after compaction. */
  contextOverflow: "context_overflow",
  /** `/api/mcp` did not accept the forwarded session: sign in again. */
  notSignedIn: "not_signed_in",
  /** Payload's tools could not be listed. */
  toolsUnavailable: "tools_unavailable",
  /** The user stopped the run. */
  stopped: "stopped",
  /** Anything else. */
  failed: "run_failed",
} as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES];

const MESSAGES: Record<AssistantErrorCode, string> = {
  openrouter_invalid_key: "OpenRouter rejected the assistant's API key. Ask an administrator to check OPENROUTER_API_KEY.",
  openrouter_out_of_credits: "The OpenRouter account is out of credits. Ask an administrator to add credits or raise the key's limit.",
  openrouter_rate_limited: "Too many requests to the model right now. Wait a moment and try again.",
  model_unavailable: "This model is not available right now (no provider can serve it with tools and without data collection). Try another model.",
  context_overflow: "This conversation is too long for the model. Start a new conversation.",
  not_signed_in: "The assistant could not act as you: your session was not accepted. Sign in again.",
  tools_unavailable: "The assistant could not reach Payload's tools. Try again in a moment.",
  stopped: "Stopped.",
  run_failed: "The assistant failed to answer. Try again.",
};

type RunErrorLike = {
  type: "RUN_ERROR";
  code?: unknown;
  message?: unknown;
  rawEvent?: unknown;
  error?: { message?: unknown; code?: unknown };
  [key: string]: unknown;
};

/** The HTTP status OpenRouter reported for a failure: `rawEvent.code` (its error body) or a numeric `code`. */
function statusOf(event: RunErrorLike): number | undefined {
  const raw = event.rawEvent as { code?: unknown; error?: { code?: unknown } } | undefined;
  for (const value of [raw?.code, raw?.error?.code, event.code, event.error?.code]) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return undefined;
}

/** Classify a `RUN_ERROR` (from the adapter or `chat()`) into one of {@link ASSISTANT_ERROR_CODES}. */
export function classifyRunError(event: RunErrorLike, stopped: boolean): AssistantErrorCode {
  const code = typeof event.code === "string" ? event.code : typeof event.error?.code === "string" ? event.error.code : undefined;
  if (code && (Object.values(ASSISTANT_ERROR_CODES) as string[]).includes(code)) return code as AssistantErrorCode;
  if (stopped || code === "aborted") return ASSISTANT_ERROR_CODES.stopped;
  if (code === "context_overflow") return ASSISTANT_ERROR_CODES.contextOverflow;
  const status = statusOf(event);
  if (status === 401) return ASSISTANT_ERROR_CODES.invalidKey;
  if (status === 402) return ASSISTANT_ERROR_CODES.outOfCredits;
  if (status === 429) return ASSISTANT_ERROR_CODES.rateLimited;
  const text = `${String(event.message ?? "")} ${String(event.error?.message ?? "")}`;
  if (status === 404 || status === 502 || status === 503 || /no endpoints found|no (available )?(model )?provider|model .*(not|isn't) (found|available)|not a valid model/i.test(text)) {
    return ASSISTANT_ERROR_CODES.modelUnavailable;
  }
  if (/not signed in/i.test(text)) return ASSISTANT_ERROR_CODES.notSignedIn;
  if (/could not list Payload's tools/i.test(text)) return ASSISTANT_ERROR_CODES.toolsUnavailable;
  return ASSISTANT_ERROR_CODES.failed;
}

/** Rewrite a `RUN_ERROR` with the assistant's code and user-facing message. The provider's body stays in `rawEvent`. */
export function mapRunError(event: RunErrorLike, stopped: boolean): StreamChunk {
  const code = classifyRunError(event, stopped);
  const message = MESSAGES[code];
  const raw = event.rawEvent as { metadata?: { retry_after?: unknown } } | undefined;
  return {
    ...event,
    code,
    message,
    error: { message, code },
    ...(code === ASSISTANT_ERROR_CODES.rateLimited && typeof event.retryAfterMs !== "number" && typeof raw?.metadata?.retry_after === "number"
      ? { retryAfterMs: raw.metadata.retry_after * 1000 }
      : {}),
  } as unknown as StreamChunk;
}

/** A `RUN_ERROR` for a thrown error (tool discovery, a crash in `chat()`). */
export function runErrorFromThrown(error: unknown, ids: { threadId: string; runId: string }, stopped: boolean): StreamChunk {
  const code: AssistantErrorCode = stopped
    ? ASSISTANT_ERROR_CODES.stopped
    : error instanceof AssistantNotSignedInError
      ? ASSISTANT_ERROR_CODES.notSignedIn
      : error instanceof AssistantToolDiscoveryError
        ? ASSISTANT_ERROR_CODES.toolsUnavailable
        : classifyRunError({ type: "RUN_ERROR", message: error instanceof Error ? error.message : String(error) }, false);
  return {
    type: "RUN_ERROR",
    ...ids,
    timestamp: Date.now(),
    code,
    message: MESSAGES[code],
    error: { message: MESSAGES[code], code },
  } as unknown as StreamChunk;
}

/**
 * Whether a `RUN_FINISHED` closes the run. `chat()` sends one after **every model call**: with
 * `finishReason: "tool_calls"` (top level, or `metadata.tanstack.finishReason`) the run goes on (tools
 * run, the model is called again). A pause for approval (`outcome.type === "interrupt"`) is final.
 */
function isFinalRunFinished(chunk: StreamChunk): boolean {
  const event = chunk as { outcome?: { type?: unknown }; finishReason?: unknown; metadata?: { tanstack?: { finishReason?: unknown } } };
  if (event.outcome?.type === "interrupt") return true;
  return (event.finishReason ?? event.metadata?.tanstack?.finishReason) !== "tool_calls";
}

/**
 * Pass a turn's stream through, rewriting every `RUN_ERROR` with {@link mapRunError} and turning
 * a thrown error into one. A run ends with exactly one of: its final `RUN_FINISHED`, or one `RUN_ERROR`.
 * A run the user stopped, at any step, always ends with a `RUN_ERROR` whose code is `stopped`,
 * whatever `chat()` emitted for the abort (it returns silently), and anything after it is dropped.
 */
export async function* withAssistantErrors(
  stream: AsyncIterable<StreamChunk>,
  ids: { threadId: string; runId: string },
  signal: AbortSignal
): AsyncIterable<StreamChunk> {
  let errored = false; // a RUN_ERROR went out
  let finished = false; // the final RUN_FINISHED went out
  try {
    for await (const chunk of stream) {
      if (errored) continue; // keep draining (middleware cleanup), but the run has ended
      const type = (chunk as { type: string }).type;
      if (type === "RUN_ERROR") {
        errored = true;
        yield mapRunError(chunk as unknown as RunErrorLike, signal.aborted);
        continue;
      }
      if (type === "RUN_FINISHED") {
        const final = isFinalRunFinished(chunk);
        if (signal.aborted && !finished) {
          // A stop that landed as the run (or one of its model calls) finished: report the stop.
          errored = true;
          yield runErrorFromThrown(undefined, ids, true);
          continue;
        }
        if (final) finished = true;
      }
      yield chunk;
    }
  } catch (error) {
    if (!errored && !finished) {
      errored = true;
      yield runErrorFromThrown(error, ids, signal.aborted);
    }
    return;
  }
  // chat() returns silently on abort, at any step: close the run with the stop.
  if (!errored && !finished && signal.aborted) yield runErrorFromThrown(undefined, ids, true);
}
