/**
 * Field-editor resolution. For a field shown on the page, the editor is:
 *   1. the field's own choice: admin.custom.onpage.editor ("color", "my-editor")
 *   2. what the element says it shows: an annotation/marker kind of text,
 *      textarea, richtext or media
 *   3. the editor registered for the field's type ("select", "date", "json"…)
 * No match: the field isn't edited in place (it may still be in the row's
 * settings panel).
 */
import type { FieldOf, SchemaField, SchemaFieldType, TargetKind } from '@shipment/onpage-core'
import type { EditorRegistry, FieldEditorDef, FieldEditorProps } from './types.ts'
import type { ComponentType } from 'react'

const KIND_EDITOR: Partial<Record<TargetKind, string>> = { richtext: 'richText', media: 'upload' }
/** Field types a "text" marker or annotation keeps as their own editor (email stays email). */
const TEXT_TYPES: ReadonlySet<SchemaFieldType> = new Set(['text', 'textarea', 'email'])

/** Can this editor take this field? Its declared kinds, and never a list of values in place. */
export function canEdit(
  def: FieldEditorDef | undefined,
  field: SchemaField,
): def is FieldEditorDef {
  if (!def) return false
  if (def.accepts && !def.accepts.includes(field.type)) return false
  return !(def.mode === 'inline' && 'hasMany' in field && field.hasMany)
}

export function resolveEditor(
  editors: EditorRegistry,
  field: SchemaField,
  kind?: TargetKind,
): string | null {
  const ok = (id: string | undefined): id is string => !!id && canEdit(editors[id], field)
  if (ok(field.editor)) return field.editor
  if ((kind === 'text' || kind === 'textarea') && TEXT_TYPES.has(field.type) && ok(field.type))
    return field.type
  const byKind = kind ? KIND_EDITOR[kind] : undefined
  // A "media" marker means the image picker only for upload fields (an <img alt> can show a text field).
  if (ok(byKind) && (byKind !== 'upload' || field.type === 'upload')) return byKind
  return ok(field.type) ? field.type : null
}

/** Merge registries left to right; `null` removes a default. */
export function mergeEditors(
  ...regs: Array<Record<string, EditorRegistry[string] | null> | undefined>
): EditorRegistry {
  const out: EditorRegistry = {}
  for (const r of regs) {
    if (!r) continue
    for (const [k, v] of Object.entries(r)) {
      if (v) out[k] = v
      else delete out[k]
    }
  }
  return out
}

/**
 * Define a field editor typed by the field kinds it accepts:
 *
 *   defineEditor({
 *     mode: 'popover',
 *     accepts: ['number'],
 *     normalize: (raw) => (typeof raw === 'number' ? raw : null),
 *     component: ({ field, value }) => … // field: NumberField, value: number | null
 *   })
 */
export function defineEditor<T extends SchemaFieldType, V = unknown>(def: {
  mode: FieldEditorDef['mode']
  accepts: readonly T[]
  normalize?: (raw: unknown, field: FieldOf<T>) => V
  component: ComponentType<FieldEditorProps<FieldOf<T>, V>>
}): FieldEditorDef {
  // Widened once, here: resolveEditor only hands it fields whose type is in `accepts`,
  // and FieldHost runs `normalize` before rendering.
  return def as unknown as FieldEditorDef
}
