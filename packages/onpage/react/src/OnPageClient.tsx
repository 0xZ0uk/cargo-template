'use client'

/**
 * Client mode: render a document from editor state, so edits show instantly
 * (no save → server render round trip). Outside an editor it just renders the
 * document it was given.
 *
 *   <OnPageClient doc={page} collection="pages" render={(page, e) => <Page page={page} e={e} />} />
 *
 * `e` is the document's annotation helper (`e.field('title')`, `e.row('layout.0')`).
 * Text is auto-mapped as in refresh mode: the rendered state carries the same
 * invisible markers (turn off with `autoMap={false}`).
 */
import { useEvent } from './useEvent.ts'
import { toRef } from './annotations.ts'
import { encodeDocument, refKey, type DocRef } from '@cargo/onpage-core'
import { useEffect, useMemo, type ReactNode } from 'react'
import { editable, editableOff, type Editable } from './annotations.ts'
import { useOnPageOptional, useSessionSnapshot } from './context.tsx'

export type OnPageClientProps<T> = {
  doc: T
  render: (doc: T, e: Editable) => ReactNode
  /** Mark rendered text so it maps to its fields without annotations. Default true. */
  autoMap?: boolean
} & ({ collection: string; global?: never } | { global: string; collection?: never })

export function OnPageClient<T extends { id?: string | number } | null | undefined>(
  props: OnPageClientProps<T>,
) {
  const { doc, render, global: globalSlug, collection } = props
  const ctx = useOnPageOptional()
  const id = doc?.id
  const ref = useMemo<DocRef | null>(
    () =>
      globalSlug
        ? toRef({ global: globalSlug })
        : collection
          ? toRef({ collection, doc: { id } })
          : null,
    [globalSlug, collection, id],
  )
  const key = ref ? refKey(ref) : null
  const enabled = !!ctx && !!ref

  // Join the editor once it's there: render from its state (it adopts this page's value).
  const join = useEvent((r: DocRef) => {
    if (!ctx) return undefined
    const off = ctx.registerClientDoc(refKey(r))
    void ctx.session.open(r, doc ?? undefined)
    return off
  })
  useEffect(() => (enabled && ref ? join(ref) : undefined), [enabled, ref, join])

  const snap = useSessionSnapshot(ctx?.session)
  const state = key ? snap.docs[key] : undefined
  const stateDoc = state?.doc
  const fields = state?.schema?.fields
  const autoMap = props.autoMap !== false
  const current = useMemo(() => {
    if (!stateDoc) return doc
    return autoMap && fields && key ? encodeDocument(stateDoc, fields, key) : stateDoc
  }, [stateDoc, fields, key, autoMap, doc])
  const e = useMemo(
    () => (enabled && ref ? editable(ref, { enabled: true }) : editableOff),
    [enabled, ref],
  )
  // The session's copy started as this `doc` (same document, edited, held as plain JSON),
  // so it is handed back as the page's own type.
  return <>{render(current as T, e)}</>
}
