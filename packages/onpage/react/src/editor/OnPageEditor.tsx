'use client'

/**
 * The on-page editor. Mount it once (the Next adapter's <OnPage /> does) and
 * it finds editable content through the Locator, opens each document it finds
 * in an EditorSession, and edits through the field-editor registry. Saves go
 * through the DataSource; the Renderer shows them (server refresh by default,
 * instant for documents rendered with <OnPageClient>).
 */
import {
  refKey,
  type AssistPort,
  type DataSource,
  type DocRef,
  type Locator,
  type MediaLibrary,
  type RefKey,
  type Renderer,
} from '@cargo/onpage-core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { OnPageProvider, useSessionSnapshot } from '../context.tsx'
import { useDocumentLocks } from './useDocumentLocks.ts'
import { useInvalidTargets } from './useInvalidTargets.ts'
import { useSessionEvents } from './useSessionEvents.ts'
import { isRtlLocale, UI } from '../dom.ts'
import { defaultEditors } from '../editors/index.ts'
import { hub } from '../hub.ts'
import { notifyLayout } from '../layout.ts'
import { annotations, composite, stega } from '../locators.ts'
import { createTranslate, type Messages } from '../messages.ts'
import { mergeEditors } from '../registry.ts'
import { clientState } from '../renderers.ts'
import { useTargets } from '../targets.ts'
import type {
  EditingState,
  FieldEditorDef,
  Links,
  OnPageApi,
  OnPageState,
  Panel,
  Selection,
  OnPageEvent,
} from '../types.ts'
import { OnDemandPanels } from '../ui/OnDemand.tsx'
import { Dock } from '../ui/Dock.tsx'
import { Overlay } from '../ui/Overlay.tsx'
import { useEditorStyles, useIsClient } from '../useIsClient.ts'
import { useEvent } from '../useEvent.ts'
import { resolveEditTarget } from './editTarget.ts'
import { FieldHost } from './FieldHost.tsx'
import { Ghosts } from './Ghosts.tsx'
import { useClientDocs } from './useClientDocs.ts'
import { useEditorSession } from './useEditorSession.ts'
import { useFlash } from './useFlash.ts'
import { useGhosts } from './useGhosts.ts'
import { usePageEvents } from './usePageEvents.ts'

export interface OnPageEditorProps {
  dataSource: DataSource
  /** Image search/upload (e.g. `payloadUploads()`). Without it, upload fields can't be changed. */
  media?: MediaLibrary | undefined
  /** How elements map to fields. Default: composite(annotations(), stega()). */
  locator?: Locator | undefined
  /** How saved changes reach the page. Default: clientState() (no server refresh). */
  renderer?: Renderer | undefined
  /** Extra or replacement field editors by id; `null` removes a default. */
  editors?: Record<string, FieldEditorDef | null> | undefined
  links: Links
  /** Content locale to edit. */
  locale?: string | undefined
  /** Autosave debounce, ms. Default: 250 with a refreshing renderer; else the collection's autosave interval, else 800. */
  autosaveDelay?: number | undefined
  /** Where to look for editable content. Default: document.body. */
  root?: (() => ParentNode | null) | undefined
  /** Override any UI string (see `defaultMessages`). */
  messages?: Messages | undefined
  /** The language of the UI strings, for plurals, dates and times. Default "en"; set it with `messages`. */
  uiLocale?: string | undefined
  /**
   * Saves, conflicts, publishes and failures, for logging or error reporting
   * (e.g. Sentry). Called after the editor has handled them.
   */
  onEvent?: ((event: OnPageEvent) => void) | undefined
  /**
   * A writing assistant for text fields (rewrite, shorten, fix, translate…).
   * Bring your own: payload-onpage bundles no AI vendor. See the assist guide.
   */
  assist?: AssistPort | undefined
}

/** How long a re-rendered page gets to land (and the locator to rescan) before ghosts are retired. */
const SETTLE_MS = 250

export function OnPageEditor(props: OnPageEditorProps) {
  const { dataSource, locale, links, media } = props
  const renderer = useMemo(() => props.renderer ?? clientState(), [props.renderer])
  const locator = useMemo(() => props.locator ?? composite(annotations(), stega()), [props.locator])
  const editors = useMemo(() => mergeEditors(defaultEditors, props.editors), [props.editors])
  const t = useMemo(
    () => createTranslate(props.messages, props.uiLocale),
    [props.messages, props.uiLocale],
  )
  const rootProp = props.root
  const root = useCallback(
    () => (rootProp ? rootProp() : typeof document === 'undefined' ? null : document.body),
    [rootProp],
  )

  const [panel, setPanel] = useState<Panel>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [renders, setRenders] = useState(0)
  const [flash, notify] = useFlash()
  const [clientDocs, registerClientDoc] = useClientDocs()
  const isLive = useCallback(
    (key: RefKey) => renderer.live || clientDocs.has(key),
    [renderer, clientDocs],
  )

  // Refresh mode saves quickly (the page only updates after a save); client mode uses the collection's interval.
  const session = useEditorSession({
    dataSource,
    locale,
    autosaveDelay: props.autosaveDelay ?? (renderer.live ? undefined : 250),
    onSaved: (ref, seq) => void rerender([ref], seq),
  })
  const snap = useSessionSnapshot(session)
  const report = useEvent((event: OnPageEvent) => {
    if (props.onEvent) props.onEvent(event)
    else if (event.type === 'error')
      console.error(`[payload-onpage] ${event.where} failed`, event.error)
  })
  useSessionEvents(session, report)
  const targets = useTargets(locator, root)
  const { ghosts, add: addGhostEntry, rendered: ghostsRendered } = useGhosts(session ? snap : null)

  // Pending "retire ghosts" timers, cleared on unmount.
  const ghostTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = ghostTimers.current
    return () => {
      for (const id of timers) clearTimeout(id)
      timers.clear()
    }
  }, [])

  /** Re-render documents that aren't client-rendered, then retire their ghosts. */
  const rerender = useEvent(async (refs: DocRef[], seq?: number) => {
    const stale = refs.filter((r) => !isLive(refKey(r)))
    if (!stale.length) return
    setRenders((n) => n + 1)
    try {
      await renderer.afterSave({ refs: stale })
    } catch (e) {
      report({ type: 'error', where: 'render', error: e })
    } finally {
      setRenders((n) => n - 1)
      const id = setTimeout(() => {
        ghostTimers.current.delete(id)
        for (const r of stale) ghostsRendered(refKey(r), seq ?? Number.MAX_SAFE_INTEGER)
      }, SETTLE_MS)
      ghostTimers.current.add(id)
    }
  })

  // Documents on this page: everything the locator found, plus client-mode documents.
  const docKeys = useMemo(() => {
    const keys = new Set<RefKey>(clientDocs)
    for (const target of targets.all) keys.add(refKey(target.ref))
    return [...keys]
  }, [targets, clientDocs])

  useEffect(() => {
    if (!session) return
    const seen = new Set<RefKey>()
    for (const target of targets.all) {
      const key = refKey(target.ref)
      if (seen.has(key)) continue
      seen.add(key)
      void session.open(target.ref)
    }
  }, [targets, session])

  useEffect(() => notifyLayout(), [snap, targets])

  const addGhost = useEvent<OnPageApi['addGhost']>((g) =>
    addGhostEntry(g, session?.get(g.key)?.save.seq ?? 0),
  )

  // Stable: reads the latest state when called, so the API doesn't change on every rescan.
  const edit = useEvent<OnPageApi['edit']>((key, path, opts = {}) => {
    const target = resolveEditTarget(session?.get(key), editors, key, path, {
      point: opts.point,
      kind: opts.kind,
      el: opts.anchor ?? targets.find(key, path)?.el,
    })
    switch (target.kind) {
      case 'not-ready':
        if (target.state?.status === 'error')
          notify(t('notify.cantEdit', { message: target.state.error ?? '' }), true)
        else notify(t('notify.loading'))
        return true
      case 'none':
        return false
      case 'edit':
        setEditing(target.editing)
        return true
    }
  })

  const api = useMemo<OnPageApi | null>(
    () =>
      session && {
        session,
        renderer,
        media,
        editors,
        links,
        t,
        setPanel,
        setEditing,
        setSelected,
        isLive,
        registerClientDoc,
        edit,
        rerender: (refs) => rerender(refs),
        notify,
        report,
        assist: props.assist,
        addGhost,
      },
    [
      session,
      renderer,
      media,
      editors,
      links,
      t,
      isLive,
      registerClientDoc,
      edit,
      rerender,
      notify,
      report,
      props.assist,
      addGhost,
    ],
  )
  const lockedBy = useDocumentLocks(session, docKeys)
  useInvalidTargets(snap, targets, docKeys)
  const state = useMemo<OnPageState>(
    () => ({
      snap,
      targets,
      panel,
      editing,
      selected,
      docKeys,
      lockedBy,
      rendering: renders > 0,
      flash,
    }),
    [snap, targets, panel, editing, selected, docKeys, lockedBy, renders, flash],
  )

  // Components outside the editor's tree (client-mode documents) reach it through the hub.
  useEffect(() => {
    hub.set(api)
  }, [api])
  useEffect(() => () => hub.set(null), [])
  useEditorStyles()
  usePageEvents(api && { ...api, ...state }, root)

  const mounted = useIsClient()
  if (!mounted || !api) return null

  return (
    <OnPageProvider api={api} state={state}>
      {createPortal(
        <div className="po-doc-layer" {...{ [UI]: '' }}>
          <Ghosts ghosts={ghosts} />
          <FieldHost mode="inline" />
        </div>,
        document.body,
      )}
      {createPortal(
        <div className="po-layer" dir={isRtlLocale(t.locale) ? 'rtl' : 'ltr'} {...{ [UI]: '' }}>
          <Overlay />
          <OnDemandPanels />
          <FieldHost mode="popover" />
          <Dock />
        </div>,
        document.body,
      )}
    </OnPageProvider>
  )
}
