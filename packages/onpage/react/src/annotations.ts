/**
 * Annotations — optional, precise mapping from elements to fields. Pure and
 * dependency-free, so they work in server components. When `enabled` is false
 * every helper returns `{}`: public HTML carries nothing.
 *
 *   const e = editable({ collection: 'pages', doc: page }, { enabled })
 *   <section {...e.row('layout.2')}>
 *     <h2 {...e.field('layout.2.heading')}>…</h2>
 *     <img {...e.media('layout.2.image')} />
 *     <ul {...e.list('layout.2.items', 'Item')}> <li {...e.row('layout.2.items.0')}>
 *
 * Auto-mapping (stega) already maps most text without any of this; annotate
 * images that have no alt, layout rows you want exact, and lists ("+ Add").
 */
import { refKey, type DocRef, type TargetKind } from '@cargo/onpage-core'

/** What an annotated element shows (`field` = resolve from the schema). */
export type FieldKind = Exclude<TargetKind, 'item' | 'list'>

export const ATTR = {
  ref: 'data-onpage-ref',
  field: 'data-onpage-field',
  kind: 'data-onpage-kind',
  row: 'data-onpage-row',
  list: 'data-onpage-list',
  label: 'data-onpage-label',
} as const

type Attrs = Record<string, string>

export interface Editable {
  enabled: boolean
  /** An element showing one field. `kind` defaults to "field" (resolved from the schema). */
  field(path: string, kind?: FieldKind, label?: string): Attrs
  /** An element showing an upload field (image). */
  media(path: string, label?: string): Attrs
  /** A row of a blocks or array field (a section, a card, a button). */
  row(path: string, label?: string): Attrs
  /** The element holding an array's rows (gets "+ Add"). `itemLabel` names one row. */
  list(path: string, itemLabel?: string): Attrs
}

const none = (): Attrs => ({})
export const editableOff: Editable = {
  enabled: false,
  field: none,
  media: none,
  row: none,
  list: none,
}

export type EditableTarget =
  | DocRef
  | { collection: string; doc: { id?: string | number | undefined } | null | undefined }
  | { global: string }

export function toRef(t: EditableTarget): DocRef | null {
  if ('kind' in t) return t
  if ('global' in t) return { kind: 'global', slug: t.global }
  return t.doc?.id == null ? null : { kind: 'collection', slug: t.collection, id: t.doc.id }
}

/** Annotation helpers bound to one document. */
export function editable(target: EditableTarget, opts: { enabled: boolean }): Editable {
  const ref = opts.enabled ? toRef(target) : null
  if (!ref) return editableOff
  const key = refKey(ref)
  const base = (extra: Attrs, label?: string): Attrs => ({
    [ATTR.ref]: key,
    ...extra,
    ...(label ? { [ATTR.label]: label } : {}),
  })
  return {
    enabled: true,
    field: (path, kind = 'field', label) => base({ [ATTR.field]: path, [ATTR.kind]: kind }, label),
    media: (path, label) => base({ [ATTR.field]: path, [ATTR.kind]: 'media' }, label),
    row: (path, label) => base({ [ATTR.row]: path }, label),
    list: (path, itemLabel) => base({ [ATTR.list]: path }, itemLabel),
  }
}

/** Join path parts: p("layout", 2, "heading") → "layout.2.heading". */
export const p = (...parts: Array<string | number>): string => parts.join('.')
