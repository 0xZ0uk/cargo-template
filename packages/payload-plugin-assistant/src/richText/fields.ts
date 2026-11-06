import type { CollectionSlug, PayloadRequest } from "payload";
import { isLexicalState } from "../approvals/lexical";

/**
 * Rich text as Markdown (#67): resolve a document's rich text field from a data path, convert it
 * with the field's own editor, and say what Markdown can't keep. Shared by the write tool
 * (`setRichTextFromMarkdown`), the read conversion (`findDocuments`) and the approval card, so
 * the three agree on every path. Server-only (needs the sanitized config), no runtime imports
 * from Payload or Lexical: the converters come from the sanitized field.
 *
 * Paths are **data paths**: field names and row indexes, e.g. `caption`, `hero.richText` or
 * `layout.3.columns.0.content.1.richText`. Blocks rows are resolved by their `blockType`, so the
 * same name in two blocks (`richText` in Rich text and Feature rows) is never ambiguous.
 */

type Doc = Record<string, unknown>;

/** The converters Payload's sanitizer binds to each Lexical field's own editor config. */
export interface MarkdownConverters {
  fromMarkdown: (args: { markdown: string }) => unknown;
  toMarkdown: (args: { data: unknown }) => string;
}

/** The subset of a sanitized (flattened) field this module reads. */
export interface FieldLike {
  name?: string;
  type: string;
  label?: unknown;
  editor?: unknown;
  localized?: boolean;
  flattenedFields?: FieldLike[];
  fields?: FieldLike[];
  blocks?: Array<BlockLike | string>;
  blockReferences?: Array<BlockLike | string>;
}

export interface BlockLike {
  slug: string;
  labels?: { singular?: unknown };
  flattenedFields?: FieldLike[];
  fields?: FieldLike[];
}

/** A clear, model-facing error (the tool returns its message as the tool result). */
export class RichTextPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RichTextPathError";
  }
}

const isRecord = (value: unknown): value is Doc => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const subFields = (field: { flattenedFields?: FieldLike[]; fields?: FieldLike[] }): FieldLike[] =>
  field.flattenedFields ?? field.fields ?? [];

/** The converters of a rich text field, or `undefined` for an editor that has none (not Lexical). */
export function convertersOf(field: FieldLike | undefined): MarkdownConverters | undefined {
  if (!field || field.type !== "richText" || !isRecord(field.editor)) return undefined;
  const converters = (field.editor as { converters?: unknown }).converters;
  if (!isRecord(converters)) return undefined;
  const { fromMarkdown, toMarkdown } = converters as Partial<MarkdownConverters>;
  return typeof fromMarkdown === "function" && typeof toMarkdown === "function" ? { fromMarkdown, toMarkdown } : undefined;
}

function labelOf(label: unknown, fallback: string): string {
  if (typeof label === "string" && label.trim()) return label.trim();
  if (isRecord(label)) {
    const first = Object.values(label).find((v) => typeof v === "string" && v.trim());
    if (typeof first === "string") return first.trim();
  }
  return fallback
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function blocksOfField(field: FieldLike, blocksBySlug: ReadonlyMap<string, BlockLike>): BlockLike[] {
  const out: BlockLike[] = [];
  for (const entry of [...(field.blocks ?? []), ...(field.blockReferences ?? [])]) {
    const block = typeof entry === "string" ? blocksBySlug.get(entry) : entry;
    if (block?.slug) out.push(block);
  }
  return out;
}

/** Blocks registered once on the config (`config.blocks`) and referenced by slug in blocks fields. */
export function blocksBySlugOf(req: PayloadRequest): Map<string, BlockLike> {
  const map = new Map<string, BlockLike>();
  const registered = (req.payload as unknown as { blocks?: Record<string, BlockLike> }).blocks ?? {};
  for (const block of Object.values(registered)) if (block?.slug) map.set(block.slug, block);
  for (const block of (req.payload.config.blocks ?? []) as unknown as BlockLike[]) {
    if (block?.slug && !map.has(block.slug)) map.set(block.slug, block);
  }
  return map;
}

export interface CollectionLike {
  slug: string;
  flattenedFields?: FieldLike[];
  fields?: FieldLike[];
  versions?: unknown;
  admin?: { useAsTitle?: string };
  labels?: { singular?: unknown };
}

export function collectionOf(req: PayloadRequest, slug: string): CollectionLike | undefined {
  return req.payload.collections?.[slug as CollectionSlug]?.config as unknown as CollectionLike | undefined;
}

export const hasDrafts = (collection: CollectionLike): boolean =>
  Boolean(isRecord(collection.versions) && (collection.versions as { drafts?: unknown }).drafts);

/** Does this field list contain a rich text field anywhere (groups, tabs, arrays, blocks)? */
export function fieldsHaveRichText(fields: ReadonlyArray<FieldLike>, blocksBySlug: ReadonlyMap<string, BlockLike>, seen = new Set<unknown>()): boolean {
  for (const field of fields) {
    if (field.type === "richText") return true;
    if (seen.has(field)) continue;
    seen.add(field);
    if (field.type === "blocks") {
      if (blocksOfField(field, blocksBySlug).some((b) => fieldsHaveRichText(subFields(b), blocksBySlug, seen))) return true;
    } else if (subFields(field).length && fieldsHaveRichText(subFields(field), blocksBySlug, seen)) return true;
  }
  return false;
}

/** Collections (not `payload-*`) with at least one rich text field: for "unknown collection" errors. */
export function richTextCollections(req: PayloadRequest): string[] {
  const blocks = blocksBySlugOf(req);
  return Object.values(req.payload.collections ?? {})
    .map((c) => c.config as unknown as CollectionLike)
    .filter((c) => !c.slug.startsWith("payload-") && fieldsHaveRichText(subFields(c), blocks))
    .map((c) => c.slug);
}

export interface RichTextLocation {
  /** The data path, normalised (`layout.3.columns.0.content.1.richText`). */
  path: string;
  /** Readable label for the card: `Layout › 4 · Columns › Columns › 1 › Content › 2 · Text › Rich text`. */
  label: string;
  field: FieldLike;
  converters: MarkdownConverters;
  /** The current value (a Lexical editor state, or null/undefined when empty). */
  value: unknown;
}

/**
 * Every rich text field present in this document, as data paths (the rows that exist now). A
 * field inside a group always counts, even when the group's data is missing.
 */
export function richTextPaths(fields: ReadonlyArray<FieldLike>, data: unknown, blocksBySlug: ReadonlyMap<string, BlockLike>, prefix = ""): string[] {
  const doc = isRecord(data) ? data : {};
  const out: string[] = [];
  for (const field of fields) {
    if (!field.name) continue;
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const value = doc[field.name];
    switch (field.type) {
      case "richText":
        out.push(path);
        break;
      case "group":
      case "tab":
        out.push(...richTextPaths(subFields(field), value, blocksBySlug, path));
        break;
      case "array":
        if (Array.isArray(value)) value.forEach((row, i) => out.push(...richTextPaths(subFields(field), row, blocksBySlug, `${path}.${i}`)));
        break;
      case "blocks":
        if (Array.isArray(value)) {
          const blocks = blocksOfField(field, blocksBySlug);
          value.forEach((row, i) => {
            const block = isRecord(row) ? blocks.find((b) => b.slug === row.blockType) : undefined;
            if (block) out.push(...richTextPaths(subFields(block), row, blocksBySlug, `${path}.${i}`));
          });
        }
        break;
    }
  }
  return out;
}

const listPaths = (paths: string[]) =>
  paths.length ? `Rich text paths in this document: ${paths.slice(0, 40).join(", ")}${paths.length > 40 ? ` (and ${paths.length - 40} more)` : ""}.` : "This document has no rich text fields.";

/**
 * Resolve a data path in a document to its rich text field, the value there and the converters.
 * Throws {@link RichTextPathError} (with the document's valid rich text paths) when the path
 * doesn't exist, points into a row that doesn't exist, or isn't a rich text field.
 */
export function resolveRichText(collection: CollectionLike, doc: Doc, rawPath: string, blocksBySlug: ReadonlyMap<string, BlockLike>): RichTextLocation {
  const segments = String(rawPath ?? "")
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  const valid = () => listPaths(richTextPaths(subFields(collection), doc, blocksBySlug));
  if (!segments.length) throw new RichTextPathError(`A rich text path is required. ${valid()}`);

  let fields = subFields(collection);
  let data: unknown = doc;
  const labels: string[] = [];
  const done: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const name = segments[i]!;
    const field = fields.find((f) => f.name === name);
    const here = [...done, name].join(".");
    if (!field) throw new RichTextPathError(`"${rawPath}": there is no field "${name}"${done.length ? ` in "${done.join(".")}"` : ""}. ${valid()}`);
    labels.push(labelOf(field.label, name));
    done.push(name);
    const value = isRecord(data) ? data[name] : undefined;
    const last = i === segments.length - 1;

    if (field.type === "richText") {
      if (!last) throw new RichTextPathError(`"${rawPath}": "${here}" is a rich text field; the path must end there. ${valid()}`);
      const converters = convertersOf(field);
      if (!converters) throw new RichTextPathError(`"${rawPath}" is a rich text field without Markdown support (not a Lexical editor).`);
      return { path: segments.join("."), label: labels.join(" › "), field, converters, value };
    }
    if (last) throw new RichTextPathError(`"${rawPath}" is a ${field.type} field, not rich text. ${valid()}`);

    if (field.type === "group" || field.type === "tab") {
      fields = subFields(field);
      data = value;
      continue;
    }
    if (field.type === "array" || field.type === "blocks") {
      const index = segments[i + 1]!;
      if (!/^\d+$/.test(index)) throw new RichTextPathError(`"${rawPath}": "${here}" is a list of rows; give the row number (from 0) after it, e.g. "${here}.0". ${valid()}`);
      const rows = Array.isArray(value) ? value : [];
      const row = rows[Number(index)];
      if (!isRecord(row)) throw new RichTextPathError(`"${rawPath}": "${here}" has ${rows.length} ${rows.length === 1 ? "row" : "rows"} (0–${Math.max(rows.length - 1, 0)}), no row ${index}. ${valid()}`);
      i += 1;
      done.push(index);
      if (field.type === "array") {
        labels.push(String(Number(index) + 1));
        fields = subFields(field);
      } else {
        const block = blocksOfField(field, blocksBySlug).find((b) => b.slug === row.blockType);
        if (!block) throw new RichTextPathError(`"${rawPath}": row ${index} of "${here}" is an unknown block ("${String(row.blockType)}").`);
        labels.push(`${Number(index) + 1} · ${labelOf(block.labels?.singular, block.slug)}`);
        fields = subFields(block);
      }
      data = row;
      continue;
    }
    throw new RichTextPathError(`"${rawPath}": "${here}" is a ${field.type} field, not rich text. ${valid()}`);
  }
  throw new RichTextPathError(`"${rawPath}" is not a rich text field. ${valid()}`);
}

/** Set the value at a data path on a (cloned) document, in place. The path must exist (resolved first). */
export function setAtPath(doc: Doc, path: string, value: unknown): void {
  const segments = path.split(".");
  let node: unknown = doc;
  for (const segment of segments.slice(0, -1)) {
    const next = Array.isArray(node) ? node[Number(segment)] : isRecord(node) ? node[segment] : undefined;
    if (next === undefined || next === null) {
      if (isRecord(node)) node[segment] = {};
      node = isRecord(node) ? node[segment] : undefined;
    } else node = next;
  }
  const last = segments[segments.length - 1]!;
  if (isRecord(node)) node[last] = value;
}

/** Lexical → Markdown with the field's converters; `""` for an empty field. Never throws. */
export function toMarkdown(converters: MarkdownConverters, value: unknown): string {
  if (!isLexicalState(value)) return "";
  try {
    return converters.toMarkdown({ data: value }).trim();
  } catch {
    return "";
  }
}

// ── What Markdown can't keep ────────────────────────────────────────────────────────────────

/** Lexical text format bits with no Markdown transformer. */
const LOSSY_TEXT_FORMATS: ReadonlyArray<[bit: number, name: string]> = [
  [8, "underline"],
  [32, "subscript"],
  [64, "superscript"],
  [128, "highlight"],
];

/** Node types the Markdown converters write and read back. Anything else is lost. */
const KEPT_NODE_TYPES = new Set(["root", "paragraph", "text", "linebreak", "tab", "heading", "link", "list", "listitem", "quote", "horizontalrule"]);

/**
 * What a Markdown round trip would lose in this editor state, as readable names (`underline`,
 * `text alignment`, `internal links (to documents)`, `upload nodes`…). Empty when the field is
 * fully expressible in Markdown.
 */
export function markdownLosses(state: unknown): string[] {
  if (!isLexicalState(state)) return [];
  const losses = new Set<string>();
  const visit = (node: unknown) => {
    if (!isRecord(node)) return;
    const type = typeof node.type === "string" ? node.type : "unknown";
    if (!KEPT_NODE_TYPES.has(type)) losses.add(`${type} nodes`);
    if (type === "text") {
      const format = typeof node.format === "number" ? node.format : 0;
      for (const [bit, name] of LOSSY_TEXT_FORMATS) if (format & bit) losses.add(name);
      if (typeof node.style === "string" && node.style.trim()) losses.add("text styles");
    } else if (type !== "root" && type !== "listitem") {
      if (typeof node.format === "string" && node.format && node.format !== "left" && node.format !== "start") losses.add("text alignment");
      if (typeof node.indent === "number" && node.indent > 0) losses.add("indentation");
    }
    if (type === "link") {
      const fields = isRecord(node.fields) ? node.fields : {};
      if (fields.linkType === "internal") losses.add("internal links (to documents)");
      if (fields.newTab === true) losses.add("links opening in a new tab");
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(state.root);
  return [...losses];
}

/**
 * Markdown the field's editor didn't understand, found in the state it produced: block syntax
 * left as the literal start of a paragraph (`## `, `- `, `1. `, `> ` when the editor has no such
 * heading level, lists or quotes) and inline syntax left in the text (`**`, `~~`, `[text](url)`).
 * Empty when everything became structure.
 */
export function unsupportedMarkdown(state: unknown): string[] {
  if (!isLexicalState(state)) return [];
  const found = new Set<string>();
  const textOf = (node: unknown): string =>
    !isRecord(node) ? "" : node.type === "text" && typeof node.text === "string" ? node.text : Array.isArray(node.children) ? node.children.map(textOf).join("") : "";
  const visit = (node: unknown) => {
    if (!isRecord(node)) return;
    if (node.type === "paragraph") {
      const text = textOf(node);
      const heading = /^(#{1,6})\s/.exec(text);
      if (heading) found.add(`h${heading[1]!.length} headings`);
      else if (/^([-*+]|\d+[.)])\s/.test(text)) found.add("lists");
      else if (/^>\s/.test(text)) found.add("quotes");
    }
    if (node.type === "text" && typeof node.text === "string") {
      if (/\*\*|~~/.test(node.text)) found.add("bold or strikethrough markers");
      if (/\[[^\]]+\]\([^)\s]+\)/.test(node.text)) found.add("links");
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(state.root);
  return [...found];
}

// ── Reads: every rich text value as Markdown ────────────────────────────────────────────────

/**
 * A copy of `data` with every Lexical editor state replaced by Markdown: by the schema where the
 * field is known (its own editor), anywhere else (populated relationships, unknown keys) with the
 * root editor's converters. A value that fails to convert is left as it is.
 */
export function richTextToMarkdownDeep(
  data: unknown,
  fields: ReadonlyArray<FieldLike> | undefined,
  blocksBySlug: ReadonlyMap<string, BlockLike>,
  fallback: MarkdownConverters | undefined
): unknown {
  const convert = (converters: MarkdownConverters | undefined, value: unknown) => {
    if (!converters) return value;
    try {
      return converters.toMarkdown({ data: value }).trim();
    } catch {
      return value;
    }
  };
  const generic = (value: unknown): unknown => {
    if (isLexicalState(value)) return convert(fallback, value);
    if (Array.isArray(value)) return value.map(generic);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, generic(v)]));
    return value;
  };
  const withFields = (value: unknown, list: ReadonlyArray<FieldLike>): unknown => {
    if (!isRecord(value)) return generic(value);
    const out: Doc = {};
    for (const [key, v] of Object.entries(value)) {
      const field = list.find((f) => f.name === key);
      if (!field) out[key] = generic(v);
      else if (field.type === "richText") out[key] = isLexicalState(v) ? convert(convertersOf(field) ?? fallback, v) : generic(v);
      else if (field.type === "group" || field.type === "tab") out[key] = withFields(v, subFields(field));
      else if (field.type === "array") out[key] = Array.isArray(v) ? v.map((row) => withFields(row, subFields(field))) : generic(v);
      else if (field.type === "blocks") {
        const blocks = blocksOfField(field, blocksBySlug);
        out[key] = Array.isArray(v)
          ? v.map((row) => {
              const block = isRecord(row) ? blocks.find((b) => b.slug === row.blockType) : undefined;
              return block ? withFields(row, subFields(block)) : generic(row);
            })
          : generic(v);
      } else out[key] = generic(v);
    }
    return out;
  };
  return fields ? withFields(data, fields) : generic(data);
}

/** The root editor's converters (`config.editor`), for rich text outside a known schema. */
export function rootConverters(req: PayloadRequest): MarkdownConverters | undefined {
  return convertersOf({ type: "richText", editor: req.payload.config.editor });
}

export { subFields as fieldsOf };
