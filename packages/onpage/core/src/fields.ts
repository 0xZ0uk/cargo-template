/**
 * Schema-aware operations on document data: find the field behind a path, build
 * new blocks/rows from defaults, clone rows with fresh ids, and normalize data
 * for saving (populated relations back to ids).
 */
import { getAt, newRowId, parsePath, splitItemPath, type PathSegment } from './path.ts'
import { mapLexical } from './lexical.ts'
import type {
  ArrayField,
  BlocksField,
  DocumentSchema,
  GroupField,
  ListField,
  RelationField,
  SchemaBlock,
  SchemaField,
} from './schema.ts'
import { isListField } from './schema.ts'
import { assertNever } from './util.ts'

export interface FieldAtPath {
  field: SchemaField
  /** The block whose fields contain this field, when inside a blocks row. */
  block?: SchemaBlock | undefined
  /** Path of the nearest blocks row ("sections.3"), when inside one. */
  blockPath?: string | undefined
}

type Data = Record<string, unknown>

const isData = (value: unknown): value is Data =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** The block a blocks-field row uses (by its `blockType`). */
export const blockFor = (field: BlocksField, row: unknown): SchemaBlock | undefined =>
  isData(row) ? field.blocks.find((b) => b.slug === row.blockType) : undefined

/** The fields of one row of a list field: the block's fields, or the array's. */
export const rowFieldsOf = (field: ListField, row: unknown): SchemaField[] | undefined =>
  field.type === 'blocks' ? blockFor(field, row)?.fields : field.fields

/** A field that holds other fields' data. */
type Container = GroupField | ArrayField | BlocksField
/** Any other field: its value is handled as one unit. */
export type LeafField = Exclude<SchemaField, Container>

export interface FieldVisitor {
  /** Every field that isn't a group, array or blocks field. Return the value unchanged to keep it. */
  leaf: (value: unknown, field: LeafField, path: string) => unknown
  /** Each array/blocks row (a copy), before its fields are visited: e.g. give it a new id. */
  row?: (row: Data, path: string) => Data
  /** A blocks row with an unknown `blockType`. Default: kept as is. */
  unknownBlock?: (row: unknown) => unknown
}

/**
 * Rebuild document data field by field. Groups, array rows and block rows are
 * walked here, once, for every schema-aware transform (cloning, normalizing for
 * a save, encoding markers); `visit` only says what to do with leaf fields.
 * Values of fields missing from `data` stay missing; untouched values are shared.
 */
export function mapFields(
  data: unknown,
  fields: SchemaField[],
  visit: FieldVisitor,
  prefix = '',
): unknown {
  if (!isData(data)) return data
  const out: Data = { ...data }
  for (const f of fields)
    if (f.name in out)
      out[f.name] = mapField(out[f.name], f, visit, prefix ? `${prefix}.${f.name}` : f.name)
  return out
}

/** One field's value (see `mapFields`). */
export function mapField(
  value: unknown,
  field: SchemaField,
  visit: FieldVisitor,
  path: string,
): unknown {
  if (value == null) return value
  switch (field.type) {
    case 'group':
      return mapFields(value, field.fields, visit, path)
    case 'array':
    case 'blocks':
      return Array.isArray(value)
        ? value.map((row: unknown, i) => {
            const fields = rowFieldsOf(field, row)
            if (!fields) return visit.unknownBlock ? visit.unknownBlock(row) : row
            const rowPath = `${path}.${i}`
            const base = isData(row) && visit.row ? visit.row({ ...row }, rowPath) : row
            return mapFields(base, fields, visit, rowPath)
          })
        : value
    default:
      return visit.leaf(value, field, path)
  }
}

/** May the editor change this path? (Its top-level field must be editable.) */
export const isEditablePath = (schema: DocumentSchema, path: string): boolean =>
  schema.editable.includes(path.split('.')[0] ?? '')

export interface RowInfo {
  /** "layout.2" */
  path: string
  /** "layout" */
  listPath: string
  index: number
  length: number
  listField: ListField
  /** Fields of this row: the block's fields, or the array's. */
  rowFields: SchemaField[]
  /** Singular label of one row ("Hero", "Feature"). */
  label: string
  isBlock: boolean
}

/** Everything the editor needs about one row of an array or blocks field, or null if `path` isn't an editable row. */
export function resolveRow(schema: DocumentSchema, doc: unknown, path: string): RowInfo | null {
  const split = splitItemPath(path)
  if (!split || !isEditablePath(schema, path)) return null
  const [listPath, index] = split
  const listField = fieldAtPath(schema.fields, doc, listPath)?.field
  if (!listField || !isListField(listField)) return null
  const rows = getAt(doc, listPath)
  if (!Array.isArray(rows) || index >= rows.length) return null
  const isBlock = listField.type === 'blocks'
  const block = isBlock ? blockFor(listField, rows[index]) : undefined
  return {
    path,
    listPath,
    index,
    length: rows.length,
    listField,
    rowFields: rowFieldsOf(listField, rows[index]) ?? [],
    label:
      block?.labels.singular ??
      (isBlock ? 'Section' : (listField.labels?.singular ?? listField.label)),
    isBlock,
  }
}

/**
 * Walk the schema along `path`, using the document to resolve block types.
 * Returns the field at the end of the path (for an index segment, the array or
 * blocks field that owns the row).
 */
export function fieldAtPath(
  fields: SchemaField[],
  doc: unknown,
  path: string | PathSegment[],
): FieldAtPath | null {
  const segs = parsePath(path)
  let level: SchemaField[] = fields
  let current: SchemaField | undefined
  let block: SchemaBlock | undefined
  let blockPath: string | undefined
  for (const [i, seg] of segs.entries()) {
    if (typeof seg === 'number') {
      if (!current || !isListField(current)) return null
      if (current.type === 'blocks') {
        const rowPath = segs.slice(0, i + 1)
        block = blockFor(current, getAt(doc, rowPath))
        if (!block) return null
        blockPath = rowPath.join('.')
        level = block.fields
      } else {
        level = current.fields
      }
      continue
    }
    current = level.find((f) => f.name === seg)
    if (!current) return null
    if (current.type === 'group') level = current.fields
  }
  return current ? { field: current, block, blockPath } : null
}

/** Defaults for a set of fields: static `defaultValue`s, nested groups, `minRows` rows. */
export function defaultsFor(fields: SchemaField[]): Data {
  const out: Data = {}
  for (const f of fields) {
    if (f.defaultValue !== undefined) out[f.name] = structuredClone(f.defaultValue)
    else if (f.type === 'group') out[f.name] = defaultsFor(f.fields)
    else if (f.type === 'array')
      out[f.name] = Array.from({ length: f.minRows ?? 0 }, () => newArrayRow(f))
    else if (f.type === 'blocks') out[f.name] = []
    else if (f.required && (f.type === 'text' || f.type === 'textarea')) out[f.name] = f.label
  }
  return out
}

export function newArrayRow(arrayField: ArrayField): Data {
  return { id: newRowId(), ...defaultsFor(arrayField.fields) }
}

export function newBlockRow(block: SchemaBlock): Data {
  return { id: newRowId(), blockType: block.slug, ...defaultsFor(block.fields) }
}

/**
 * A row to preview a block before it's inserted: its defaults with the block's
 * `example` content over them. Every row in it, nested ones included, gets a new id.
 */
export function previewRow(block: SchemaBlock): Data {
  const row = { ...newBlockRow(block), ...block.example, blockType: block.slug }
  return cloneRow(row, block.fields) as Data
}

/** Cloning: every row gets a new id; related documents' ids are kept; other objects are deep-copied. */
const cloning: FieldVisitor = {
  leaf: (value) => (typeof value === 'object' ? structuredClone(value) : value),
  row: (row) => ({ ...row, id: newRowId() }),
  unknownBlock: (row) => structuredClone(row),
}

/**
 * Deep-clone a row (array item or block) giving it, and every nested row, a new
 * id. Ids of related documents (uploads, relationships) are left alone, so a
 * duplicated card still points at the same image.
 */
export function cloneRow(row: unknown, rowFields: SchemaField[]): unknown {
  return isData(row) ? mapFields({ ...row, id: newRowId() }, rowFields, cloning) : row
}

/** The id of a relationship value: a populated doc, `{ relationTo, value }`, or an id. */
export function relationId(v: unknown): string | number | undefined {
  if (v == null) return undefined
  if (typeof v === 'string' || typeof v === 'number') return v
  if (typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if ('relationTo' in o) return relationId(o.value)
  return o.id as string | number | undefined
}

/**
 * A field value as a list: a hasMany value as its items, a single value as a
 * one-item list, nothing as []. `item` keeps or converts each entry (return
 * undefined to drop it).
 */
export function asList<T = unknown>(
  value: unknown,
  many: boolean | undefined,
  item: (v: unknown) => T | undefined = (v) => v as T,
): T[] {
  const raw = many ? (Array.isArray(value) ? value : []) : value == null ? [] : [value]
  return raw.flatMap((v) => {
    const out = item(v)
    return out === undefined ? [] : [out]
  })
}

/** A display title for a relationship value (`titleField` when known, else common title fields, else the id). */
export function relationTitle(v: unknown, titleField?: string): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('relationTo' in o) return relationTitle(o.value, titleField)
    for (const k of [titleField, 'title', 'name', 'label', 'alt', 'filename', 'slug']) {
      if (k && typeof o[k] === 'string' && o[k]) return o[k]
    }
  }
  return String(relationId(v) ?? '')
}

const idOf = (v: unknown): unknown => (v && typeof v === 'object' && 'id' in v ? relationId(v) : v)

function normalizeRelation(value: unknown, field: RelationField): unknown {
  if (value == null) return value
  const one = (v: unknown) => {
    // Polymorphic: { relationTo, value }
    if (Array.isArray(field.relationTo) && v && typeof v === 'object' && 'relationTo' in v) {
      const p = v as { relationTo: string; value: unknown }
      return { relationTo: p.relationTo, value: idOf(p.value) }
    }
    return idOf(v)
  }
  return Array.isArray(value) ? value.map(one) : one(value)
}

/** Normalizing for a save: populated relations become ids, rich text drops populated docs. */
const normalizing: FieldVisitor = {
  leaf: (value, field) => {
    switch (field.type) {
      case 'upload':
      case 'relationship':
        return normalizeRelation(value, field)
      case 'richText':
        return normalizeRichText(value)
      case 'text':
      case 'textarea':
      case 'email':
      case 'code':
      case 'json':
      case 'checkbox':
      case 'point':
      case 'number':
      case 'date':
      case 'select':
      case 'radio':
        return value
      default:
        return assertNever(field, 'field type')
    }
  },
}

/**
 * Turn rendered (populated) data back into what Payload expects on write:
 * uploads and relationships become ids, everything else passes through.
 */
export function normalizeValue(value: unknown, field: SchemaField): unknown {
  return mapField(value, field, normalizing, field.name)
}

/**
 * Rich text read at depth > 0 has populated relations inside nodes (an upload
 * node's `value`, an internal link's `fields.doc.value`). Payload stores ids, so
 * those go back to ids; nothing else in the tree changes.
 */
export function normalizeRichText(value: unknown): unknown {
  return mapLexical(value, (node) => {
    let out = node
    if ((node.type === 'upload' || node.type === 'relationship') && isPopulated(node.value)) {
      out = { ...out, value: node.value.id }
    }
    const fields = node.fields as { doc?: { value?: unknown } } | undefined
    if (
      (node.type === 'link' || node.type === 'autolink') &&
      fields?.doc &&
      isPopulated(fields.doc.value)
    ) {
      out = { ...out, fields: { ...fields, doc: { ...fields.doc, value: fields.doc.value.id } } }
    }
    return out
  })
}

const isPopulated = (v: unknown): v is { id: string | number } =>
  !!v && typeof v === 'object' && 'id' in v

/** Normalize the given top-level keys of a document for a PATCH body. */
export function buildPatch(
  doc: Record<string, unknown>,
  keys: string[],
  fields: SchemaField[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of keys) {
    const field = fields.find((f) => f.name === key)
    patch[key] = field ? normalizeValue(doc[key], field) : doc[key]
  }
  return patch
}

/** Top-level keys (from `keys`) whose values differ between two documents. */
export function changedKeys(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  keys: string[],
): string[] {
  return keys.filter(
    (k) => prev[k] !== next[k] && JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
  )
}

/** A scalar value as editable text: strings and numbers as-is; null, undefined and objects as ''. */
export function toText(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : ''
}

const sameValue = (field: SchemaField, a: unknown, b: unknown): boolean => {
  if (field.type === 'relationship' || field.type === 'upload') {
    const ids = (v: unknown) =>
      JSON.stringify(
        Array.isArray(v) ? v.map((x) => relationId(x) ?? null) : (relationId(v) ?? null),
      )
    return ids(a) === ids(b)
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * The paths whose values differ between two versions of a document (`after`'s
 * row indexes), for "what changed since published". A row that's new in
 * `after` is reported as a whole (`layout.2`); rows are matched by id, then
 * by position. A list whose length changed is reported too (`layout`).
 */
export function changedPaths(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: SchemaField[],
  base = '',
): string[] {
  const out: string[] = []
  for (const field of fields) {
    const path = base ? `${base}.${field.name}` : field.name
    const a = before?.[field.name]
    const b = after?.[field.name]
    switch (field.type) {
      case 'group':
        out.push(...changedPaths(asDoc(a), asDoc(b), field.fields, path))
        break
      case 'array':
      case 'blocks': {
        const prev = Array.isArray(a) ? a : []
        const next = Array.isArray(b) ? b : []
        if (prev.length !== next.length) out.push(path)
        next.forEach((row, i) => {
          const r = asDoc(row)
          const id = r?.id
          const match = asDoc(
            (id !== undefined ? prev.find((p) => asDoc(p)?.id === id) : undefined) ?? prev[i],
          )
          const rowFields =
            field.type === 'array'
              ? field.fields
              : field.blocks.find((bk) => bk.slug === r?.blockType)?.fields
          if (!match || !rowFields || (field.type === 'blocks' && match.blockType !== r?.blockType))
            out.push(`${path}.${i}`)
          else out.push(...changedPaths(match, r, rowFields, `${path}.${i}`))
        })
        break
      }
      default:
        if (!sameValue(field, a, b)) out.push(path)
    }
  }
  return out
}

const asDoc = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
