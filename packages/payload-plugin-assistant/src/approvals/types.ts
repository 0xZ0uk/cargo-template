/**
 * The approval proposal: what a pending write would do, ready to show. Built on the server
 * (`GET /api/assistant/approvals`, `src/server/approvals.ts`) from the interrupt and the current
 * document read as the user; the card renders it and never parses tool arguments itself.
 * Plain data, no runtime imports: shared by the server and the client bundle.
 */

/** What the tool does, for the card's wording and layout. */
export type ApprovalAction = "update" | "create" | "delete" | "restore" | "duplicate" | "other";

/** One field, before and after, as display text. */
export interface FieldChange {
  /** Stable path (`meta.title`, `layout.1.heading`): React key and tests. */
  path: string;
  /** Readable label (`Meta › Title`, `Layout › 2 · Hero › Heading`). */
  label: string;
  /** `added`: no value before. `removed`: no value after. */
  kind: "added" | "changed" | "removed";
  /** How to show the values: `richText` was converted from Lexical to readable text. */
  format: "text" | "richText" | "json";
  before?: string;
  after?: string;
  /** A value was longer than the display limit and was cut; the card says so. */
  truncated?: boolean;
}

export interface ProposalDocument {
  id: string;
  /** The document's title (`admin.useAsTitle`, then title/name/slug…), or its id. */
  title: string;
  /** ISO `updatedAt` the diff was built from: sent back on approve to detect a change since. */
  updatedAt?: string;
  /** `_status` (`draft` / `published`) for versioned collections. */
  status?: string;
}

/** One document the tool touches (several for a create, or an update/delete by `where`). */
export interface ProposalItem {
  document?: ProposalDocument;
  changes: FieldChange[];
  /** Changes left out past the per-item limit. */
  omittedChanges?: number;
}

export interface ApprovalProposal {
  interruptId: string;
  toolCallId: string;
  toolName: string;
  action: ApprovalAction;
  target: { kind: "collection" | "global"; slug: string; label: string } | null;
  items: ProposalItem[];
  /** Documents matched by a `where` (update/delete many): how many, beyond the items shown. */
  matchedDocs?: number;
  /** The write is a draft (`draft: true`) on a versioned collection or global. */
  draft?: boolean;
  /** The document changed after the assistant proposed this: the card asks to confirm again. */
  changedSinceProposal?: boolean;
  /** Something the card should say instead of (or above) the diff: unreadable document, etc. */
  notice?: string;
}

/** `GET /api/assistant/approvals?threadId=` */
export interface ApprovalsResponse {
  approvals: ApprovalProposal[];
}

/** The 409 body of a resume refused because a document changed since the card was shown. */
export interface StaleApprovalBody {
  code: "stale";
  error: string;
  interruptIds: string[];
}

/** What the server tells the model on a rejection (the tool result of a denied call). */
export const REJECTED_TOOL_RESULT = "The user rejected this change. Nothing was written.";

/** Longest rejection reason, in characters. */
export const MAX_REJECT_REASON_CHARS = 2_000;
