'use client'

import { fieldAtPath, getAt, isReady, type ReadyDocumentState } from '@cargo/onpage-core'
import { Suspense, useCallback } from 'react'
import { useOnPage } from '../context.tsx'
import { canEdit } from '../registry.ts'
import type { EditingState, FieldEditorDef, FieldEditorProps } from '../types.ts'

/** Renders the open field editor, if it belongs to this layer. */
export function FieldHost({ mode }: { mode: 'inline' | 'popover' }) {
  const { editing, editors, snap } = useOnPage()
  if (!editing) return null
  const def = editors[editing.editor]
  const state = snap.docs[editing.key]
  if (!def || def.mode !== mode || !isReady(state)) return null
  return <OpenEditor editing={editing} def={def} state={state} />
}

/** The editor for one field of a loaded document. */
function OpenEditor({
  editing,
  def,
  state,
}: {
  editing: EditingState
  def: FieldEditorDef
  state: ReadyDocumentState
}) {
  const { session, targets, setEditing, addGhost, isLive, t } = useOnPage()
  const { key, path, el: clicked } = editing
  const live = isLive(key)

  const element = useCallback(
    () => (clicked?.isConnected ? clicked : (targets.find(key, path)?.el ?? null)),
    [clicked, targets, key, path],
  )
  const close = useCallback(() => {
    session.cancelTransient(key)
    setEditing(null)
  }, [session, key, setEditing])
  const commit = useCallback(
    (value: unknown) => {
      session.setValue(key, path, value)
      if (!live) void session.flush() // refresh mode: show it as soon as possible
    },
    [session, key, path, live],
  )
  const preview = useCallback(
    (value: unknown) => session.setValue(key, path, value, { transient: true }),
    [session, key, path],
  )
  const ghost = useCallback<FieldEditorProps['ghost']>(
    (g) => addGhost({ key, path, ...g }),
    [addGhost, key, path],
  )

  const field = fieldAtPath(state.schema.fields, state.doc, path)?.field
  if (!field || !canEdit(def, field)) return null
  const Editor = def.component
  const raw = getAt(state.doc, path)
  // Editors may be lazy (the rich-text editor is): render nothing until they've loaded.
  return (
    <Suspense fallback={null}>
      <Editor
        key={`${key}|${path}`}
        docKey={key}
        path={path}
        field={field}
        element={element}
        value={def.normalize ? def.normalize(raw, field) : raw}
        commit={commit}
        preview={preview}
        close={close}
        ghost={ghost}
        live={live}
        point={editing.point}
        t={t}
      />
    </Suspense>
  )
}
