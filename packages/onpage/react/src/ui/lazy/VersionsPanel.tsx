'use client'

/**
 * A document's saved versions: restore one as the current draft, and outline
 * what the draft changes since the published version.
 */
import {
  changedPaths,
  errorText,
  isReady,
  rowPrefixes,
  type RefKey,
  type VersionSummary,
} from '@cargo/onpage-core'
import { useEffect, useId, useState } from 'react'
import { useOnPage } from '../../context.tsx'
import { DOM_ATTR } from '../../dom.ts'
import { relativeTime } from '../../messages.ts'
import { Dialog } from '../Dialog.tsx'
import { docTitle } from '../titles.ts'

/** Outline the page elements of fields that differ from the published version. */
function useChangedSincePublished(key: RefKey | undefined, on: boolean): number | null {
  const { session, snap, targets } = useOnPage()
  const state = key ? snap.docs[key] : undefined
  const [count, setCount] = useState<number | null>(null)
  const ready = isReady(state) ? state : undefined
  useEffect(() => {
    if (!on || !ready) return
    let live = true
    const marked: Element[] = []
    void session.dataSource
      .loadDocument(ready.ref, { draft: false, locale: session.locale, depth: 2 })
      .then((published) => {
        if (!live) return
        const paths = changedPaths(published, ready.doc, ready.schema.fields)
        setCount(paths.length)
        for (const path of paths) {
          // The field's element, else its row's (a new section), else nothing on the page.
          const el = [path, ...rowPrefixes(path).reverse()]
            .map((p) => targets.find(ready.key, p)?.el)
            .find(Boolean)
          if (!el || marked.includes(el)) continue
          el.setAttribute(DOM_ATTR.changed, '')
          marked.push(el)
        }
      })
      .catch(() => live && setCount(null))
    return () => {
      live = false
      for (const el of marked) el.removeAttribute(DOM_ATTR.changed)
    }
  }, [on, ready, session, targets])
  return on ? count : null
}

export function VersionsPanel() {
  const { session, snap, docKeys, setPanel, notify, rerender, t } = useOnPage()
  const docs = docKeys.map((k) => snap.docs[k]).filter(isReady)
  const [key, setKey] = useState<RefKey | undefined>(docs[0]?.key)
  const state = docs.find((d) => d.key === key) ?? docs[0]
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<VersionSummary['id'] | null>(null)
  const [highlight, setHighlight] = useState(false)
  const changes = useChangedSincePublished(state?.key, highlight)
  const ds = session.dataSource
  const id = useId()
  const ref = state?.ref
  const seq = state?.save.seq

  useEffect(() => {
    if (!ref || !ds.listVersions) return
    let live = true
    ds.listVersions(ref, { limit: 20 }).then(
      (v) => live && setVersions(v),
      (e: unknown) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [ds, ref, seq])

  const restore = async (v: VersionSummary) => {
    if (!state) return
    if (confirm !== v.id) return setConfirm(v.id)
    setConfirm(null)
    try {
      await session.restoreVersion(state.key, v.id)
      await rerender([state.ref])
      notify(
        t('notify.restored', {
          date: new Date(v.updatedAt).toLocaleString(t.locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        }),
      )
    } catch (e) {
      notify(errorText(e), true)
    }
  }

  return (
    <Dialog
      variant="panel"
      title={t('versions.title')}
      onClose={() => setPanel(null)}
      t={t}
      testId="onpage-versions"
    >
      {docs.length > 1 && (
        <div className="po-row">
          <label htmlFor={`${id}-doc`}>{t('versions.document')}</label>
          <select
            id={`${id}-doc`}
            className="po-select"
            value={state?.key}
            onChange={(e) => {
              setKey(e.target.value as RefKey)
              setVersions(null)
            }}
          >
            {docs.map((d) => (
              <option key={d.key} value={d.key}>
                {docTitle(d)}
              </option>
            ))}
          </select>
        </div>
      )}
      <label className="po-check">
        <input
          type="checkbox"
          checked={highlight}
          onChange={(e) => setHighlight(e.target.checked)}
          data-testid="onpage-versions-highlight"
        />
        <span>
          {t('versions.highlight')}
          {changes !== null && <small> · {t('versions.changes', { count: changes })}</small>}
        </span>
      </label>
      {error && <p className="po-error">{error}</p>}
      {versions && !versions.length && <p className="po-muted">{t('versions.empty')}</p>}
      <ol className="po-versions">
        {versions?.map((v, i) => (
          <li key={String(v.id)} data-testid={`onpage-version-${i}`}>
            <span>
              {relativeTime(new Date(v.updatedAt).getTime(), undefined, t.locale)}
              <small>
                {' · '}
                {t(v.status === 'published' ? 'versions.published' : 'versions.draft')}
                {i === 0 && ` · ${t('versions.current')}`}
              </small>
            </span>
            {i > 0 && (
              <button
                type="button"
                className={`po-btn${confirm === v.id ? ' is-danger' : ''}`}
                disabled={snap.busy}
                onClick={() => void restore(v)}
                onBlur={() => setConfirm(null)}
                data-testid={`onpage-version-restore-${i}`}
              >
                {t(confirm === v.id ? 'versions.restoreConfirm' : 'versions.restore')}
              </button>
            )}
          </li>
        ))}
      </ol>
    </Dialog>
  )
}
