"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalProposal } from "../../approvals/types";
import type { ApprovalCardStatus, ApprovalDecision, PendingApproval } from "../ApprovalControl";
import { answerInterrupt, pendingApprovalFrom } from "../ApprovalControl";
import type { AssistantApiError } from "../api";
import { fetchApprovals, staleInterruptIds } from "../api";
import type { ToolResultLike } from "../tools";
import { parseResult } from "../../toolCalls";
import { toolStatus } from "../tools";

/**
 * The approvals of the open conversation, answered as one batch.
 *
 * TanStack resumes a run's interrupts **all or nothing**: the server validates the complete batch
 * before any tool runs (`incomplete-batch` otherwise), and `@tanstack/ai-client` submits only once
 * every item has an answer. So answers are kept here, per card, and sent together when the last
 * one is given (one card: at once). Until then each card can take its answer back. "Approve all" /
 * "Reject all" answer the rest at once.
 *
 * A refused resume (HTTP error) puts every interrupt back: a 409 `stale` names the approvals whose
 * document changed after their card showed it; those answers are dropped, the proposals reloaded
 * (the card then warns and asks again), the other answers kept. Once sent, a card is kept by its
 * tool call id and shows the outcome from the tool result.
 */

interface ChatLike {
  interrupts: ReadonlyArray<unknown>;
  resuming: boolean;
  resolveInterrupts: (resolver: (interrupt: never) => void) => void;
}

export interface SentApproval {
  approval: PendingApproval;
  decision: ApprovalDecision;
}

export interface ApprovalBatch {
  /** Pending approvals, enriched for the card (proposal, status, answers). */
  pending: PendingApproval[];
  /** A sent approval by tool call id, with its outcome; `undefined` when not one. */
  sent: (toolCallId: string, result: ToolResultLike | undefined, streaming: boolean) => PendingApproval | undefined;
  answered: number;
  approveAll: () => void;
  rejectAll: () => void;
  /**
   * Why "Approve all" can't be used now, or `undefined`: `loading` while a pending change's diff
   * hasn't arrived (approving it would be blind, and send no review token for the stale check);
   * `review` while an unanswered change needs its own confirmation (its document changed, or its
   * diff couldn't be loaded). Reject all is never blocked.
   */
  approveAllBlocked: "loading" | "review" | undefined;
  /** Send the kept answers again after a failed submission. */
  retry: () => void;
  /** The last submission failed (not stale): answers are kept, `retry` resends them. */
  failed: boolean;
  /** The last submission was refused because documents changed. */
  staleCount: number;
}

export interface ApprovalBatchOptions {
  chat: ChatLike;
  apiRoute: string;
  threadId: string;
  /** The last failed HTTP response of the chat connection (`recordingFetch`). */
  lastError: () => AssistantApiError | undefined;
  resetError: () => void;
  documentHref: (slug: string, id: string) => string | undefined;
}

/** An unanswered change that must be confirmed on its own card, never in bulk. */
const needsOwnReview = (proposal: ApprovalProposal | null | undefined, staleReview: boolean) =>
  proposal === null || Boolean(proposal?.changedSinceProposal) || staleReview;

/** The answer for a card: an approval echoes the proposal's review token (the server's stale check). */
const decisionFor = (approved: boolean, proposal: ApprovalProposal | null | undefined): ApprovalDecision =>
  approved ? { approved: true, ...(proposal?.reviewToken ? { reviewToken: proposal.reviewToken } : {}) } : { approved: false };

/** The outcome of a sent approval, from its tool result. */
export function outcomeOf(
  result: ToolResultLike | undefined,
  decision: ApprovalDecision,
  streaming: boolean
): { status: ApprovalCardStatus; message?: string } {
  if (!result) return streaming ? { status: "submitting" } : { status: "unknown" };
  if (result.outcome === "denied") return { status: "rejected", ...(decision.reason ? { message: decision.reason } : {}) };
  if (result.outcome === "cancelled") return { status: "failed", message: "Cancelled." };
  const status = toolStatus({ id: result.toolCallId, name: "", state: "complete" }, result);
  if (status === "error") {
    return { status: "failed", message: result.error ?? parseResult(result.content).error ?? "The change could not be applied." };
  }
  return { status: "applied" };
}

export function useApprovalBatch({ chat, apiRoute, threadId, lastError, resetError, documentHref }: ApprovalBatchOptions): ApprovalBatch {
  const [proposals, setProposals] = useState<ReadonlyMap<string, ApprovalProposal | null>>(new Map());
  const [decisions, setDecisions] = useState<Readonly<Record<string, ApprovalDecision>>>({});
  const [stale, setStale] = useState<ReadonlySet<string>>(new Set());
  const [sentCards, setSentCards] = useState<ReadonlyMap<string, SentApproval>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  /** The interrupt ids of the last submission: if they come back, it was refused. */
  const submitted = useRef<ReadonlySet<string>>(new Set());

  const base = useMemo(
    () =>
      chat.interrupts
        .map((interrupt) => ({ interrupt, approval: pendingApprovalFrom(interrupt) }))
        .filter((entry): entry is { interrupt: unknown; approval: PendingApproval } => entry.approval !== null),
    [chat.interrupts]
  );
  const idsKey = base.map((b) => b.approval.id).join("|");

  // Load what each pending approval would change, as the user, whenever the batch changes.
  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    fetchApprovals(apiRoute, threadId)
      .then((list) => {
        if (cancelled) return;
        const next = new Map<string, ApprovalProposal | null>();
        for (const id of idsKey.split("|")) next.set(id, list.find((p) => p.interruptId === id) ?? null);
        setProposals(next);
      })
      .catch(() => {
        if (!cancelled) setProposals(new Map(idsKey.split("|").map((id) => [id, null])));
      });
    return () => {
      cancelled = true;
    };
  }, [apiRoute, threadId, idsKey, reload]);

  const submit = useCallback(
    (all: Readonly<Record<string, ApprovalDecision>>) => {
      setFailed(false);
      resetError();
      submitted.current = new Set(base.map((b) => b.approval.id));
      setSentCards((current) => {
        const next = new Map(current);
        for (const { approval } of base) {
          const decision = all[approval.id];
          if (decision && approval.toolCallId) next.set(approval.toolCallId, { approval: { ...approval, proposal: proposals.get(approval.id) }, decision });
        }
        return next;
      });
      chat.resolveInterrupts(((interrupt: { id?: string }) => {
        const decision = interrupt.id ? all[interrupt.id] : undefined;
        answerInterrupt(interrupt, decision ?? { approved: false });
      }) as (interrupt: never) => void);
    },
    [base, chat, proposals, resetError]
  );

  const decide = useCallback(
    (id: string, decision: ApprovalDecision | undefined) => {
      const next = { ...decisions };
      if (decision) next[id] = decision;
      else delete next[id];
      setDecisions(next);
      if (decision && stale.has(id)) setStale((s) => new Set([...s].filter((x) => x !== id)));
      if (decision && base.length > 0 && base.every((b) => next[b.approval.id])) submit(next);
    },
    [base, decisions, stale, submit]
  );

  const undecided = base.filter((b) => !decisions[b.approval.id]).length;
  const loading = base.some((b) => !proposals.has(b.approval.id));
  const needsReview = base.some(
    (b) => !decisions[b.approval.id] && needsOwnReview(proposals.get(b.approval.id), stale.has(b.approval.id))
  );
  const approveAllBlocked = loading ? "loading" : needsReview ? "review" : undefined;

  const answerRest = useCallback(
    (approved: boolean) => {
      // Approving what hasn't been seen, or needs its own confirmation, is never done in bulk.
      if (approved && approveAllBlocked) return;
      const next = { ...decisions };
      for (const { approval } of base) next[approval.id] ??= decisionFor(approved, proposals.get(approval.id));
      setDecisions(next);
      setStale(new Set());
      if (base.length) submit(next);
    },
    [base, decisions, proposals, submit, approveAllBlocked]
  );

  // A submission that ended with the interrupts back is a refusal: stale, or a transport error.
  const wasResuming = useRef(chat.resuming);
  useEffect(() => {
    const ended = wasResuming.current && !chat.resuming;
    wasResuming.current = chat.resuming;
    if (!ended) return;
    // The resumed run may pause again on new approvals (other ids): that is not a refusal.
    const back = base.filter((b) => submitted.current.has(b.approval.id));
    submitted.current = new Set();
    if (back.length === 0) return;
    const ids = new Set(back.map((b) => b.approval.id));
    const toolCallIds = new Set(back.map((b) => b.approval.toolCallId));
    setSentCards((current) => new Map([...current].filter(([toolCallId]) => !toolCallIds.has(toolCallId))));
    const staleIds = staleInterruptIds(lastError()).filter((id) => ids.has(id));
    if (staleIds.length) {
      setStale(new Set(staleIds));
      // The old diff is out of date: show the card as loading until the new one arrives.
      setProposals((current) => new Map([...current].filter(([id]) => !staleIds.includes(id))));
      setDecisions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !staleIds.includes(id))));
      setReload((n) => n + 1);
    } else {
      setFailed(true);
    }
  }, [chat.resuming, base, lastError]);

  // Answers of interrupts that are gone (sent, or the conversation moved on) are forgotten.
  useEffect(() => {
    const ids = new Set(idsKey ? idsKey.split("|") : []);
    setDecisions((current) => {
      const kept = Object.entries(current).filter(([id]) => ids.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
    if (!ids.size) {
      setStale(new Set());
      setFailed(false);
    }
  }, [idsKey]);


  const pending = useMemo(
    () =>
      base.map(({ approval }): PendingApproval => {
        const proposal = proposals.has(approval.id) ? proposals.get(approval.id) : undefined;
        const decision = decisions[approval.id];
        const slug = proposal?.target?.kind === "collection" ? proposal.target.slug : undefined;
        return {
          ...approval,
          canAnswer: approval.canAnswer && !chat.resuming,
          proposal,
          status: decision ? "decided" : "pending",
          ...(decision ? { decision } : {}),
          staleReview: stale.has(approval.id),
          waitingFor: decision ? undecided : Math.max(undecided - 1, 0),
          // No diff yet: nothing to approve (the card's button is disabled; this is the guard).
          approve: () => {
            if (proposal !== undefined) decide(approval.id, decisionFor(true, proposal));
          },
          reject: (reason?: string) => decide(approval.id, { approved: false, ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
          undo: () => decide(approval.id, undefined),
          documentHref: (id: string) => (slug ? documentHref(slug, id) : undefined),
        };
      }),
    [base, proposals, decisions, stale, undecided, chat.resuming, decide, documentHref]
  );

  const sent = useCallback(
    (toolCallId: string, result: ToolResultLike | undefined, streaming: boolean): PendingApproval | undefined => {
      const card = sentCards.get(toolCallId);
      if (!card) return undefined;
      const outcome = outcomeOf(result, card.decision, streaming);
      const slug = card.approval.proposal?.target?.kind === "collection" ? card.approval.proposal.target.slug : undefined;
      const deleted = outcome.status === "applied" && card.approval.proposal?.action === "delete";
      return {
        ...card.approval,
        canAnswer: false,
        status: outcome.status,
        decision: card.decision,
        ...(outcome.message ? { outcomeMessage: outcome.message } : {}),
        staleReview: false,
        waitingFor: 0,
        // A deleted document has no edit view any more.
        documentHref: (id: string) => (slug && !deleted ? documentHref(slug, id) : undefined),
      };
    },
    [sentCards, documentHref]
  );

  return {
    pending,
    sent,
    answered: base.length - undecided,
    approveAll: () => answerRest(true),
    rejectAll: () => answerRest(false),
    approveAllBlocked,
    retry: () => submit(decisions),
    failed,
    staleCount: stale.size,
  };
}
