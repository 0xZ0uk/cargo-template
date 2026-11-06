/**
 * Pure helpers for rendering tool calls: their status, target collection, a readable (and
 * truncated) result, and the documents they reference. No React, so they are unit tested.
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

/** The tool input as an object, from `input` or the (possibly partial) `arguments` string. */
export function toolInput(call: ToolCallLike): Record<string, unknown> | undefined {
  if (call.input && typeof call.input === "object") return call.input as Record<string, unknown>;
  if (typeof call.arguments === "string" && call.arguments.trim()) {
    try {
      const parsed: unknown = JSON.parse(call.arguments);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // Still streaming.
    }
  }
  return undefined;
}

/** plugin-mcp names the collection (or global) `slug`; tolerate `collection` too. */
export function toolTarget(call: ToolCallLike): string | undefined {
  const input = toolInput(call);
  const value = input?.slug ?? input?.collection ?? input?.collectionSlug ?? input?.global;
  return typeof value === "string" && value ? value : undefined;
}

export function isGlobalTool(name: string): boolean {
  return /global/i.test(name);
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
function looksLikeToolError(content: unknown): boolean {
  const value = structuredResult(content);
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

/** Parses a JSON string; returns other values (and non-JSON strings) as they are. */
export function parseMaybeJson(content: unknown): unknown {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  if (!trimmed || !/^[[{"]/.test(trimmed)) return content;
  try {
    return JSON.parse(trimmed);
  } catch {
    return content;
  }
}

/** Text parts of a tool result's content, joined. */
function contentText(content: unknown): unknown {
  if (Array.isArray(content) && content.every((p) => p && typeof p === "object" && "type" in p)) {
    const texts = content
      .filter((p): p is { type: "text"; text?: string; content?: string } => (p as { type: string }).type === "text")
      .map((p) => p.text ?? p.content ?? "");
    if (texts.length) return texts.join("\n");
  }
  return content;
}

/** A readable, bounded rendering of a tool result: pretty JSON when it parses, cut at `max` characters. */
export function formatToolResult(content: unknown, max = MAX_RESULT_CHARS): { text: string; truncated: boolean } {
  let value = parseMaybeJson(contentText(content));
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
 * The structured part of a tool result. plugin-mcp answers in text with the data in a fenced
 * JSON block ("Created 1 of 1 documents…\n```json\n{…}\n```"); a result may also be plain JSON,
 * or JSON encoded twice (a string holding the text).
 */
export function structuredResult(content: unknown): unknown {
  let value = parseMaybeJson(contentText(content));
  if (typeof value === "string") value = parseMaybeJson(value);
  if (typeof value !== "string") return value;
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(value);
  if (!fenced?.[1]) return undefined;
  try {
    return JSON.parse(fenced[1]);
  } catch {
    return undefined;
  }
}

/**
 * The documents in a tool's result: `{ docs: [...] }` (each a document, or `{ doc }` as plugin-mcp's
 * creates return), `{ doc }`, an array, or one document.
 */
function documentsIn(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        v && typeof v === "object" && (v as { doc?: unknown }).doc && typeof (v as { doc?: unknown }).doc === "object"
          ? (v as { doc: unknown }).doc
          : v
      )
      .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v)));
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.docs)) return documentsIn(record.docs);
  if (record.doc && typeof record.doc === "object") return [record.doc as Record<string, unknown>];
  if (idOf(record.id)) return [record];
  return [];
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
  const target = toolTarget(call);
  if (!target) return [];

  if (isGlobalTool(call.name)) {
    return slugs.globals.has(target) ? [{ kind: "global", slug: target, label: target }] : [];
  }
  if (!slugs.collections.has(target)) return [];

  const refs = new Map<string, DocumentRef>();
  const add = (id: string | undefined, label?: string) => {
    if (!id || refs.has(id) || refs.size >= MAX_DOCUMENT_LINKS) return;
    refs.set(id, { kind: "collection", slug: target, id, label: label ?? id });
  };

  const status = toolStatus(call, result);
  if (status !== "error" && status !== "denied" && status !== "cancelled") {
    const output = structuredResult(result ? result.content : call.output);
    for (const doc of documentsIn(output)) {
      const id = idOf(doc.id);
      if (id) add(id, labelOf(doc, id));
    }
  }
  const inputId = idOf(toolInput(call)?.id);
  if (inputId) add(inputId);
  return [...refs.values()];
}
