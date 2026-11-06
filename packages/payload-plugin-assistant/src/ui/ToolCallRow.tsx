"use client";

import { Collapsible, Link, Pill } from "@payloadcms/ui";
import React from "react";
import type { DocumentRef, ToolCallLike, ToolResultLike, ToolStatus } from "./tools";
import { formatToolResult, TOOL_STATUS_LABEL, toolStatus, toolTarget } from "./tools";

const PILL_STYLE: Record<ToolStatus, "light" | "warning" | "success" | "error" | "light-gray"> = {
  running: "light",
  "awaiting-approval": "warning",
  done: "success",
  error: "error",
  denied: "light-gray",
  cancelled: "light-gray",
};

export interface ToolCallRowProps {
  call: ToolCallLike;
  result?: ToolResultLike;
  documents: DocumentRef[];
  /** Admin URL of a document reference. */
  hrefFor: (ref: DocumentRef) => string;
}

/**
 * One tool call, compact: tool, collection, status, links to the documents it touched; the
 * result (bounded, pretty-printed) in a collapsed section.
 */
export function ToolCallRow({ call, result, documents, hrefFor }: ToolCallRowProps) {
  const status = toolStatus(call, result);
  const target = toolTarget(call);
  const output = result?.content ?? call.output ?? result?.error;
  const formatted = output !== undefined ? formatToolResult(output) : undefined;

  return (
    <div className="assistant-tool" data-status={status}>
      <div className="assistant-tool__row">
        <code className="assistant-tool__name">{call.name}</code>
        {target ? (
          <span className="assistant-text assistant-text--secondary assistant-text--small">{target}</span>
        ) : null}
        <span className="assistant-spacer" />
        <Pill pillStyle={PILL_STYLE[status]} size="small">
          {TOOL_STATUS_LABEL[status]}
        </Pill>
      </div>
      {documents.length ? (
        <ul aria-label="Documents" className="assistant-tool__docs">
          {documents.map((ref) => (
            <li key={`${ref.kind}:${ref.slug}:${ref.id ?? ""}`}>
              <Link className="assistant-link" href={hrefFor(ref)} prefetch={false}>
                {ref.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {formatted && formatted.text ? (
        <Collapsible
          className="assistant-tool__result"
          header={<span className="assistant-text assistant-text--small">Result</span>}
          initCollapsed
        >
          <pre className="assistant-pre">{formatted.text}</pre>
          {formatted.truncated ? (
            <p className="assistant-text assistant-text--tertiary assistant-text--small">Shortened for display.</p>
          ) : null}
        </Collapsible>
      ) : null}
    </div>
  );
}
