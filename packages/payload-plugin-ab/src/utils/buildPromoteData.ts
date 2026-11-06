import type { FlattenedBlock, FlattenedField } from "payload";
import {
  AB_PASS_PERCENTAGE_FIELD,
  AB_PENDING_PERCENTAGES_FIELD,
  AB_VARIANT_OF_FIELD,
} from "../constants";

/**
 * Fields a promotion never copies from the variant onto the original, before the collection's
 * slug field and its `promoteSkipFields`: the A/B fields, the id, the timestamps and
 * authorship Payload maintains, and the publication status (the copy is saved as a draft).
 */
export const DEFAULT_PROMOTE_SKIP_FIELDS: readonly string[] = [
  "id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "_status",
  AB_VARIANT_OF_FIELD,
  AB_PASS_PERCENTAGE_FIELD,
  AB_PENDING_PERCENTAGES_FIELD,
];

/** Field types that hold no data of their own on the document. */
const NO_DATA_TYPES = new Set(["join", "ui"]);

type Row = Record<string, unknown>;

/** A new row id, in the 24-hex-character shape Payload gives array and block rows. */
const newRowId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Gives every array and block row (recursively) a new id, so the original's rows aren't the
 * variant's: relational array tables key rows by id, and the variant's rows still exist until
 * it's deleted. `rowIds` maps the variant's row ids to the new ones; share it across the
 * locales of one promotion, because localized fields inside a row are stored per row id.
 */
function withNewRowIds(
  fields: FlattenedField[],
  data: Row,
  blocks: Record<string, FlattenedBlock | undefined>,
  rowIds: Map<string, string>
): Row {
  const renew = (row: Row): Row => {
    const { id, ...rest } = row;
    if (typeof id !== "string" && typeof id !== "number") return rest;
    const key = String(id);
    if (!rowIds.has(key)) rowIds.set(key, newRowId());
    return { ...rest, id: rowIds.get(key) };
  };
  const out: Row = { ...data };
  for (const field of fields) {
    if (!("name" in field) || !(field.name in out)) continue;
    const value = out[field.name];
    if (field.type === "group" || field.type === "tab") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out[field.name] = withNewRowIds(field.flattenedFields, value as Row, blocks, rowIds);
      }
    } else if (field.type === "array" && Array.isArray(value)) {
      out[field.name] = value.map((row: unknown) => {
        if (!row || typeof row !== "object") return row;
        return withNewRowIds(field.flattenedFields, renew(row as Row), blocks, rowIds);
      });
    } else if (field.type === "blocks" && Array.isArray(value)) {
      out[field.name] = value.map((row: unknown) => {
        if (!row || typeof row !== "object") return row;
        const rest = renew(row as Row);
        const blockType = rest.blockType;
        const block =
          field.blocks
            .map((b) => (typeof b === "string" ? blocks[b] : (b as FlattenedBlock)))
            .find((b) => b?.slug === blockType) ??
          (typeof blockType === "string" ? blocks[blockType] : undefined);
        return block ? withNewRowIds(block.flattenedFields, rest, blocks, rowIds) : rest;
      });
    }
  }
  return out;
}

function deletePath(data: Row, path: string): void {
  const parts = path.split(".");
  let target: unknown = data;
  for (const part of parts.slice(0, -1)) {
    if (!target || typeof target !== "object") return;
    target = (target as Row)[part];
  }
  if (target && typeof target === "object" && !Array.isArray(target)) {
    delete (target as Row)[parts[parts.length - 1]!];
  }
}

/**
 * The data a promotion writes onto the original, from the variant read in one locale (depth 0,
 * so uploads and relationships are ids and are copied by reference, never re-created).
 *
 * Every top-level field that holds data is set, `null` when the variant has no value (so a
 * value the variant cleared is cleared on the original too), except the skipped ones: a
 * skipped field is left out of the data, so the original keeps its own value. `skip` takes
 * top-level names or dot-notation paths into named groups and tabs (`meta.image`). Array and
 * block rows get new ids through `rowIds` (pass the same map for every locale).
 */
export function buildPromoteData(
  variant: Row,
  fields: FlattenedField[],
  skip: readonly string[],
  {
    blocks = {},
    rowIds = new Map(),
  }: { blocks?: Record<string, FlattenedBlock | undefined>; rowIds?: Map<string, string> } = {}
): Row {
  const topLevelSkips = new Set(skip.filter((path) => !path.includes(".")));
  const data: Row = {};
  for (const field of fields) {
    if (!("name" in field) || NO_DATA_TYPES.has(field.type)) continue;
    if ((field as { virtual?: unknown }).virtual) continue;
    if (topLevelSkips.has(field.name)) continue;
    const value = variant[field.name];
    data[field.name] = value === undefined ? null : structuredClone(value);
  }
  const copied = withNewRowIds(fields, data, blocks, rowIds);
  for (const path of skip) if (path.includes(".")) deletePath(copied, path);
  return copied;
}
