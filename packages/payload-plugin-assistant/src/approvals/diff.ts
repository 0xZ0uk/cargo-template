/**
 * Field-by-field diffs for the approval card, as display text. Pure (no Payload runtime): the
 * server passes the collection's field config as data, which says which values are rich text,
 * relationships, selects, groups, arrays or blocks. Values without a field config are still
 * readable: Lexical states become text, other objects pretty JSON.
 */

import type { FieldChange } from "./types";
import { isLexicalState, lexicalToText } from "./lexical";

/** The parts of a Payload field config the diff reads (structurally compatible with `Field`). */
export interface FieldLike {
  type: string;
  name?: string;
  label?: unknown;
  fields?: FieldLike[];
  tabs?: Array<{ name?: string; label?: unknown; fields: FieldLike[] }>;
  blocks?: Array<BlockLike | string>;
  blockReferences?: Array<BlockLike | string>;
  options?: Array<string | { label?: unknown; value: string }>;
  relationTo?: string | string[];
  hasMany?: boolean;
}

export interface BlockLike {
  slug: string;
  labels?: { singular?: unknown };
  fields: FieldLike[];
}

type NodeType = "group" | "array" | "blocks" | "richText" | "reference" | "select" | "checkbox" | "json" | "leaf";

interface FieldNode {
  label: string;
  type: NodeType;
  fields?: FieldMap;
  blocks?: Map<string, { label: string; fields: FieldMap }>;
  options?: Map<string, string>;
}

type FieldMap = Map<string, FieldNode>;

/** Longest value shown, in characters; longer ones are cut and flagged `truncated`. */
export const MAX_VALUE_CHARS = 10_000;
/** Most changes per document; the rest are counted in `omittedChanges`. */
export const MAX_CHANGES = 150;

/** Never shown: Payload manages them. `_status` is shown when it changes. */
const SYSTEM_KEYS = new Set(["id", "_id", "createdAt", "updatedAt", "deletedAt", "__v", "_localized"]);
/** Never shown inside array rows and blocks (`blockType` is in the row's label). */
const ROW_KEYS = new Set(["id", "blockType", "blockName"]);

/** `metaTitle` → `Meta title`, `hero_image` → `Hero image`. */
export function humanize(name: string): string {
  const words = name
    .replace(/^_+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

/** A Payload label (string, `{ en: … }`, or a function we can't call) as text. */
export function labelText(label: unknown, fallback: string): string {
  if (typeof label === "string" && label.trim()) return label;
  if (label && typeof label === "object") {
    const record = label as Record<string, unknown>;
    const value = record.en ?? Object.values(record).find((v) => typeof v === "string");
    if (typeof value === "string" && value.trim()) return value;
  }
  return humanize(fallback);
}

/**
 * Field config → a map by data key. Presentational containers (`row`, `collapsible`, unnamed
 * tabs and groups) put their fields at the parent's level, as Payload stores them.
 */
export function fieldMap(fields: ReadonlyArray<FieldLike> | undefined, blocksBySlug?: ReadonlyMap<string, BlockLike>): FieldMap {
  const map: FieldMap = new Map();
  const add = (list: ReadonlyArray<FieldLike> | undefined) => {
    for (const field of list ?? []) {
      if (!field || typeof field !== "object") continue;
      if (field.type === "tabs") {
        for (const tab of field.tabs ?? []) {
          if (tab.name) map.set(tab.name, { label: labelText(tab.label, tab.name), type: "group", fields: fieldMap(tab.fields, blocksBySlug) });
          else add(tab.fields);
        }
        continue;
      }
      if (!field.name) {
        add(field.fields);
        continue;
      }
      const label = labelText(field.label, field.name);
      switch (field.type) {
        case "group":
          map.set(field.name, { label, type: "group", fields: fieldMap(field.fields, blocksBySlug) });
          break;
        case "array":
          map.set(field.name, { label, type: "array", fields: fieldMap(field.fields, blocksBySlug) });
          break;
        case "blocks": {
          const blocks = new Map<string, { label: string; fields: FieldMap }>();
          for (const entry of [...(field.blocks ?? []), ...(field.blockReferences ?? [])]) {
            const block = typeof entry === "string" ? blocksBySlug?.get(entry) : entry;
            if (block?.slug) blocks.set(block.slug, { label: labelText(block.labels?.singular, block.slug), fields: fieldMap(block.fields, blocksBySlug) });
          }
          map.set(field.name, { label, type: "blocks", blocks });
          break;
        }
        case "richText":
          map.set(field.name, { label, type: "richText" });
          break;
        case "relationship":
        case "upload":
        case "join":
          map.set(field.name, { label, type: "reference" });
          break;
        case "select":
        case "radio": {
          const options = new Map<string, string>();
          for (const option of field.options ?? []) {
            if (typeof option === "string") options.set(option, option);
            else if (option && typeof option.value === "string") options.set(option.value, labelText(option.label, option.value));
          }
          map.set(field.name, { label, type: "select", options });
          break;
        }
        case "checkbox":
          map.set(field.name, { label, type: "checkbox" });
          break;
        case "json":
        case "code":
          map.set(field.name, { label, type: "json" });
          break;
        default:
          map.set(field.name, { label, type: "leaf" });
      }
    }
  };
  add(fields);
  return map;
}

interface Display {
  text: string;
  format: FieldChange["format"];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function referenceText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isPlainObject(value)) {
    // Polymorphic `{ relationTo, value }`, or a populated document.
    if ("relationTo" in value && "value" in value) {
      const inner = referenceText(value.value);
      return inner ? `${String(value.relationTo)} ${inner}` : undefined;
    }
    for (const key of ["title", "name", "filename", "slug", "id"]) {
      const candidate = value[key];
      if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
    }
  }
  return undefined;
}

/** A value as display text, or `undefined` when it is empty (no value, `""`, `[]`, empty rich text). */
export function displayValue(value: unknown, node?: FieldNode): Display | undefined {
  if (value === null || value === undefined) return undefined;
  if (node?.type === "richText" || isLexicalState(value)) {
    if (typeof value === "string") return value.trim() ? { text: value, format: "richText" } : undefined;
    const text = lexicalToText(value);
    if (text) return { text, format: "richText" };
    return isLexicalState(value) ? undefined : jsonDisplay(value);
  }
  if (node?.type === "reference") {
    const values = Array.isArray(value) ? value : [value];
    const texts = values.map(referenceText).filter((t): t is string => Boolean(t));
    return texts.length ? { text: texts.join(", "), format: "text" } : undefined;
  }
  if (node?.type === "select") {
    const values = Array.isArray(value) ? value : [value];
    const texts = values.filter((v) => v !== null && v !== "").map((v) => node.options?.get(String(v)) ?? String(v));
    return texts.length ? { text: texts.join(", "), format: "text" } : undefined;
  }
  if (node?.type === "checkbox" || typeof value === "boolean") return { text: value ? "Yes" : "No", format: "text" };
  if (typeof value === "string") return value === "" ? undefined : { text: value, format: "text" };
  if (typeof value === "number" || typeof value === "bigint") return { text: String(value), format: "text" };
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    if (value.every((v) => typeof v === "string" || typeof v === "number")) return { text: value.join(", "), format: "text" };
  }
  return jsonDisplay(value);
}

function jsonDisplay(value: unknown): Display | undefined {
  if (isPlainObject(value) && Object.keys(value).length === 0) return undefined;
  try {
    return { text: JSON.stringify(value, null, 2) ?? String(value), format: "json" };
  } catch {
    return { text: String(value), format: "text" };
  }
}

function cut(text: string | undefined): { text: string | undefined; truncated: boolean } {
  if (text === undefined || text.length <= MAX_VALUE_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_VALUE_CHARS)}…`, truncated: true };
}

/**
 * - `update`: only what `data` sets (a partial update): its keys, recursively into groups;
 *   arrays and blocks are compared whole, row by row (paired by row `id`, rows without one by
 *   position; a removed row is labelled "(removed)", a reordered one gets a "Position" change).
 * - `create`: every value of `data`.
 * - `delete`: every value of the current document (what will be lost).
 * - `replace`: the union of both (restoring a version over the current document).
 */
export type DiffMode = "update" | "create" | "delete" | "replace";

export interface DiffInput {
  before?: unknown;
  after?: unknown;
  fields?: ReadonlyArray<FieldLike>;
  blocks?: ReadonlyMap<string, BlockLike>;
  mode: DiffMode;
}

export interface DiffResult {
  changes: FieldChange[];
  omitted: number;
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** An unconfigured nested object (not rich text), with nothing or another object on the other side. */
const isGroupValue = (value: unknown, other: unknown) =>
  isPlainObject(value) && !isLexicalState(value) && (other === undefined || other === null || (isPlainObject(other) && !isLexicalState(other)));

const isRowArray =(value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every(isPlainObject) && !value.every(isLexicalState);

/** What an array row with no visible values is called when it is added or removed. */
const EMPTY_ROW = "Empty row";

interface RowPair {
  b?: Record<string, unknown>;
  a: Record<string, unknown>;
  beforeIndex: number;
  afterIndex: number;
  /** Matched by row id (so a different position is a real move), not by position. */
  byId: boolean;
}

/**
 * Pairs the rows of an array or blocks field.
 *
 * 1. Rows with an `id` (Payload gives every array and block row one) pair with the row of the
 *    same id before, wherever it was.
 * 2. Rows without an id (what an assistant writes for a new or rewritten row) pair with the row
 *    at the same position that no id claimed; with none, they are new.
 * 3. Rows before that nothing paired with are removed.
 */
export function pairRows(
  beforeRows: ReadonlyArray<Record<string, unknown>>,
  afterRows: ReadonlyArray<Record<string, unknown>>
): { kept: RowPair[]; removed: Array<{ b: Record<string, unknown>; beforeIndex: number }> } {
  const used = new Set<number>();
  const matchOf = new Map<number, { beforeIndex: number; byId: boolean }>();
  const byId = new Map<unknown, number[]>();
  beforeRows.forEach((row, i) => {
    if (row.id === undefined || row.id === null) return;
    byId.set(row.id, [...(byId.get(row.id) ?? []), i]);
  });
  afterRows.forEach((row, afterIndex) => {
    if (row.id === undefined || row.id === null) return;
    const candidate = (byId.get(row.id) ?? []).find((i) => !used.has(i));
    if (candidate === undefined) return;
    used.add(candidate);
    matchOf.set(afterIndex, { beforeIndex: candidate, byId: true });
  });
  afterRows.forEach((row, afterIndex) => {
    if (row.id !== undefined && row.id !== null) return;
    if (afterIndex < beforeRows.length && !used.has(afterIndex)) {
      used.add(afterIndex);
      matchOf.set(afterIndex, { beforeIndex: afterIndex, byId: false });
    }
  });
  const kept = afterRows.map((a, afterIndex): RowPair => {
    const match = matchOf.get(afterIndex);
    return {
      ...(match ? { b: beforeRows[match.beforeIndex] } : {}),
      a,
      beforeIndex: match?.beforeIndex ?? -1,
      afterIndex,
      byId: match?.byId ?? false,
    };
  });
  const removed = beforeRows.flatMap((b, beforeIndex) => (used.has(beforeIndex) ? [] : [{ b, beforeIndex }]));
  return { kept, removed };
}

/**
 * The `afterIndex` of rows that moved. Inserting or removing a row shifts the rows after it
 * without moving them, so a row counts as moved only if it is outside the longest run of
 * id-matched rows that kept their relative order.
 */
function movedRows(pairs: { kept: RowPair[] }): Set<number> {
  const matched = pairs.kept.filter((p) => p.b && p.byId);
  // Longest increasing subsequence of the before positions, in after order (patience sorting).
  const tails: number[] = [];
  const tailPair: number[] = [];
  const previous: number[] = matched.map(() => -1);
  matched.forEach((pair, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < pair.beforeIndex) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = pair.beforeIndex;
    tailPair[lo] = i;
    previous[i] = lo > 0 ? tailPair[lo - 1]! : -1;
  });
  const stable = new Set<number>();
  for (let i = tailPair[tails.length - 1] ?? -1; i >= 0; i = previous[i]!) stable.add(i);
  const moved = new Set<number>();
  matched.forEach((pair, i) => {
    if (!stable.has(i)) moved.add(pair.afterIndex);
  });
  return moved;
}

export function diffDocument(input: DiffInput): DiffResult {
  const changes: FieldChange[] = [];
  let omitted = 0;
  let total = 0;
  const push = (change: FieldChange) => {
    total += 1;
    if (changes.length >= MAX_CHANGES) omitted += 1;
    else changes.push(change);
  };

  const leaf = (before: unknown, after: unknown, node: FieldNode | undefined, path: string, label: string) => {
    const b = displayValue(before, node);
    const a = displayValue(after, node);
    if (b?.text === a?.text) return;
    const beforeCut = cut(b?.text);
    const afterCut = cut(a?.text);
    push({
      path,
      label,
      kind: b === undefined ? "added" : a === undefined ? "removed" : "changed",
      format: a?.format ?? b?.format ?? "text",
      ...(beforeCut.text !== undefined ? { before: beforeCut.text } : {}),
      ...(afterCut.text !== undefined ? { after: afterCut.text } : {}),
      ...(beforeCut.truncated || afterCut.truncated ? { truncated: true } : {}),
    });
  };

  const rows = (
    before: unknown,
    after: unknown,
    node: FieldNode | undefined,
    path: string,
    label: string
  ) => {
    const beforeRows = Array.isArray(before) ? (before.filter(isPlainObject) as Record<string, unknown>[]) : [];
    const afterRows = Array.isArray(after) ? (after.filter(isPlainObject) as Record<string, unknown>[]) : [];
    const pairs = pairRows(beforeRows, afterRows);
    const moved = movedRows(pairs);
    const marked = pairs.kept.length > 0;

    const rowOf = (row: Record<string, unknown> | undefined, position: number, removed: boolean) => {
      const blockType = String(row?.blockType ?? "");
      const block = node?.blocks?.get(blockType);
      const rowName = block ? ` · ${block.label}` : blockType ? ` · ${humanize(blockType)}` : "";
      return {
        // Next to kept rows, a removed row is named by its position before, with a marker: it can
        // never be mistaken for (or collide with) a kept row, named by its position after.
        rowPath: removed && marked ? `${path}.removed-${position}` : `${path}.${position}`,
        rowLabel: `${label} › ${position + 1}${removed && marked ? " (removed)" : ""}${rowName}`,
        fields: node?.type === "blocks" ? block?.fields : node?.fields,
      };
    };

    for (const pair of pairs.kept) {
      const { rowPath, rowLabel, fields } = rowOf(pair.a, pair.afterIndex, false);
      if (moved.has(pair.afterIndex)) {
        push({
          path: `${rowPath}:moved`,
          label: `${rowLabel} › Position`,
          kind: "changed",
          format: "text",
          before: String(pair.beforeIndex + 1),
          after: String(pair.afterIndex + 1),
        });
      }
      const count = total;
      object(pair.b, pair.a, fields, rowPath, rowLabel, "replace", ROW_KEYS);
      if (!pair.b && total === count) {
        // A new row with nothing in it still changes the page.
        push({ path: rowPath, label: rowLabel, kind: "added", format: "text", after: EMPTY_ROW });
      }
    }
    for (const row of pairs.removed) {
      const { rowPath, rowLabel, fields } = rowOf(row.b, row.beforeIndex, true);
      const count = total;
      object(row.b, undefined, fields, rowPath, rowLabel, "replace", ROW_KEYS);
      if (total === count) push({ path: rowPath, label: rowLabel, kind: "removed", format: "text", before: EMPTY_ROW });
    }
  };

  const object = (
    before: unknown,
    after: unknown,
    nodes: FieldMap | undefined,
    path: string,
    label: string,
    mode: DiffMode,
    skip: ReadonlySet<string>
  ) => {
    const b = isPlainObject(before) ? before : {};
    const a = isPlainObject(after) ? after : {};
    const keys =
      mode === "update" || mode === "create"
        ? Object.keys(a)
        : mode === "delete"
          ? Object.keys(b)
          : [...new Set([...Object.keys(b), ...Object.keys(a)])];
    // Field order from the config first, then unknown keys as they come.
    const order = nodes ? [...nodes.keys()] : [];
    keys.sort((x, y) => {
      const ix = order.indexOf(x);
      const iy = order.indexOf(y);
      return (ix < 0 ? Infinity : ix) - (iy < 0 ? Infinity : iy);
    });
    for (const key of keys) {
      if (skip.has(key)) continue;
      if (mode === "delete" && key === "_status") continue;
      const node = nodes?.get(key);
      const childPath = path ? `${path}.${key}` : key;
      const childLabel = label ? `${label} › ${node?.label ?? humanize(key)}` : (node?.label ?? humanize(key));
      const bv = b[key];
      const av = a[key];
      const asGroup = node ? node.type === "group" : isGroupValue(av, bv) || isGroupValue(bv, av);
      if (asGroup) {
        object(bv, av, node?.fields, childPath, childLabel, mode, NO_KEYS);
      } else if (node?.type === "array" || node?.type === "blocks" || (!node && (isRowArray(av) || isRowArray(bv)))) {
        rows(mode === "create" ? undefined : bv, mode === "delete" ? undefined : av, node, childPath, childLabel);
      } else {
        leaf(mode === "create" ? undefined : bv, mode === "delete" ? undefined : av, node, childPath, childLabel);
      }
    }
  };

  object(input.before, input.after, fieldMap(input.fields, input.blocks), "", "", input.mode, SYSTEM_KEYS);
  return { changes, omitted };
}
