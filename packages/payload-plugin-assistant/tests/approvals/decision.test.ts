import { describe, expect, it } from "vitest";

import {
  decodeAnswer,
  encodeDecision,
  isRejection,
  MAX_REVIEW_TOKEN_CHARS,
  REJECT_APPROVAL_SCHEMA,
  reviewOf,
  toolPayload,
  type ApprovalAnswer,
  type ApprovalDecision,
} from "../../src/approvals/decision";
import { MAX_REJECT_REASON_CHARS, REJECTED_TOOL_RESULT } from "../../src/approvals/types";

/** The approval decision protocol (#138): what the card encodes is what the server decodes. */

const roundTrip = (decision: ApprovalDecision) => {
  const decoded = decodeAnswer("resolved", JSON.parse(JSON.stringify(encodeDecision(decision))));
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.value;
};

describe("encode → decode", () => {
  it("an approval with its review token", () => {
    const answer = roundTrip({ approved: true, reviewToken: "where:12:2026-11-03T00:00:00.000Z" });
    expect(answer).toEqual({ kind: "approved", review: { reviewToken: "where:12:2026-11-03T00:00:00.000Z" } });
    expect(isRejection(answer)).toBe(false);
    expect(reviewOf(answer)).toEqual({ reviewToken: "where:12:2026-11-03T00:00:00.000Z" });
  });

  it("an approval without one (no diff could be loaded)", () => {
    const answer = roundTrip({ approved: true });
    expect(answer).toEqual({ kind: "approved" });
    expect(reviewOf(answer)).toBeUndefined();
  });

  it("a rejection with a reason, trimmed; a blank reason is none", () => {
    expect(roundTrip({ approved: false, reason: "  Keep the title.  " })).toEqual({ kind: "rejected", reason: "Keep the title." });
    expect(roundTrip({ approved: false, reason: "   " })).toEqual({ kind: "rejected" });
    expect(isRejection(roundTrip({ approved: false }))).toBe(true);
  });

  it("only what the decision means goes on the wire", () => {
    expect(encodeDecision({ approved: true, reason: "ignored", reviewToken: "t" })).toEqual({ approved: true, reviewToken: "t" });
    expect(encodeDecision({ approved: false, reviewToken: "ignored" })).toEqual({ approved: false });
  });
});

describe("decodeAnswer", () => {
  it("a bare boolean (a client that knows the tool)", () => {
    expect(decodeAnswer("resolved", true)).toEqual({ ok: true, value: { kind: "approved" } });
    expect(decodeAnswer("resolved", false)).toEqual({ ok: true, value: { kind: "rejected" } });
  });

  it("the legacy seenUpdatedAt envelope, for approvals pending across a deploy", () => {
    expect(decodeAnswer("resolved", { approved: true, seenUpdatedAt: "2026-11-01T00:00:00.000Z" })).toEqual({
      ok: true,
      value: { kind: "approved", review: { seenUpdatedAt: "2026-11-01T00:00:00.000Z" } },
    });
    // A token wins when both are sent.
    expect(decodeAnswer("resolved", { approved: true, seenUpdatedAt: "x", reviewToken: "t" })).toMatchObject({ value: { review: { reviewToken: "t" } } });
  });

  it("cancelled, and anything that isn't an approval answer, pass through", () => {
    const cancelled = decodeAnswer("cancelled", undefined);
    expect(cancelled).toEqual({ ok: true, value: { kind: "cancelled" } });
    expect(isRejection((cancelled as { value: ApprovalAnswer }).value)).toBe(true);
    expect(decodeAnswer("resolved", { choice: "b" })).toEqual({ ok: true, value: { kind: "other", payload: { choice: "b" } } });
    expect(decodeAnswer("resolved", undefined)).toEqual({ ok: true, value: { kind: "other" } });
    expect(isRejection({ kind: "other", payload: 1 })).toBe(false);
  });

  it("refuses what it can't trust", () => {
    const errors = [
      decodeAnswer("done", { approved: true }),
      decodeAnswer("resolved", { approved: true, reviewToken: 5 }),
      decodeAnswer("resolved", { approved: true, reviewToken: "" }),
      decodeAnswer("resolved", { approved: true, reviewToken: "x".repeat(MAX_REVIEW_TOKEN_CHARS + 1) }),
      decodeAnswer("resolved", { approved: true, seenUpdatedAt: 5 }),
      decodeAnswer("resolved", { approved: false, reason: 4 }),
      decodeAnswer("resolved", { approved: false, reason: "x".repeat(MAX_REJECT_REASON_CHARS + 1) }),
    ];
    for (const result of errors) expect(result.ok).toBe(false);
  });
});

describe("toolPayload", () => {
  it("an approval approves what the card showed: no arguments, no token", () => {
    expect(toolPayload({ kind: "approved", review: { reviewToken: "t" } })).toEqual({ approved: true });
  });

  it("a rejection is the reject branch the tools' approvalSchema declares", () => {
    const payload = toolPayload({ kind: "rejected", reason: "No." }) as { approved: false; payload: Record<string, unknown> };
    expect(payload).toEqual({ approved: false, payload: { error: REJECTED_TOOL_RESULT, reason: "No." } });
    for (const key of REJECT_APPROVAL_SCHEMA.required) expect(payload.payload).toHaveProperty(key);
    for (const key of Object.keys(payload.payload)) expect(REJECT_APPROVAL_SCHEMA.properties).toHaveProperty(key);
    expect(toolPayload({ kind: "rejected" })).toEqual({ approved: false, payload: { error: REJECTED_TOOL_RESULT } });
  });

  it("other answers are handed on unchanged", () => {
    expect(toolPayload({ kind: "other", payload: { choice: "b" } })).toEqual({ choice: "b" });
    expect(toolPayload({ kind: "cancelled" })).toBeUndefined();
  });
});
