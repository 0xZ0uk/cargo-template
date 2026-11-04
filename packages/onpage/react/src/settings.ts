/**
 * Which fields of a row appear in its settings panel: values that aren't edited
 * on the page itself (layout selects, toggles, numbers, links, images that
 * aren't shown…). Fields shown on the page are edited there instead.
 */
import type { SchemaField, SchemaFieldType, RefKey } from '@cargo/onpage-core'
import type { TargetIndex } from './types.ts'

/** Row bookkeeping, never a setting. */
const SKIP = new Set(['id', 'blockType', 'blockName'])

/**
 * Never in page settings: the page's own address. Changing it from the page
 * would leave the editor on a URL its draft no longer answers to.
 */
const PAGE_SKIP = new Set(['slug'])

/** `path` + `name`, for a top-level path (`''`) too. */
export const joinPath = (path: string, name: string) => (path ? `${path}.${name}` : name)

/** Types shown in the panel when the page doesn't show them (choices and toggles always are). */
const PANEL_FIELD_TYPES: ReadonlySet<SchemaFieldType> = new Set([
  'text',
  'textarea',
  'email',
  'number',
  'date',
  'relationship',
  'upload',
])

export function settable(
  field: SchemaField,
  path: string,
  key: RefKey,
  targets: TargetIndex,
): boolean {
  if (SKIP.has(field.name) || (!path && PAGE_SKIP.has(field.name))) return false
  const full = joinPath(path, field.name)
  switch (field.type) {
    case 'select':
    case 'radio':
    case 'checkbox':
      return true
    case 'group':
      return field.fields.some((f) => settable(f, full, key, targets))
    case 'array':
      // A list the page doesn't show (a hero's links, a card's tags): edit its rows here.
      return !targets.find(key, full) && !targets.find(key, `${full}.0`)
    default:
      // Shown on the page? Edit it there.
      return PANEL_FIELD_TYPES.has(field.type) && !targets.find(key, full)
  }
}

export const hasSettings = (
  fields: SchemaField[],
  path: string,
  key: RefKey,
  targets: TargetIndex,
): boolean => fields.some((f) => settable(f, path, key, targets))
