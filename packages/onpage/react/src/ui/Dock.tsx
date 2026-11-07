'use client'

/**
 * The bottom bar: save status across the page's documents (with per-document
 * recovery: reload after a conflict, retry after an error), undo/redo, locale,
 * share link, preview, discard, admin, exit and publish.
 */
import { errorText } from '@shipment/onpage-core'
import type { DocumentState } from '@shipment/onpage-core'
import { useEffect, useState } from 'react'
import { useOnPage } from '../context.tsx'
import { relativeTime, type Translate } from '../messages.ts'
import { PostButton } from './PostButton.tsx'
import { ToolbarButton } from './ToolbarButton.tsx'
import { RedoIcon, UndoIcon } from '../icons.tsx'
import { shortcut } from '../dom.ts'
import { usePageSettings } from './usePageSettings.ts'
import type { Flash } from '../types.ts'

const title = (d: DocumentState) => d.schema?.labels.singular ?? d.ref.slug

interface DockState {
  docs: DocumentState[]
  ready: DocumentState[]
  failed: DocumentState | undefined
  conflict: DocumentState | undefined
  error: DocumentState | undefined
  saving: boolean
  rendering: boolean
  lastSaved: number
}

/** What the dock says, most urgent first. */
function dockStatus(s: DockState, t: Translate): Flash {
  if (s.failed)
    return {
      text: t('dock.unavailable', { doc: title(s.failed), error: s.failed.error ?? '' }),
      bad: true,
    }
  if (!s.docs.length) return { text: t('dock.nothing') }
  if (!s.ready.length) return { text: t('dock.loading') }
  if (s.conflict) return { text: t('dock.conflict', { doc: title(s.conflict) }), bad: true }
  if (s.error)
    return {
      text: t('dock.saveFailed', { doc: title(s.error), message: s.error.save.message ?? '' }),
      bad: true,
    }
  if (s.saving) return { text: t('dock.saving') }
  if (s.rendering) return { text: t('dock.updating') }
  if (s.lastSaved)
    return { text: t('dock.saved', { ago: relativeTime(s.lastSaved, Date.now(), t.locale) }) }
  return { text: t('dock.editing') }
}

function useTicker(ms: number) {
  const [, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/**
 * How many comments are open on the page's documents (null: comments are off).
 * Asked again whenever the comments panel closes.
 */
function useOpenComments(docs: DocumentState[], panelOpen: boolean): number | null {
  const { session } = useOnPage()
  const ds = session.dataSource
  const ids = docs
    .filter((d) => d.schema?.comments)
    .map((d) => JSON.stringify(d.ref))
    .join('|')
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const list = ds.listComments?.bind(ds)
    if (!list || !ids || panelOpen) return
    let live = true
    Promise.all(ids.split('|').map((r) => list(JSON.parse(r) as DocumentState['ref']))).then(
      (all) => live && setCount(all.flat().filter((c) => !c.resolved).length),
      () => live && setCount(0),
    )
    return () => {
      live = false
    }
  }, [ds, ids, panelOpen])
  return ds.listComments && ids ? (count ?? 0) : null
}

export function Dock() {
  const {
    session,
    snap,
    links,
    rendering,
    notify,
    report,
    rerender,
    docKeys,
    flash,
    t,
    panel,
    setPanel,
    lockedBy,
  } = useOnPage()
  const pageSettings = usePageSettings()
  const canMakePages =
    !!(session.dataSource.duplicatePage || session.dataSource.createPage) &&
    docKeys.some((k) => k.startsWith('c:'))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  useTicker(5000)
  useEffect(() => {
    if (!confirmDiscard) return
    const id = setTimeout(() => setConfirmDiscard(false), 4000)
    return () => clearTimeout(id)
  }, [confirmDiscard])

  const docs = docKeys.map((k) => snap.docs[k]).filter((d): d is DocumentState => !!d)
  const locked = docs.find((d) => lockedBy[d.key])
  const ready = docs.filter((d) => d.status === 'ready')
  const openComments = useOpenComments(ready, panel?.kind === 'comments')
  // Publishing needs a right some editors don't have: they ask for a review instead.
  const cantPublish = ready.some((d) => d.schema?.canPublish === false)
  // No drafts: every save is a live change. Say so, once.
  const liveDoc = ready.find((d) => d.schema && !d.schema.drafts)
  const failed = docs.find((d) => d.status === 'error')
  const conflict = docs.find((d) => d.save.status === 'conflict')
  const error = docs.find((d) => d.save.status === 'error')
  const saving = docs.some((d) => d.save.status === 'saving' || d.save.status === 'pending')
  const lastSaved = Math.max(0, ...docs.map((d) => d.save.lastSavedAt ?? 0))
  const primary = docs[0]
  const busy = snap.busy

  const retryable = failed ?? error
  const status = dockStatus(
    { docs, ready, failed, conflict, error, saving, rendering, lastSaved },
    t,
  )

  const schema = ready[0]?.schema
  const nonDefaultLocale =
    schema?.defaultLocale && session.locale && session.locale !== schema.defaultLocale

  const publish = async () => {
    try {
      const res = await session.publish({ keys: docKeys })
      if (res.published.length) report({ type: 'published', refs: res.published })
      if (res.published.length) await rerender(res.published)
      if (res.ok) notify(t(res.published.length ? 'notify.published' : 'notify.nothingToPublish'))
      else {
        report({ type: 'publishFailed', message: res.message ?? '' })
        notify(t('notify.publishFailed', { message: res.message ?? '' }), true)
      }
    } catch (e) {
      report({ type: 'error', where: 'publish', error: e })
      notify(t('notify.publishFailed', { message: errorText(e) }), true)
    }
  }
  const discard = async () => {
    // Two-step: the first click arms, the second (within 4s) discards.
    if (!confirmDiscard) return setConfirmDiscard(true)
    setConfirmDiscard(false)
    try {
      await session.discard({ keys: docKeys })
      notify(t('notify.discarded'))
    } catch (e) {
      notify(errorText(e), true)
    }
  }
  const keepMine = async (d: DocumentState) => {
    try {
      await session.keepMine(d.key)
      await rerender([d.ref])
      notify(t('notify.merged'))
    } catch (e) {
      notify(errorText(e), true)
    }
  }
  const reload = async (d: DocumentState) => {
    try {
      await session.reload(d.key)
      await rerender([d.ref])
    } catch (e) {
      notify(errorText(e), true)
    }
  }
  const createLink = session.dataSource.createPreviewLink?.bind(session.dataSource)
  const share = async () => {
    if (!createLink || !primary) return
    try {
      const { url, expiresAt } = await createLink(primary.ref, { locale: session.locale })
      await navigator.clipboard.writeText(url)
      notify(
        t('notify.linkCopied', {
          date: new Date(expiresAt).toLocaleString(t.locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        }),
      )
    } catch (e) {
      report({ type: 'error', where: 'share', error: e })
      notify(t('notify.linkFailed', { message: errorText(e) }), true)
    }
  }

  return (
    <>
      {nonDefaultLocale && (
        <div className="po-notice" role="note" data-testid="onpage-locale-notice">
          {t('dock.localeNotice', { locale: session.locale ?? '' })}
        </div>
      )}
      <div
        className="po-dock"
        role="toolbar"
        aria-label={t('dock.label')}
        data-testid="onpage-dock"
      >
        <span
          className={`po-status${(flash?.bad ?? status.bad) ? ' is-bad' : ''}`}
          role="status"
          aria-live="polite"
          data-testid="onpage-status"
        >
          {flash?.text ?? status.text}
        </span>
        {conflict && (
          <>
            <button
              type="button"
              className="po-btn"
              disabled={busy}
              onClick={() => void keepMine(conflict)}
              title={t('dock.keepMineHint')}
              data-testid="onpage-keep-mine"
            >
              {t('dock.keepMine')}
            </button>
            <button
              type="button"
              className="po-btn"
              disabled={busy}
              onClick={() => void reload(conflict)}
              data-testid="onpage-reload"
            >
              {t('dock.reload')}
            </button>
          </>
        )}
        {retryable && (
          <button
            type="button"
            className="po-btn"
            onClick={() => void session.retry(retryable.key)}
            data-testid="onpage-retry"
          >
            {t('dock.retry')}
          </button>
        )}
        {liveDoc && (
          <span
            className="po-chip-lock po-chip-live"
            role="note"
            title={t('dock.liveHint')}
            data-testid="onpage-live-doc"
          >
            {t('dock.live', { doc: title(liveDoc) })}
          </span>
        )}
        {locked && (
          <span
            className="po-chip-lock"
            role="note"
            title={t('dock.lockedHint')}
            data-testid="onpage-locked"
          >
            {t('dock.lockedBy', { name: lockedBy[locked.key] ?? '', doc: title(locked) })}
          </span>
        )}
        {docs.length > 1 && (
          <span
            className="po-docs"
            title={docs.map(title).join(', ')}
            data-testid="onpage-doc-count"
          >
            {t('dock.documents', { count: docs.length })}
          </span>
        )}
        {session.locale && <span className="po-chip-locale">{session.locale}</span>}
        <span className="po-sep" />
        <ToolbarButton
          label={t('dock.undo')}
          hint={`${t('dock.undo')} (${shortcut('Z')})`}
          icon={<UndoIcon />}
          disabled={!snap.canUndo}
          onClick={() => session.undo()}
          testId="onpage-undo"
        />
        <ToolbarButton
          label={t('dock.redo')}
          hint={`${t('dock.redo')} (${shortcut('Z', { shift: true })})`}
          icon={<RedoIcon />}
          disabled={!snap.canRedo}
          onClick={() => session.redo()}
          testId="onpage-redo"
        />
        <span className="po-sep" />
        {(pageSettings.length > 0 || canMakePages) && (
          <button
            type="button"
            className="po-btn"
            aria-expanded={panel?.kind === 'page'}
            onClick={() => setPanel(panel?.kind === 'page' ? null : { kind: 'page' })}
            title={t('dock.pageSettingsHint')}
            data-testid="onpage-page-settings-open"
          >
            {t('dock.pageSettings')}
          </button>
        )}
        {openComments !== null && (
          <button
            type="button"
            className="po-btn"
            aria-expanded={panel?.kind === 'comments'}
            onClick={() => setPanel(panel?.kind === 'comments' ? null : { kind: 'comments' })}
            title={t('dock.commentsHint')}
            data-testid="onpage-comments-open"
          >
            {openComments ? t('dock.commentsCount', { count: openComments }) : t('dock.comments')}
          </button>
        )}
        {session.dataSource.listVersions && ready.length > 0 && (
          <button
            type="button"
            className="po-btn"
            aria-expanded={panel?.kind === 'versions'}
            onClick={() => setPanel(panel?.kind === 'versions' ? null : { kind: 'versions' })}
            title={t('dock.historyHint')}
            data-testid="onpage-versions-open"
          >
            {t('dock.history')}
          </button>
        )}
        {links.mode && (
          <PostButton
            action={links.mode('view')}
            title={t('dock.previewHint')}
            testId="onpage-preview"
          >
            {t('dock.preview')}
          </PostButton>
        )}
        {createLink && primary && (
          <button
            type="button"
            className="po-btn"
            onClick={() => void share()}
            title={t('dock.shareHint')}
            data-testid="onpage-share"
          >
            {t('dock.share')}
          </button>
        )}
        <button
          type="button"
          className={`po-btn${confirmDiscard ? ' is-danger' : ''}`}
          disabled={!ready.length || busy}
          onClick={() => void discard()}
          onBlur={() => setConfirmDiscard(false)}
          title={t('dock.discardHint')}
          data-testid="onpage-discard"
        >
          {t(confirmDiscard ? 'dock.discardConfirm' : 'dock.discard')}
        </button>
        {links.admin && primary && (
          <a
            className="po-btn"
            href={links.admin(primary.ref)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="onpage-open-admin"
          >
            {t('dock.admin')}
          </a>
        )}
        <PostButton action={links.exit} testId="onpage-exit">
          {t('dock.exit')}
        </PostButton>
        <button
          type="button"
          className="po-btn po-primary"
          disabled={!ready.length || busy || !!conflict || cantPublish}
          title={cantPublish ? t('dock.cantPublish') : undefined}
          onClick={() => void publish()}
          data-testid="onpage-publish"
        >
          {t(busy ? 'dock.publishing' : 'dock.publish')}
        </button>
        <button
          type="button"
          className="po-btn po-primary po-split"
          aria-label={t('dock.publishMore')}
          title={t('dock.publishMore')}
          aria-expanded={panel?.kind === 'publish'}
          disabled={!ready.length || busy || !!conflict}
          onClick={() => setPanel(panel?.kind === 'publish' ? null : { kind: 'publish' })}
          data-testid="onpage-publish-more"
        >
          ▾
        </button>
      </div>
    </>
  )
}
