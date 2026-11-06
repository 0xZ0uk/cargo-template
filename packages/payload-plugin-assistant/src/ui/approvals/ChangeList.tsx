"use client";

import React from "react";
import type { ApprovalAction, FieldChange } from "../../approvals/types";
import { MAX_VALUE_CHARS } from "../../approvals/diff";

function Value({ side, text, format, label }: { side: "before" | "after"; text: string; format: FieldChange["format"]; label: string }) {
  return (
    <div className={`assistant-diff__side assistant-diff__side--${side}`}>
      <span className="assistant-diff__side-label">{label}</span>
      {/* Scrollable and focusable: long values (rich text, JSON) are shown whole, not cut. */}
      <div
        aria-label={`${label}: ${format === "richText" ? "rich text" : "value"}`}
        className={`assistant-diff__value assistant-diff__value--${format}`}
        role="region"
        tabIndex={0}
      >
        {text}
      </div>
    </div>
  );
}

/** Labels of the before/after sides, worded for the action. */
function sideLabels(action: ApprovalAction): { before: string; after: string } {
  switch (action) {
    case "delete":
      return { before: "Will be lost", after: "After" };
    case "create":
    case "duplicate":
      return { before: "Before", after: "Value" };
    case "restore":
      return { before: "Current", after: "Restored" };
    default:
      return { before: "Before", after: "After" };
  }
}

export interface ChangeListProps {
  changes: ReadonlyArray<FieldChange>;
  action: ApprovalAction;
  omitted?: number;
}

/**
 * The fields a write changes, one by one: the value before (struck through) and after. Rich
 * text arrives as readable text (the server converts Lexical), never JSON.
 */
export function ChangeList({ changes, action, omitted }: ChangeListProps) {
  const labels = sideLabels(action);
  if (!changes.length) {
    return (
      <p className="assistant-text assistant-text--secondary assistant-text--small">
        {action === "delete" ? "No field values to show." : "No visible change: the values are the same as now."}
      </p>
    );
  }
  return (
    <>
      <dl className="assistant-diff">
        {changes.map((change) => (
          <div className="assistant-diff__field" data-kind={change.kind} key={change.path}>
            <dt className="assistant-diff__label">
              <span>{change.label}</span>
              {change.format === "richText" ? <span className="assistant-diff__hint">rich text</span> : null}
              {change.kind === "added" && action === "update" ? <span className="assistant-diff__hint">new</span> : null}
              {change.kind === "removed" && action !== "delete" ? <span className="assistant-diff__hint">cleared</span> : null}
            </dt>
            <dd className="assistant-diff__values">
              {change.before !== undefined ? (
                <Value format={change.format} label={labels.before} side="before" text={change.before} />
              ) : null}
              {change.after !== undefined ? (
                <Value format={change.format} label={labels.after} side="after" text={change.after} />
              ) : null}
              {change.truncated ? (
                <p className="assistant-text assistant-text--tertiary assistant-text--small">
                  Shortened for display: this value is longer than {MAX_VALUE_CHARS.toLocaleString("en")} characters.
                </p>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {omitted ? (
        <p className="assistant-text assistant-text--tertiary assistant-text--small">
          And {omitted} more {omitted === 1 ? "field" : "fields"} not shown.
        </p>
      ) : null}
    </>
  );
}
