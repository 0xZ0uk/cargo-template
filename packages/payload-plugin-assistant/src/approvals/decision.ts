import { MAX_REJECT_REASON_CHARS, REJECTED_TOOL_RESULT } from "./types";

/**
 * The approval decision protocol (#138): the one place that knows how an answer to an approval
 * travels from the card to the tools. The client encodes ({@link encodeDecision}), the server
 * decodes ({@link decodeAnswer}) and asks the decoded answer what it means ({@link isRejection},
 * {@link toolPayload}, {@link reviewOf}). Nothing else reads the wire shape.
 *
 * Plain data, no runtime imports beyond `./types`: shared by the server and the client bundle.
 *
 * Wire shape (the `payload` of a `resume` entry with `status: "resolved"`, README "Resume"):
 *
 * - `{ approved: true, reviewToken? }`: `reviewToken` is the proposal's ({@link ApprovalProposal}
 *   `reviewToken`), echoed back. The server reads the targets again and refuses the batch with
 *   409 `stale` when the token no longer matches.
 * - `{ approved: false, reason? }`
 * - a bare boolean (a client that knows the tool and resolves its `tool-approval` binding).
 * - Legacy, before #138: `{ approved: true, seenUpdatedAt }`. Still decoded, so a tab opened
 *   before a deploy can answer an approval left pending across it; checked as before (the single
 *   document's `updatedAt`, nothing for a write by `where`).
 */

/** The user's answer to one approval, before the batch is sent. */
export interface ApprovalDecision {
  approved: boolean;
  /** Rejections only: sent to the model with the rejection. */
  reason?: string;
  /** Approvals only: the proposal's `reviewToken`, what the card was built from (the server's stale check). */
  reviewToken?: string;
}

/** What an approval answer looks like on the wire. */
export type WireDecision = { approved: true; reviewToken?: string } | { approved: false; reason?: string };

/** A decoded `resume` entry. */
export type ApprovalAnswer =
  | { kind: "approved"; review?: ApprovalReview }
  | { kind: "rejected"; reason?: string }
  /** `status: "cancelled"`: nothing is applied. Its payload, if any, is handed to TanStack unchanged. */
  | { kind: "cancelled"; payload?: unknown }
  /** Resolved with something that isn't an approval answer: handed to TanStack unchanged. */
  | { kind: "other"; payload?: unknown };

/** What an approval says the card showed, for the stale check. */
export type ApprovalReview = { reviewToken: string } | { seenUpdatedAt: string };

export type Decoded<T> = { ok: true; value: T } | { ok: false; error: string };

/** Longest `reviewToken` accepted. The server's are far shorter. */
export const MAX_REVIEW_TOKEN_CHARS = 256;

/**
 * The reject branch of every approval tool's `approvalSchema` (TanStack validates a rejection's
 * payload against it). {@link toolPayload} builds it, so the model reads that the user said no,
 * and why. Approving takes no payload (no approve branch).
 */
export const REJECT_APPROVAL_SCHEMA = {
  type: "object",
  properties: {
    error: { type: "string" },
    reason: { type: "string", maxLength: MAX_REJECT_REASON_CHARS },
  },
  required: ["error"],
  additionalProperties: false,
} as const;

/** The wire payload of a decision. */
export function encodeDecision(decision: ApprovalDecision): WireDecision {
  if (decision.approved) return { approved: true, ...(decision.reviewToken ? { reviewToken: decision.reviewToken } : {}) };
  const reason = decision.reason?.trim();
  return { approved: false, ...(reason ? { reason } : {}) };
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** A `resume` entry's `status` and `payload`, decoded. Errors are the 400's message. */
export function decodeAnswer(status: unknown, payload: unknown): Decoded<ApprovalAnswer> {
  if (status !== "resolved" && status !== "cancelled") return fail('"resume[].status" must be "resolved" or "cancelled"');
  if (status === "cancelled") return { ok: true, value: { kind: "cancelled", ...(payload !== undefined ? { payload } : {}) } };
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined;
  const approved = typeof payload === "boolean" ? payload : typeof envelope?.approved === "boolean" ? envelope.approved : undefined;
  if (approved === undefined) return { ok: true, value: { kind: "other", ...(payload !== undefined ? { payload } : {}) } };
  if (approved) {
    const token = envelope?.reviewToken;
    if (token !== undefined && (typeof token !== "string" || !token || token.length > MAX_REVIEW_TOKEN_CHARS)) {
      return fail('"reviewToken" must be the token of the proposal');
    }
    const seen = envelope?.seenUpdatedAt;
    if (seen !== undefined && (typeof seen !== "string" || seen.length > 64)) return fail('"seenUpdatedAt" must be an ISO date');
    const review: ApprovalReview | undefined =
      typeof token === "string" ? { reviewToken: token } : typeof seen === "string" && seen ? { seenUpdatedAt: seen } : undefined;
    return { ok: true, value: { kind: "approved", ...(review ? { review } : {}) } };
  }
  const reason = envelope?.reason;
  if (reason !== undefined && reason !== null && typeof reason !== "string") return fail('"reason" must be text');
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length > MAX_REJECT_REASON_CHARS) return fail(`"reason" is longer than ${MAX_REJECT_REASON_CHARS} characters`);
  return { ok: true, value: { kind: "rejected", ...(text ? { reason: text } : {}) } };
}

/** An answer that applies nothing: a rejection or a cancellation. */
export const isRejection = (answer: ApprovalAnswer): boolean => answer.kind === "rejected" || answer.kind === "cancelled";

/** What the card showed, when the answer approves and says so. */
export const reviewOf = (answer: ApprovalAnswer): ApprovalReview | undefined => (answer.kind === "approved" ? answer.review : undefined);

/**
 * The `payload` TanStack resumes the interrupt with: the server owns what reaches the tools.
 * An approval is `{ approved: true }` (edited arguments are not accepted: the user approves what
 * the card showed); a rejection is `{ approved: false, payload }` with the
 * {@link REJECT_APPROVAL_SCHEMA} payload, which becomes the denied call's tool result. Anything
 * else passes through unchanged.
 */
export function toolPayload(answer: ApprovalAnswer): unknown {
  switch (answer.kind) {
    case "approved":
      return { approved: true };
    case "rejected":
      return { approved: false, payload: { error: REJECTED_TOOL_RESULT, ...(answer.reason ? { reason: answer.reason } : {}) } };
    case "cancelled":
    case "other":
      return answer.payload;
  }
}
