import type { ModelMessage, RunAgentResumeItem } from "@tanstack/ai";
import { MAX_REJECT_REASON_CHARS, REJECTED_TOOL_RESULT } from "../approvals/types";

/** Thread and run ids: what a UUID, a nanoid or a TanStack id looks like. Nothing that could break a header. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/** Longest user message, in characters. */
export const MAX_MESSAGE_CHARS = 32_000;
/** Most approval decisions in one resume. */
const MAX_RESUME = 50;

export const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

export type ValidChatRequest = {
  threadId: string;
  runId: string | undefined;
  model: string | undefined;
  messages: ModelMessage[];
  resume: RunAgentResumeItem[] | undefined;
  /** Approvals sent with the `updatedAt` their card showed: checked for a change since (409 `stale`). */
  seen: SeenApproval[];
};

export interface SeenApproval {
  interruptId: string;
  seenUpdatedAt: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The text of a user message's `content`: a string, or AG-UI text parts (`{ type: "text", text }`). */
function userText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") return undefined;
    const { type, text, content: inner } = part as { type?: unknown; text?: unknown; content?: unknown };
    if (type !== "text") return undefined;
    const value = typeof text === "string" ? text : typeof inner === "string" ? inner : undefined;
    if (value === undefined) return undefined;
    parts.push(value);
  }
  return parts.join("\n");
}

/**
 * An approval answer as TanStack resumes it. The admin UI (and scripts) send
 * `{ approved: true, seenUpdatedAt? }` or `{ approved: false, reason? }` (or a bare boolean);
 * the server owns what reaches the tools:
 *
 * - approved → `{ approved: true }`: edited arguments are not accepted, the user approves what
 *   the card showed. `seenUpdatedAt` is taken out for the stale check.
 * - rejected → `{ approved: false, payload: { error, reason? } }`: the reject branch of the
 *   tools' `approvalSchema` (`REJECT_APPROVAL_SCHEMA`); `payload` becomes the denied call's tool
 *   result, so the model reads that the user said no, and why.
 *
 * Anything else (not an approval) passes through unchanged.
 */
function approvalAnswer(payload: unknown): Validation<{ payload: unknown; seenUpdatedAt?: string }> {
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
  const approved = typeof payload === "boolean" ? payload : typeof envelope?.approved === "boolean" ? envelope.approved : undefined;
  if (approved === undefined) return { ok: true, value: { payload } };
  if (approved) {
    const seen = envelope?.seenUpdatedAt;
    if (seen !== undefined && (typeof seen !== "string" || seen.length > 64)) return fail('"seenUpdatedAt" must be an ISO date');
    return { ok: true, value: { payload: { approved: true }, ...(typeof seen === "string" ? { seenUpdatedAt: seen } : {}) } };
  }
  const reason = envelope?.reason;
  if (reason !== undefined && reason !== null && typeof reason !== "string") return fail('"reason" must be text');
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length > MAX_REJECT_REASON_CHARS) return fail(`"reason" is longer than ${MAX_REJECT_REASON_CHARS} characters`);
  return { ok: true, value: { payload: { approved: false, payload: { error: REJECTED_TOOL_RESULT, ...(text ? { reason: text } : {}) } } } };
}

function resumeItems(value: unknown): Validation<{ items: RunAgentResumeItem[]; seen: SeenApproval[] } | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESUME) {
    return fail(`"resume" must be a non-empty array of at most ${MAX_RESUME} decisions`);
  }
  const items: RunAgentResumeItem[] = [];
  const seen: SeenApproval[] = [];
  for (const item of value) {
    const { interruptId, status, payload } = (item ?? {}) as Record<string, unknown>;
    if (typeof interruptId !== "string" || !interruptId || interruptId.length > 256) {
      return fail('every "resume" entry needs an "interruptId"');
    }
    if (status !== "resolved" && status !== "cancelled") {
      return fail('"resume[].status" must be "resolved" or "cancelled"');
    }
    if (status === "cancelled" || payload === undefined) {
      items.push({ interruptId, status, ...(payload !== undefined ? { payload } : {}) } as RunAgentResumeItem);
      continue;
    }
    const answer = approvalAnswer(payload);
    if (!answer.ok) return answer;
    if (answer.value.seenUpdatedAt) seen.push({ interruptId, seenUpdatedAt: answer.value.seenUpdatedAt });
    items.push({ interruptId, status, payload: answer.value.payload } as RunAgentResumeItem);
  }
  return { ok: true, value: { items, seen } };
}

/**
 * The chat request body. Accepts what `useChat`'s `fetchServerSentEvents` sends (AG-UI
 * `RunAgentInput`: `threadId`, `runId`, `messages`, `resume`, `forwardedProps.model`) and a short
 * form for scripts (`{ threadId, message: "…", model }`).
 *
 * The stored transcript is the history (server-authoritative): only the **last** message of
 * `messages` is used, and it must be the user's. Earlier messages, assistant messages and tool
 * results from the client are ignored, so a client can't rewrite what the model said or what a
 * tool returned. A resume (`resume` set) takes no message at all.
 */
export function validateChatBody(raw: unknown, headerRunId: string | null): Validation<ValidChatRequest> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("the body must be a JSON object");
  const body = raw as Record<string, unknown>;

  if (!isId(body.threadId)) return fail('"threadId" is required: letters, digits, "_", ".", ":" or "-", at most 128');

  const runId = body.runId ?? headerRunId ?? undefined;
  if (runId !== undefined && !isId(runId)) return fail('"runId" (or X-Run-Id) has the same format as "threadId"');

  const forwarded = body.forwardedProps && typeof body.forwardedProps === "object" ? (body.forwardedProps as Record<string, unknown>) : {};
  const model = body.model ?? forwarded.model;
  if (model !== undefined && (typeof model !== "string" || !model)) return fail('"model" must be a model id');

  const resume = resumeItems(body.resume);
  if (!resume.ok) return resume;

  let messages: ModelMessage[] = [];
  if (!resume.value) {
    let id: string | undefined;
    let content: string | undefined;
    if (typeof body.message === "string") {
      content = body.message;
    } else if (Array.isArray(body.messages) && body.messages.length > 0) {
      const last = body.messages[body.messages.length - 1] as Record<string, unknown> | null;
      if (!last || last.role !== "user") return fail('the last of "messages" must be the user\'s new message');
      content = userText(last.content);
      if (content === undefined) return fail("only text messages are supported");
      if (last.id !== undefined) {
        if (!isId(last.id)) return fail("message ids have the same format as \"threadId\"");
        id = last.id;
      }
    } else {
      return fail('send the user\'s message ("messages" or "message"), or "resume" decisions');
    }
    if (!content.trim()) return fail("the message is empty");
    if (content.length > MAX_MESSAGE_CHARS) return fail(`the message is longer than ${MAX_MESSAGE_CHARS} characters`);
    // Always an id: the stored message keeps it, so hydration gives stable ids (React keys, and
    // the merge's reload cutoff) instead of a new random one on every read.
    messages = [{ role: "user", content, id: id ?? `msg-${crypto.randomUUID()}` } as ModelMessage];
  }

  return {
    ok: true,
    value: {
      threadId: body.threadId,
      runId: runId as string | undefined,
      model: model as string | undefined,
      messages,
      resume: resume.value?.items,
      seen: resume.value?.seen ?? [],
    },
  };
}
