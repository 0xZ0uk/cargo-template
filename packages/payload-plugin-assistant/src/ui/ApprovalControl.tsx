"use client";

import { Banner, Button, Collapsible } from "@payloadcms/ui";
import React from "react";
import { formatToolResult, toolTarget } from "./tools";

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
  reject: () => void;
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
  const resolve = i.resolveInterrupt;
  const answer = (approved: boolean) => resolve.call(i, isToolApproval ? approved : { approved });
  return {
    id: i.id ?? i.toolCallId ?? toolName,
    toolName,
    toolCallId: i.toolCallId ?? "",
    input,
    target: toolTarget({ id: "", name: toolName, input }),
    canAnswer: i.canResolve !== false && (i.status === undefined || i.status === "pending" || i.status === "error"),
    approve: () => answer(true),
    reject: () => answer(false),
  };
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
 * The minimal approve/reject control: the tool, its target and its input (collapsed). #65's diff
 * card replaces it.
 */
export function ApprovalControl({ approval }: ApprovalRendererProps) {
  const verb = VERB[approval.toolName];
  const input = approval.input ? formatToolResult(approval.input).text : "";
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
          </Collapsible>
        ) : null}
        <div className="assistant-row">
          <Button buttonStyle="primary" disabled={!approval.canAnswer} margin={false} onClick={approval.approve}>
            Approve
          </Button>
          <Button buttonStyle="secondary" disabled={!approval.canAnswer} margin={false} onClick={approval.reject}>
            Reject
          </Button>
        </div>
      </div>
    </Banner>
  );
}
