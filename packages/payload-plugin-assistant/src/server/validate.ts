import type { ModelMessage, RunAgentResumeItem } from "@tanstack/ai";
import { decodeAnswer, toolPayload, type ApprovalAnswer } from "../approvals/decision";
import { MAX_REFERENCES, parseReferenceInput, type DocumentReferenceInput } from "../references";

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
  /** What TanStack resumes with: the tools' payloads ({@link toolPayload}), never the client's. */
  resume: RunAgentResumeItem[] | undefined;
  /** The same entries, decoded: what the user answered (rejections, the stale check's review tokens). */
  answers: ResumeAnswer[];
  /** The document the conversation is about (sent from an edit view), unresolved. */
  context: DocumentReferenceInput | undefined;
  /** Documents mentioned with `@`, unresolved. */
  references: DocumentReferenceInput[];
};

export interface ResumeAnswer {
  interruptId: string;
  answer: ApprovalAnswer;
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

function resumeItems(value: unknown): Validation<{ items: RunAgentResumeItem[]; answers: ResumeAnswer[] } | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESUME) {
    return fail(`"resume" must be a non-empty array of at most ${MAX_RESUME} decisions`);
  }
  const items: RunAgentResumeItem[] = [];
  const answers: ResumeAnswer[] = [];
  for (const item of value) {
    const { interruptId, status, payload } = (item ?? {}) as Record<string, unknown>;
    if (typeof interruptId !== "string" || !interruptId || interruptId.length > 256) {
      return fail('every "resume" entry needs an "interruptId"');
    }
    // The decision protocol (`approvals/decision.ts`): what the client sent, decoded once.
    const answer = decodeAnswer(status, payload);
    if (!answer.ok) return answer;
    answers.push({ interruptId, answer: answer.value });
    const toTools = toolPayload(answer.value);
    items.push({ interruptId, status, ...(toTools !== undefined ? { payload: toTools } : {}) } as RunAgentResumeItem);
  }
  return { ok: true, value: { items, answers } };
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

  // Document references (#69): `context` and `references`, top level (scripts) or in
  // `forwardedProps` (what `useChat` sends). Shape only here; the endpoint resolves them as the user.
  // AG-UI's own top-level `context` is an array (agent context entries), never a document: skip it.
  const rawContext = forwarded.context ?? (Array.isArray(body.context) ? undefined : body.context);
  const rawReferences = forwarded.references ?? body.references;
  let context: DocumentReferenceInput | undefined;
  const references: DocumentReferenceInput[] = [];
  if (rawContext !== undefined && rawContext !== null) {
    context = parseReferenceInput(rawContext);
    if (!context) return fail('"context" must be { kind: "collection", slug, id } or { kind: "global", slug }');
  }
  if (rawReferences !== undefined && rawReferences !== null) {
    if (!Array.isArray(rawReferences) || rawReferences.length > MAX_REFERENCES) {
      return fail(`"references" must be an array of at most ${MAX_REFERENCES} documents`);
    }
    for (const raw of rawReferences) {
      const ref = parseReferenceInput(raw);
      if (!ref) return fail('every "references" entry must be { kind: "collection", slug, id } or { kind: "global", slug }');
      references.push(ref);
    }
  }
  if (resume.value && (context || references.length)) return fail('"context" and "references" go with a message, not a resume');

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
      answers: resume.value?.answers ?? [],
      context,
      references,
    },
  };
}
