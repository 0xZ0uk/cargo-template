/**
 * What a plugin-mcp tool call means (#134): the one place that reads a call's name, arguments and
 * result. Approvals, audit, redaction, the turn's policies and the chat UI all go through it, so
 * a plugin-mcp bump or a tool rename is a change to this file (and its recorded fixtures,
 * `tests/fixtures/plugin-mcp.json`). Pure and client-safe: no runtime imports.
 *
 * - {@link describeCall}: the operation, the collection or global it targets, the document id,
 *   whether it works on versions, the field paths it queries, its locale, and whether it waits for
 *   the user's approval.
 * - {@link parseResult}: the documents a result lists, their ids, "nothing changed", and a tool
 *   error.
 */

/** What a tool does. `other` is a tool this module doesn't know (a custom tool). */
export type ToolOperation = "read" | "create" | "update" | "delete" | "duplicate" | "restore" | "other";

export type ToolTargetKind = "collection" | "global";

/** The collection or global a call is about. */
export interface ToolTarget {
  kind: ToolTargetKind;
  slug: string;
}

/** What {@link describeCall} knows about one tool call. */
export interface ToolCall {
  name: string;
  /** One of plugin-mcp's tools (or the assistant's own). Unknown tools are `other`, on a collection. */
  known: boolean;
  operation: ToolOperation;
  /** From the `slug` argument, the only name plugin-mcp gives the collection or global. */
  target: ToolTarget | undefined;
  /**
   * The `id` argument as text. For a versions tool (`versions`) it is a version's id, not a
   * document's.
   */
  id: string | undefined;
  /**
   * The versions tools (`findVersions`, `restoreVersion`, the globals' equivalents…): `id` is a
   * version, results are versions, and queried paths put the document's fields under `version.`
   * (`parent` is the document a version belongs to).
   */
  versions: boolean;
  /** The field paths the call filters, sorts, selects or lists distinct values by: `where` (through `and`/`or`), `sort`, `select`, `field`. */
  queriedPaths: string[];
  locale: string | undefined;
  /** Waits for the user's approval: plugin-mcp's `readOnlyHint` (see {@link describeCall}). */
  needsApproval: boolean;
  /** The arguments as an object (`{}` when they are missing or still streaming). */
  args: Record<string, unknown>;
}

interface ToolSpec {
  operation: Exclude<ToolOperation, "other">;
  kind: ToolTargetKind | null;
  versions?: true;
}

/**
 * Every tool the assistant offers: plugin-mcp's (`COLLECTION_BUILTINS`, `GLOBAL_BUILTINS`,
 * `TOOL_BUILTINS` minus the auth tools and `getUploadInstructions`, which the assistant drops) and
 * its own `setRichTextFromMarkdown` (#67). `tests/integration/toolFixtures.test.ts` checks this
 * list against what plugin-mcp advertises, and the approval rule against its annotations.
 */
const TOOLS: Readonly<Record<string, ToolSpec>> = {
  getConfigInfo: { operation: "read", kind: null },
  // Collections.
  findDocuments: { operation: "read", kind: "collection" },
  countDocuments: { operation: "read", kind: "collection" },
  findDistinct: { operation: "read", kind: "collection" },
  getCollectionSchema: { operation: "read", kind: "collection" },
  findVersions: { operation: "read", kind: "collection", versions: true },
  findVersionByID: { operation: "read", kind: "collection", versions: true },
  countVersions: { operation: "read", kind: "collection", versions: true },
  createDocuments: { operation: "create", kind: "collection" },
  updateDocument: { operation: "update", kind: "collection" },
  setRichTextFromMarkdown: { operation: "update", kind: "collection" },
  deleteDocuments: { operation: "delete", kind: "collection" },
  duplicateDocument: { operation: "duplicate", kind: "collection" },
  restoreVersion: { operation: "restore", kind: "collection", versions: true },
  // Globals.
  findGlobal: { operation: "read", kind: "global" },
  getGlobalSchema: { operation: "read", kind: "global" },
  findGlobalVersions: { operation: "read", kind: "global", versions: true },
  findGlobalVersionByID: { operation: "read", kind: "global", versions: true },
  countGlobalVersions: { operation: "read", kind: "global", versions: true },
  updateGlobal: { operation: "update", kind: "global" },
  restoreGlobalVersion: { operation: "restore", kind: "global", versions: true },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const idText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** A call's arguments as an object: an object as is, a JSON string parsed, anything else (or JSON still streaming) `{}`. */
function argumentsOf(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The field paths a `where` names: its keys, through `and` / `or`. */
function wherePaths(where: unknown, depth = 0): string[] {
  if (depth > 16) return [];
  if (Array.isArray(where)) return where.flatMap((item) => wherePaths(item, depth + 1));
  if (!isRecord(where)) return [];
  return Object.entries(where).flatMap(([key, value]) =>
    key === "and" || key === "or" || key === "AND" || key === "OR" ? wherePaths(value, depth + 1) : [key]
  );
}

/** The field paths a `select` turns on (`{ group: { field: true } }` → `group.field`). */
function selectPaths(select: unknown, prefix = "", depth = 0): string[] {
  if (!isRecord(select) || depth > 16) return [];
  return Object.entries(select).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value)) return selectPaths(value, path, depth + 1);
    return value ? [path] : [];
  });
}

const sortPaths = (sort: unknown): string[] =>
  (Array.isArray(sort) ? sort : typeof sort === "string" ? sort.split(",") : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/^[-+]/, ""));

/**
 * What one tool call means. `args` is the call's input: an object, or the JSON arguments string
 * (a partial one, still streaming, reads as no arguments).
 *
 * `needsApproval` is the tool's annotation when the caller has it (`options.needsApproval`, from
 * the tool definition `createPayloadToolSource` built from `readOnlyHint`); otherwise reads don't
 * and writes do, which is what plugin-mcp's annotations say for every known tool. An unknown tool
 * without the flag needs approval (no annotations means the user approves first).
 */
export function describeCall(name: string, args: unknown, options: { needsApproval?: boolean } = {}): ToolCall {
  const input = argumentsOf(args);
  const spec = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : undefined;
  const slug = typeof input.slug === "string" && input.slug ? input.slug : undefined;
  const kind = spec ? spec.kind : "collection";
  return {
    name,
    known: Boolean(spec),
    operation: spec?.operation ?? "other",
    target: slug && kind ? { kind, slug } : undefined,
    id: idText(input.id) || undefined,
    versions: spec?.versions === true,
    queriedPaths: [
      ...wherePaths(input.where),
      ...sortPaths(input.sort),
      ...selectPaths(input.select),
      ...(typeof input.field === "string" ? [input.field] : []),
    ],
    locale: typeof input.locale === "string" && input.locale ? input.locale : undefined,
    needsApproval: options.needsApproval ?? (spec ? spec.operation !== "read" : true),
    args: input,
  };
}

/**
 * Keys under which plugin-mcp's results and Payload's answers wrap documents of the call's
 * collection: a page or a batch (`docs`), `{ doc }` (a created document), a version (`version`)
 * and the document it belongs to (`parent`), `{ result }`. Redaction walks into each.
 */
export const DOCUMENT_WRAPPERS = ["docs", "doc", "version", "parent", "result"] as const;

/** The end (exclusive) of the JSON object or array starting at `start`, string-aware; -1 if unbalanced. */
function matchingEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Every JSON object or array in `text` (fenced or not), parsed, with where it starts and ends.
 * plugin-mcp answers in text with the data as JSON ("Document from collection …:\n{…}",
 * "Results:\n```json\n{…}\n```").
 */
export function jsonSpansIn(text: string): Array<{ start: number; end: number; value: unknown }> {
  const spans: Array<{ start: number; end: number; value: unknown }> = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char !== "{" && char !== "[") {
      i++;
      continue;
    }
    const end = matchingEnd(text, i);
    if (end === -1) {
      i++;
      continue;
    }
    try {
      spans.push({ start: i, end, value: JSON.parse(text.slice(i, end)) });
      i = end;
    } catch {
      i++;
    }
  }
  return spans;
}

/** Content parts (`{ type: "text", content | text }`), as `chat()` and the MCP client hand them. */
const isContentParts = (value: unknown): value is Array<Record<string, unknown>> =>
  Array.isArray(value) && value.length > 0 && value.every((part) => isRecord(part) && typeof part.type === "string");

/** A tool result as text: a string, or its text content parts joined. `undefined` for structured results. */
export function resultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!isContentParts(result)) return undefined;
  const texts = result
    .filter((part) => part.type === "text")
    .map((part) => (typeof part.content === "string" ? part.content : typeof part.text === "string" ? part.text : ""));
  return texts.length ? texts.join("\n") : undefined;
}

/** Parses a JSON string that is one value; `undefined` when it isn't one. */
function wholeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || !/^[[{"]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

type Doc = Record<string, unknown>;

/** What {@link parseResult} reads from one tool result. */
export interface ToolResult {
  /**
   * The documents the result lists, from every top-level JSON value shaped like documents: a
   * list (`[{ id }, …]`, update and delete by `where`), a batch or a page (`{ docs: [{ id } |
   * { doc }] }`: `createDocuments`, the versions tools), `{ doc }`, or one document (`{ id }`;
   * `findDocuments` writes each document of a page as its own JSON block). Never from
   * plugin-mcp's `Errors:` section (documents that were not written) or the schema after it, and
   * never a document nested in another (a populated relation). For a versions tool these are
   * versions (`id` is the version's, `parent` the document's).
   */
  documents: Doc[];
  /** The documents' ids; `undefined` when the result lists none it can tell (`[]` when nothing changed). */
  ids: string[] | undefined;
  /** A write that changed nothing: `Updated: 0 documents`, `Deleted: 0 documents`, `Created 0 of N documents`. */
  nothingChanged: boolean;
  /** The tool failed: `chat()`'s `{ error }` (plugin-mcp's error results, refusals, denied access). */
  error: string | undefined;
}

/** The documents in one JSON value (see {@link ToolResult.documents}), or `undefined` when it doesn't look like documents. */
function documentsOf(value: unknown): Doc[] | undefined {
  if (Array.isArray(value)) {
    const docs = value.map((item) => (isRecord(item) && isRecord(item.doc) ? item.doc : item));
    return docs.every((doc) => isRecord(doc) && idText(doc.id)) ? (docs as Doc[]) : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.docs)) return documentsOf(value.docs);
  if (isRecord(value.doc)) return documentsOf(value.doc);
  return idText(value.id) ? [value] : undefined;
}

/**
 * What a tool result says: plugin-mcp's text (a string or content parts), JSON (also encoded
 * twice), or structured data.
 */
export function parseResult(result: unknown): ToolResult {
  let value: unknown = resultText(result) ?? result;
  // JSON, possibly encoded twice (a string holding the text).
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    const parsed = wholeJson(value);
    if (parsed === undefined) break;
    value = parsed;
  }
  if (isRecord(value) && typeof value.error === "string") {
    return { documents: [], ids: undefined, nothingChanged: false, error: value.error };
  }
  if (typeof value !== "string") {
    const documents = documentsOf(value);
    return { documents: documents ?? [], ids: documents?.map((doc) => idText(doc.id)), nothingChanged: false, error: undefined };
  }
  if (/^(?:Updated|Deleted): 0 documents$/m.test(value) || /\bCreated 0 of \d+ documents\b/.test(value)) {
    return { documents: [], ids: [], nothingChanged: true, error: undefined };
  }
  // plugin-mcp lists documents that failed (`Errors:`) and the schema (`Use this schema for data:`) after the result.
  const main = value.split(/\n\s*(?:Errors|Use this schema for data):\s*\n/)[0] ?? "";
  let documents: Doc[] | undefined;
  for (const span of jsonSpansIn(main)) {
    const found = documentsOf(span.value);
    if (found) documents = [...(documents ?? []), ...found];
  }
  return { documents: documents ?? [], ids: documents?.map((doc) => idText(doc.id)), nothingChanged: false, error: undefined };
}
