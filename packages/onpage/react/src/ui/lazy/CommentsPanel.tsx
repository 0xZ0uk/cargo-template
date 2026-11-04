'use client'

/**
 * Comments on the page's documents (the plugin's `comments` option): read,
 * add (about the page, or the selected section), resolve; and ask for a
 * review, which notifies the site's reviewers with a share link.
 */
import { errorText, fieldAtPath, isReady, type PageComment, type RefKey } from '@cargo/onpage-core'
import { useEffect, useId, useState } from 'react'
import { useOnPage } from '../../context.tsx'
import { relativeTime } from '../../messages.ts'
import { Dialog } from '../Dialog.tsx'
import { docTitle } from '../titles.ts'

export function CommentsPanel() {
  const { session, snap, docKeys, selected, setPanel, setSelected, notify, t } = useOnPage()
  const docs = docKeys
    .map((k) => snap.docs[k])
    .filter(isReady)
    .filter((d) => d.schema.comments)
  const [key, setKey] = useState<RefKey | undefined>(selected?.key ?? docs[0]?.key)
  const state = docs.find((d) => d.key === key) ?? docs[0]
  const ds = session.dataSource
  const [comments, setComments] = useState<PageComment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [aboutSelected, setAboutSelected] = useState(!!selected)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  const id = useId()
  const ref = state?.ref

  useEffect(() => {
    if (!ref || !ds.listComments) return
    let live = true
    ds.listComments(ref).then(
      (c) => live && setComments(c),
      (e: unknown) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [ds, ref, version])

  if (!state) return null
  const selectedHere = selected && selected.key === state.key ? selected : null
  const fieldLabel = (path: string | undefined) =>
    path ? (fieldAtPath(state.schema.fields, state.doc, path)?.field.label ?? path) : undefined

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await task()
      notify(done)
      setVersion((v) => v + 1)
    } catch (e) {
      notify(errorText(e), true)
    } finally {
      setBusy(false)
    }
  }
  const add = () =>
    ds.addComment &&
    void run(async () => {
      await ds.addComment?.(state.ref, {
        body: draft,
        path: aboutSelected && selectedHere ? selectedHere.path : undefined,
      })
      setDraft('')
    }, t('notify.commented'))
  const requestReview = () =>
    ds.requestReview &&
    void run(async () => {
      await session.flush()
      await ds.requestReview?.(state.ref, { note, locale: session.locale })
      setNote('')
    }, t('notify.reviewRequested'))
  const resolve = (c: PageComment) =>
    void run(
      () => ds.resolveComment?.(c.id, !c.resolved) ?? Promise.resolve(),
      t(c.resolved ? 'notify.reopened' : 'notify.resolved'),
    )

  const open = comments?.filter((c) => !c.resolved) ?? []
  const done = comments?.filter((c) => c.resolved) ?? []

  return (
    <Dialog
      variant="panel"
      title={t('comments.title')}
      onClose={() => setPanel(null)}
      t={t}
      testId="onpage-comments"
    >
      {docs.length > 1 && (
        <div className="po-row">
          <label htmlFor={`${id}-doc`}>{t('versions.document')}</label>
          <select
            id={`${id}-doc`}
            className="po-select"
            value={state.key}
            onChange={(e) => {
              setKey(e.target.value as RefKey)
              setComments(null)
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
      {ds.addComment && (
        <form
          className="po-row"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <label htmlFor={`${id}-new`}>{t('comments.new')}</label>
          <textarea
            id={`${id}-new`}
            className="po-input po-textarea"
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="onpage-comment-text"
          />
          {selectedHere && (
            <label className="po-check">
              <input
                type="checkbox"
                checked={aboutSelected}
                onChange={(e) => setAboutSelected(e.target.checked)}
              />
              <span>
                {t('comments.aboutSelected', { label: fieldLabel(selectedHere.path) ?? '' })}
              </span>
            </label>
          )}
          <div className="po-actions">
            <button
              type="submit"
              className="po-btn po-primary"
              disabled={busy || !draft.trim()}
              data-testid="onpage-comment-add"
            >
              {t('comments.add')}
            </button>
          </div>
        </form>
      )}
      {error && <p className="po-error">{error}</p>}
      {comments && !comments.length && <p className="po-muted">{t('comments.empty')}</p>}
      <ol className="po-comments">
        {[...open, ...done].map((c) => (
          <li
            key={String(c.id)}
            className={c.resolved ? 'is-resolved' : undefined}
            data-testid="onpage-comment"
          >
            <div className="po-comment-head">
              <strong>{c.author ?? t('comments.someone')}</strong>
              <small>
                {c.guest && ` · ${t('comments.guest')}`}
                {c.kind === 'review' && ` · ${t('comments.review')}`}
                {' · '}
                {relativeTime(new Date(c.createdAt).getTime(), undefined, t.locale)}
              </small>
            </div>
            {c.path && (
              <button
                type="button"
                className="po-link"
                onClick={() => setSelected({ key: state.key, path: c.path ?? '' })}
              >
                {fieldLabel(c.path)}
              </button>
            )}
            {c.quote && <blockquote>{c.quote}</blockquote>}
            <p>{c.body}</p>
            {ds.resolveComment && (
              <button
                type="button"
                className="po-btn"
                disabled={busy}
                onClick={() => resolve(c)}
                data-testid="onpage-comment-resolve"
              >
                {t(c.resolved ? 'comments.reopen' : 'comments.resolve')}
              </button>
            )}
          </li>
        ))}
      </ol>
      {ds.requestReview && (
        <form
          className="po-row po-review"
          onSubmit={(e) => {
            e.preventDefault()
            requestReview()
          }}
        >
          <label htmlFor={`${id}-review`}>{t('comments.reviewTitle')}</label>
          <textarea
            id={`${id}-review`}
            className="po-input po-textarea"
            value={note}
            maxLength={2000}
            placeholder={t('comments.reviewPlaceholder')}
            onChange={(e) => setNote(e.target.value)}
            data-testid="onpage-review-note"
          />
          <small>{t('comments.reviewHint')}</small>
          <div className="po-actions">
            <button
              type="submit"
              className="po-btn"
              disabled={busy}
              data-testid="onpage-review-request"
            >
              {t('comments.reviewButton')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
