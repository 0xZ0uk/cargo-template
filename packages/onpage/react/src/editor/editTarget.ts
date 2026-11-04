/**
 * What clicking or pressing Enter on a field opens: a pure function of the
 * document's state, the editor registry and what was clicked.
 */
import {
  fieldAtPath,
  isEditablePath,
  isReady,
  type DocumentState,
  type RefKey,
  type TargetKind,
} from '@cargo/onpage-core'
import { resolveEditor } from '../registry.ts'
import type { EditingState, EditorRegistry } from '../types.ts'

export type EditTarget =
  /** The document isn't loaded (yet, or it failed). */
  | { kind: 'not-ready'; state: DocumentState | undefined }
  /** Nothing here is edited in place. */
  | { kind: 'none' }
  | { kind: 'edit'; editing: EditingState }

export function resolveEditTarget(
  state: DocumentState | undefined,
  editors: EditorRegistry,
  key: RefKey,
  path: string,
  opts: {
    point?: { x: number; y: number } | undefined
    kind?: TargetKind | undefined
    el?: Element | undefined
  },
): EditTarget {
  if (!isReady(state)) return { kind: 'not-ready', state }
  if (!isEditablePath(state.schema, path)) return { kind: 'none' }
  const hit = fieldAtPath(state.schema.fields, state.doc, path)
  if (!hit) return { kind: 'none' }
  const editor = resolveEditor(editors, hit.field, opts.kind === 'field' ? undefined : opts.kind)
  if (!editor) return { kind: 'none' }
  return { kind: 'edit', editing: { key, path, editor, point: opts.point, el: opts.el } }
}
