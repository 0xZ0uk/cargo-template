import { describeCall, parseResult, resultText, type ToolCall } from "../toolCalls";

/**
 * Pure helpers for rendering tool calls: their status, target collection, a readable (and
 * truncated) result, and the documents they reference. What a call means comes from
 * `describeCall` / `parseResult` (`src/toolCalls.ts`), as on the server. No React, so they are
 * unit tested.
 */

export type ToolStatus = "running" | "awaiting-approval" | "done" | "error" | "denied" | "cancelled";

export interface ToolCallLike {
  id: string;
  name: string;
  arguments?: string;
  input?: unknown;
  state?: string;
  output?: unknown;
  approval?: { approved?: boolean; needsApproval?: boolean };
}

export interface ToolResultLike {
  toolCallId: string;
  content: unknown;
  state?: string;
  outcome?: string;
  error?: string;
}

export interface EntitySlugs {
  collections: ReadonlySet<string>;
  globals: ReadonlySet<string>;
}

export interface DocumentRef {
  kind: "collection" | "global";
  slug: string;
  id?: string;
  label: string;
}

/** Results longer than this are cut in the UI (the stored transcript is untouched). */
export const MAX_RESULT_CHARS = 4_000;
/** At most this many document links per tool call. */
export const MAX_DOCUMENT_LINKS = 10;

/**
 * What a call in the transcript means, from its `input` or its (possibly partial) `arguments`
 * string. A call that asked for approval says so (`approval.needsApproval`); a reloaded transcript
 * doesn't keep that, and the tool's name decides.
 */
export function describeToolCall(call: ToolCallLike): ToolCall {
  const input = call.input && typeof call.input === "object" ? call.input : call.arguments;
  return describeCall(call.name, input, call.approval?.needsApproval ? { needsApproval: true } : {});
}

/** The collection or global a call is about (plugin-mcp's `slug` argument). */
export function toolTarget(call: ToolCallLike): string | undefined {
  return describeToolCall(call).target?.slug;
}

export function toolStatus(call: ToolCallLike, result?: ToolResultLike): ToolStatus {
  if (result) {
    if (result.outcome === "denied") return "denied";
    if (result.outcome === "cancelled") return "cancelled";
    if (result.state === "error" || result.error) return "error";
    if (looksLikeToolError(result.content)) return "error";
    return "done";
  }
  if (call.approval?.approved === false) return "denied";
  switch (call.state) {
    case "approval-requested":
      return "awaiting-approval";
    case "error":
      return "error";
    case "complete":
      return call.output !== undefined ? (looksLikeToolError(call.output) ? "error" : "done") : "running";
    default:
      return "running";
  }
}

export const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  running: "Running",
  "awaiting-approval": "Waiting for approval",
  done: "Done",
  error: "Failed",
  denied: "Rejected",
  cancelled: "Cancelled",
};

/** A tool error comes back as a result (`{ error: "…" }`), not a failed run (README, "Access denials"). */
const looksLikeToolError = (content: unknown): boolean => parseResult(content).error !== undefined;

/** Parses a JSON string; returns other values (and non-JSON strings) as they are. */
function parseMaybeJson(content: unknown): unknown {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  if (!trimmed || !/^[[{"]/.test(trimmed)) return content;
  try {
    return JSON.parse(trimmed);
  } catch {
    return content;
  }
}

/** A readable, bounded rendering of a tool result: pretty JSON when it parses, cut at `max` characters. */
export function formatToolResult(content: unknown, max = MAX_RESULT_CHARS): { text: string; truncated: boolean } {
  let value = parseMaybeJson(resultText(content) ?? content);
  // JSON encoded twice: show the text it holds.
  if (typeof value === "string") value = parseMaybeJson(value);
  let text: string;
  if (typeof value === "string") text = value;
  else {
    try {
      text = JSON.stringify(value, null, 2) ?? "";
    } catch {
      text = String(value);
    }
  }
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n…`, truncated: true };
}

const idOf = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;

function labelOf(doc: Record<string, unknown>, id: string): string {
  for (const key of ["title", "name", "label", "slug", "email", "filename"]) {
    const value = doc[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return id;
}

/**
 * The documents a tool call touched or returned, as links to their admin edit views. Only for a
 * collection or global that exists in the admin config, and only from the tool's structured input
 * and result: never from free model text.
 */
export function documentRefs(
  call: ToolCallLike,
  result: ToolResultLike | undefined,
  slugs: EntitySlugs
): DocumentRef[] {
  const described = describeToolCall(call);
  const { target } = described;
  if (!target) return [];

  if (target.kind === "global") {
    return slugs.globals.has(target.slug) ? [{ kind: "global", slug: target.slug, label: target.slug }] : [];
  }
  if (!slugs.collections.has(target.slug)) return [];
  // A delete leaves nothing to open: its documents' edit views would be "not found".
  if (described.operation === "delete") return [];
  // A versions read lists versions: their ids (and the `id` argument) are not documents.
  if (described.versions && described.operation === "read") return [];

  const refs = new Map<string, DocumentRef>();
  const add = (id: string | undefined, label?: string) => {
    if (!id || refs.has(id) || refs.size >= MAX_DOCUMENT_LINKS) return;
    refs.set(id, { kind: "collection", slug: target.slug, id, label: label ?? id });
  };

  const status = toolStatus(call, result);
  if (status !== "error" && status !== "denied" && status !== "cancelled") {
    for (const doc of parseResult(result ? result.content : call.output).documents) {
      const id = idOf(doc.id);
      if (id) add(id, labelOf(doc, id));
    }
  }
  // A restore's `id` is the version's: the restored document is in the result.
  if (!described.versions) add(described.id);
  return [...refs.values()];
}

/**
 * Write tool calls (tools that need approval) that finished successfully (an approved change was
 * applied), in transcript order: the tool result is there and is not an error, a rejection or a
 * cancellation.
 */
export function appliedWrites(
  messages: ReadonlyArray<{ parts: ReadonlyArray<{ type: string; [key: string]: unknown }> }>,
  results: ReadonlyMap<string, ToolResultLike>
): Array<{ call: ToolCallLike; result: ToolResultLike }> {
  const out: Array<{ call: ToolCallLike; result: ToolResultLike }> = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-call") continue;
      const call = part as unknown as ToolCallLike;
      if (typeof call.id !== "string" || typeof call.name !== "string" || !describeToolCall(call).needsApproval) continue;
      const result = results.get(call.id);
      if (result && toolStatus(call, result) === "done") out.push({ call, result });
    }
  }
  return out;
}

/**
 * Whether an applied write changed the given document (#69): the same global, or the same
 * collection with the document's id in the call's input or in the documents its result returned
 * (an update by `where`). A delete doesn't count: there is nothing left to reload.
 */
export function writeTouches(
  call: ToolCallLike,
  result: ToolResultLike | undefined,
  target: { kind: "collection" | "global"; slug: string; id?: string }
): boolean {
  const described = describeToolCall(call);
  if (!described.needsApproval || described.operation === "delete") return false;
  if (described.target?.slug !== target.slug) return false;
  if (target.kind === "global") return described.target.kind === "global";
  if (described.target.kind === "global" || !target.id) return false;
  if (!described.versions && described.id === target.id) return true;
  return parseResult(result?.content).documents.some((doc) => idOf(doc.id) === target.id);
}
