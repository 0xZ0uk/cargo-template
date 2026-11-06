"use client";

import { Banner, Button, Collapsible } from "@payloadcms/ui";
import React from "react";
import type { ApprovalProposal } from "../approvals/types";
import { formatToolResult, toolTarget } from "./tools";

/** The user's answer to one approval, before the batch is sent. */
export interface ApprovalDecision {
  approved: boolean;
  /** Rejections only: sent to the model with the rejection. */
  reason?: string;
  /** Approvals only: the document's `updatedAt` the diff showed (the server's stale check). */
  seenUpdatedAt?: string;
}

/**
 * Where a card is: waiting for an answer, answered (the batch waits for the others), being sent,
 * then the outcome from the tool result (`unknown` when the run ended without one).
 */
export type ApprovalCardStatus = "pending" | "decided" | "submitting" | "applied" | "rejected" | "failed" | "unknown";

/**
 * A pending approval as the chat hands it to the renderer: what the tool would do and the two
 * answers. Built from `useChat`'s bound interrupt (`kind: "tool-approval"`), so a renderer never
 * touches `@tanstack/ai-client` types.
 */
export interface PendingApproval {
  /** The interrupt id (stable key). */
  id: string;
  toolName: string;
  toolCallId: string;
  /** What the tool would write (`metadata.input` / `originalArgs`): the diff source for #65. */
  input: Record<string, unknown> | undefined;
  /** The collection or global (`input.slug`). */
  target: string | undefined;
  /** False while the answer is being submitted, or when the client can't resolve it. */
  canAnswer: boolean;
  approve: () => void;
  /** Reject; the reason (optional) goes back to the model with the rejection. */
  reject: (reason?: string) => void;

  // Set by the chat for the diff card (#65); a custom renderer may ignore them.
  /** What the write would change. `undefined` while loading, `null` when it couldn't be loaded. */
  proposal?: ApprovalProposal | null;
  status?: ApprovalCardStatus;
  /** The answer given (status `decided`, `submitting` and after). */
  decision?: ApprovalDecision;
  /** A failed write's error, or a rejection's reason. */
  outcomeMessage?: string;
  /** The server refused the answer: the document changed after the card showed it. */
  staleReview?: boolean;
  /** Other approvals of the batch still without an answer (answers are sent together). */
  waitingFor?: number;
  /** Take the answer back while the batch hasn't been sent. */
  undo?: () => void;
  /** The edit view of a document of the target collection, when it is in the admin config. */
  documentHref?: (id: string) => string | undefined;
}

export interface ApprovalRendererProps {
  approval: PendingApproval;
}

/** Swappable: #65 replaces this with the full diff card through `AssistantChat`'s `ApprovalComponent`. */
export type ApprovalRenderer = React.ComponentType<ApprovalRendererProps>;

/**
 * Builds a {@link PendingApproval} from a bound interrupt; anything else gives `null`.
 *
 * The browser has no definitions of the server's MCP tools, so `@tanstack/ai-client` can't match
 * the server's `tool-approval` binding to a local tool and binds the interrupt as `generic`: it is
 * answered with the payload of its response schema, `{ approved }` (the README's resume body). A
 * client that does know the tool gets `kind: "tool-approval"` and `resolveInterrupt(approved)`;
 * both are handled.
 */
export function pendingApprovalFrom(interrupt: unknown): PendingApproval | null {
  const i = interrupt as {
    id?: string;
    kind?: string;
    toolName?: string;
    toolCallId?: string;
    originalArgs?: unknown;
    metadata?: { kind?: unknown; input?: unknown; toolName?: unknown };
    status?: string;
    canResolve?: boolean;
    resolveInterrupt?: (answer: unknown) => void;
  };
  if (!i || typeof i.resolveInterrupt !== "function") return null;
  const isToolApproval = i.kind === "tool-approval";
  const isGenericApproval = i.kind === "generic" && i.metadata?.kind === "approval";
  if (!isToolApproval && !isGenericApproval) return null;

  const rawInput = i.metadata?.input ?? i.originalArgs;
  const input = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : undefined;
  const toolName = i.toolName ?? (typeof i.metadata?.toolName === "string" ? i.metadata.toolName : undefined) ?? "tool";
  const answer = (approved: boolean, reason?: string) => answerInterrupt(i, { approved, ...(reason ? { reason } : {}) });
  return {
    id: i.id ?? i.toolCallId ?? toolName,
    toolName,
    toolCallId: i.toolCallId ?? "",
    input,
    target: toolTarget({ id: "", name: toolName, input }),
    canAnswer: i.canResolve !== false && (i.status === undefined || i.status === "pending" || i.status === "error"),
    approve: () => answer(true),
    reject: (reason?: string) => answer(false, reason),
  };
}

/**
 * Answers a bound approval interrupt. A `generic` one (the browser has no tool definitions) is
 * resolved with the README's resume payload: `{ approved: true, seenUpdatedAt? }` or
 * `{ approved: false, reason? }`; the server turns it into what the tools take. A `tool-approval`
 * one (a client that knows the tool) takes the boolean only.
 */
export function answerInterrupt(interrupt: unknown, decision: ApprovalDecision): void {
  const i = interrupt as { kind?: string; resolveInterrupt?: (answer: unknown) => void };
  if (typeof i?.resolveInterrupt !== "function") return;
  if (i.kind === "tool-approval") {
    i.resolveInterrupt(decision.approved);
    return;
  }
  const payload = decision.approved
    ? { approved: true, ...(decision.seenUpdatedAt ? { seenUpdatedAt: decision.seenUpdatedAt } : {}) }
    : { approved: false, ...(decision.reason ? { reason: decision.reason } : {}) };
  i.resolveInterrupt.call(i, payload);
}

const VERB: Record<string, string> = {
  createDocuments: "create documents in",
  createDocument: "create a document in",
  updateDocument: "update a document in",
  updateDocuments: "update documents in",
  deleteDocuments: "delete documents from",
  deleteDocument: "delete a document from",
  duplicateDocument: "duplicate a document in",
  restoreVersion: "restore a version in",
  updateGlobal: "update the global",
};

/**
 * The minimal approve/reject control: the tool, its target and its input (collapsed). The chat
 * uses the diff card (`ApprovalCard`); this stays for custom setups that want less.
 */
export function ApprovalControl({ approval }: ApprovalRendererProps) {
  const verb = VERB[approval.toolName];
  const formatted = approval.input ? formatToolResult(approval.input) : undefined;
  const input = formatted?.text ?? "";
  return (
    <Banner className="assistant-approval" type="warning">
      <div className="assistant-approval__body">
        <p className="assistant-text">
          The assistant wants to {verb ?? `run ${approval.toolName} on`}{" "}
          <strong>{approval.target ?? "your content"}</strong>
          {typeof approval.input?.id === "string" || typeof approval.input?.id === "number" ? (
            <>
              {" "}
              (id <code>{String(approval.input.id)}</code>)
            </>
          ) : null}
          .
        </p>
        {input ? (
          <Collapsible header={<span className="assistant-text assistant-text--small">Details</span>} initCollapsed>
            <pre className="assistant-pre">{input}</pre>
            {formatted?.truncated ? (
              <p className="assistant-text assistant-text--tertiary assistant-text--small">
                Shortened for display: the full change is longer than this.
              </p>
            ) : null}
          </Collapsible>
        ) : null}
        <div className="assistant-row">
          <Button buttonStyle="primary" disabled={!approval.canAnswer} margin={false} onClick={approval.approve}>
            Approve
          </Button>
          <Button buttonStyle="secondary" disabled={!approval.canAnswer} margin={false} onClick={() => approval.reject()}>
            Reject
          </Button>
        </div>
      </div>
    </Banner>
  );
}
