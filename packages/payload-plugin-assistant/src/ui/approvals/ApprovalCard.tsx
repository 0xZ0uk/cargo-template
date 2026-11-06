"use client";

import { Banner, Button, Link, Pill, ShimmerEffect } from "@payloadcms/ui";
import React, { useId, useState } from "react";
import type { ApprovalAction, ApprovalProposal, ProposalItem } from "../../approvals/types";
import { MAX_REJECT_REASON_CHARS } from "../../approvals/types";
import type { ApprovalCardStatus, ApprovalRendererProps, PendingApproval } from "../ApprovalControl";
import { formatToolResult } from "../tools";
import { ChangeList } from "./ChangeList";

const ACTION_LABEL: Record<ApprovalAction, string> = {
  update: "Update",
  create: "Create",
  delete: "Delete",
  restore: "Restore version",
  duplicate: "Duplicate",
  other: "Change",
};

const STATUS: Record<ApprovalCardStatus, { label: string; pill: "warning" | "light" | "success" | "error" | "light-gray" }> = {
  pending: { label: "Waiting for you", pill: "warning" },
  decided: { label: "Answered", pill: "light" },
  submitting: { label: "Sending…", pill: "light" },
  applied: { label: "Applied", pill: "success" },
  rejected: { label: "Rejected", pill: "light-gray" },
  failed: { label: "Failed", pill: "error" },
  unknown: { label: "No result", pill: "light-gray" },
};

function summary(proposal: ApprovalProposal): string {
  const what = proposal.target?.label ?? "content";
  const many = proposal.matchedDocs ?? proposal.items.length;
  switch (proposal.action) {
    case "create":
      return many > 1 ? `Create ${many} documents in ${what}` : `Create a ${what}`;
    case "update":
      if (proposal.target?.kind === "global") return `Update ${what}`;
      return proposal.matchedDocs !== undefined ? `Update ${many} ${many === 1 ? "document" : "documents"} in ${what}` : `Update ${what}`;
    case "delete":
      return proposal.matchedDocs !== undefined ? `Delete ${many} ${many === 1 ? "document" : "documents"} from ${what}` : `Delete ${what}`;
    case "restore":
      return `Restore an older version of ${what}`;
    case "duplicate":
      return `Duplicate ${what}`;
    default:
      return `Run ${proposal.toolName} on ${what}`;
  }
}

function DocumentTitle({ item, approval }: { item: ProposalItem; approval: PendingApproval }) {
  const doc = item.document;
  if (!doc) return null;
  const href = doc.id ? approval.documentHref?.(doc.id) : undefined;
  return (
    <p className="assistant-approval-card__doc assistant-text">
      {href ? (
        <Link className="assistant-link" href={href} prefetch={false}>
          {doc.title}
        </Link>
      ) : (
        <strong>{doc.title}</strong>
      )}
      {doc.status ? (
        <span className="assistant-text assistant-text--tertiary assistant-text--small"> · {doc.status}</span>
      ) : null}
    </p>
  );
}

/** The change itself: per document, its title (linked) and the field diff. */
function ProposalBody({ proposal, approval }: { proposal: ApprovalProposal; approval: PendingApproval }) {
  const shown = proposal.items.length;
  return (
    <div className="assistant-approval-card__items">
      {proposal.notice ? <Banner type="warning">{proposal.notice}</Banner> : null}
      {proposal.action === "delete" && shown ? (
        <p className="assistant-text assistant-text--small">
          {shown === 1 ? "This document and its values will be deleted:" : "These documents and their values will be deleted:"}
        </p>
      ) : null}
      {proposal.items.map((item, index) => (
        <section className="assistant-approval-card__item" key={item.document?.id || index}>
          <DocumentTitle approval={approval} item={item} />
          {!item.document && proposal.action === "create" && shown > 1 ? (
            <p className="assistant-text assistant-text--secondary assistant-text--small">Document {index + 1}</p>
          ) : null}
          <ChangeList action={proposal.action} changes={item.changes} omitted={item.omittedChanges} />
        </section>
      ))}
      {proposal.matchedDocs !== undefined && proposal.matchedDocs > shown ? (
        <p className="assistant-text assistant-text--tertiary assistant-text--small">
          {proposal.matchedDocs} documents match; the first {shown} are shown.
        </p>
      ) : null}
    </div>
  );
}

/** When the proposal couldn't be loaded: the tool input, whole and scrollable. */
function RawInput({ approval }: { approval: PendingApproval }) {
  const text = approval.input ? formatToolResult(approval.input, Number.POSITIVE_INFINITY).text : "";
  return (
    <div className="assistant-approval-card__items">
      <p className="assistant-text assistant-text--secondary assistant-text--small">
        The change could not be prepared for review. This is what the assistant sent:
      </p>
      {text ? (
        <pre className="assistant-pre" tabIndex={0}>
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function Outcome({ approval }: { approval: PendingApproval }) {
  switch (approval.status) {
    case "submitting":
      return (
        <p className="assistant-text assistant-text--secondary assistant-text--small" role="status">
          {approval.decision?.approved ? "Applying…" : "Rejecting…"}
        </p>
      );
    case "applied":
      return (
        <p className="assistant-text assistant-text--small" role="status">
          {approval.proposal?.draft ? "Applied, saved as a draft." : "Applied."}
        </p>
      );
    case "rejected":
      return (
        <p className="assistant-text assistant-text--small" role="status">
          Rejected: nothing was written.
          {approval.outcomeMessage ? <> Your reason, sent to the assistant: “{approval.outcomeMessage}”</> : null}
        </p>
      );
    case "failed":
      return (
        <Banner type="danger">
          The change was approved but could not be applied{approval.outcomeMessage ? `: ${approval.outcomeMessage}` : "."}
        </Banner>
      );
    case "unknown":
      return (
        <p className="assistant-text assistant-text--secondary assistant-text--small" role="status">
          The run ended before the change reported a result. Check the document.
        </p>
      );
    default:
      return null;
  }
}

/**
 * The approval card (#65): what the assistant wants to write, as a diff, and the answer.
 *
 * - Pending: Approve, or Reject with an optional reason for the model. A document that changed
 *   since the proposal (or since the card showed it) asks to confirm again.
 * - Answered, while other approvals of the batch wait: says so, with Undo.
 * - Sent: the outcome from the tool result (applied, rejected, failed with the error).
 */
export function ApprovalCard({ approval }: ApprovalRendererProps) {
  const [rejecting, setRejecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const titleId = useId();
  const status = approval.status ?? "pending";
  const proposal = approval.proposal;
  const changed = Boolean(proposal?.changedSinceProposal || approval.staleReview);
  // A diff that couldn't be loaded is approved blind: ask for an explicit confirmation first.
  const unseen = proposal === null;
  const action = proposal?.action ?? "other";
  const statusInfo = STATUS[status];
  const canAnswer = approval.canAnswer && status === "pending";

  const approve = () => {
    if ((changed || unseen) && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    approval.approve();
  };

  return (
    <article aria-labelledby={titleId} className="assistant-approval-card" data-action={action} data-status={status}>
      <header className="assistant-approval-card__header">
        <Pill pillStyle={action === "delete" ? "error" : "light"} size="small">
          {ACTION_LABEL[action]}
        </Pill>
        <h3 className="assistant-approval-card__title assistant-text" id={titleId}>
          {proposal ? summary(proposal) : `The assistant wants to run ${approval.toolName}`}
        </h3>
        {proposal?.draft ? (
          <Pill pillStyle="light-gray" size="small">
            Draft
          </Pill>
        ) : null}
        <span className="assistant-spacer" />
        <Pill pillStyle={statusInfo.pill} size="small">
          {statusInfo.label}
        </Pill>
      </header>

      {approval.staleReview && status === "pending" ? (
        <Banner type="warning">
          This document changed after you reviewed the change. The diff below is against the current version: check it and
          answer again.
        </Banner>
      ) : proposal?.changedSinceProposal && status === "pending" ? (
        <Banner type="warning">
          This document changed after the assistant proposed this. The diff below is against the current version.
        </Banner>
      ) : null}

      {proposal === undefined ? (
        <div aria-busy="true" aria-label="Loading the change" className="assistant-approval-card__items">
          <ShimmerEffect height={64} />
        </div>
      ) : proposal === null ? (
        <RawInput approval={approval} />
      ) : (
        <ProposalBody approval={approval} proposal={proposal} />
      )}

      <footer className="assistant-approval-card__footer">
        {status === "pending" && rejecting ? (
          <form
            className="assistant-approval-card__reject"
            onSubmit={(event) => {
              event.preventDefault();
              setRejecting(false);
              approval.reject(reason.trim() || undefined);
            }}
          >
            <label className="assistant-text assistant-text--small" htmlFor={reasonId}>
              Why not? (optional, sent to the assistant)
            </label>
            <textarea
              className="assistant-textarea"
              id={reasonId}
              maxLength={MAX_REJECT_REASON_CHARS}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              value={reason}
            />
            <div className="assistant-row">
              <Button buttonStyle="primary" disabled={!canAnswer} margin={false} type="submit">
                Reject change
              </Button>
              <Button buttonStyle="secondary" margin={false} onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : status === "pending" ? (
          <>
            {confirming ? (
              <p className="assistant-text assistant-text--small" role="alert">
                {unseen
                  ? "The change could not be shown, so you haven’t seen what it does. Approve it anyway?"
                  : "The document changed since this was proposed. Approve this change anyway?"}
              </p>
            ) : null}
            <div className="assistant-row">
              <Button buttonStyle="primary" disabled={!canAnswer || proposal === undefined} margin={false} onClick={approve}>
                {confirming ? "Approve anyway" : "Approve"}
              </Button>
              <Button buttonStyle="secondary" disabled={!canAnswer} margin={false} onClick={() => setRejecting(true)}>
                Reject
              </Button>
              {confirming ? (
                <Button buttonStyle="ghost" margin={false} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </>
        ) : status === "decided" ? (
          <div className="assistant-row">
            <p className="assistant-text assistant-text--small">
              {approval.decision?.approved ? "Approved" : "Rejected"}
              {approval.waitingFor
                ? `: sent with the other answers once ${approval.waitingFor === 1 ? "1 more change has" : `${approval.waitingFor} more changes have`} one.`
                : "."}
            </p>
            {approval.undo ? (
              <Button buttonStyle="ghost" disabled={!approval.canAnswer} margin={false} onClick={approval.undo}>
                Undo
              </Button>
            ) : null}
          </div>
        ) : (
          <Outcome approval={approval} />
        )}
      </footer>
    </article>
  );
}
