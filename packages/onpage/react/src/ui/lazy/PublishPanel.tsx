'use client'

/**
 * Choose which of the page's documents to publish now, or schedule them.
 * Scheduling goes through `DataSource.schedulePublish` and publishes each
 * document's latest saved draft at that time.
 */
import { errorText, isReady, type RefKey } from '@cargo/onpage-core'
import { useId, useState } from 'react'
import { useOnPage } from '../../context.tsx'
import { Dialog } from '../Dialog.tsx'
import { docTitle } from '../titles.ts'

/** `datetime-local` wants local time without a zone: 2026-10-12T14:30. */
const localInputValue = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export function PublishPanel() {
  const { session, snap, docKeys, setPanel, notify, report, rerender, t } = useOnPage()
  const docs = docKeys.map((k) => snap.docs[k]).filter(isReady)
  const [chosen, setChosen] = useState<ReadonlySet<RefKey>>(
    () => new Set(docs.filter((d) => session.hasUnpublished(d.key)).map((d) => d.key)),
  )
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()
  const close = () => setPanel(null)

  const selected = docs.filter((d) => chosen.has(d.key))
  const schedulable = selected.filter((d) => d.schema.schedulePublish)
  const schedule = session.dataSource.schedulePublish?.bind(session.dataSource)

  const toggle = (key: RefKey, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const publishNow = async () => {
    setBusy(true)
    try {
      const res = await session.publish({ keys: selected.map((d) => d.key) })
      if (res.published.length) report({ type: 'published', refs: res.published })
      if (res.published.length) await rerender(res.published)
      if (res.ok) {
        notify(t(res.published.length ? 'notify.published' : 'notify.nothingToPublish'))
        close()
      } else {
        report({ type: 'publishFailed', message: res.message ?? '' })
        notify(t('notify.publishFailed', { message: res.message ?? '' }), true)
      }
    } catch (e) {
      report({ type: 'error', where: 'publish', error: e })
      notify(t('notify.publishFailed', { message: errorText(e) }), true)
    } finally {
      setBusy(false)
    }
  }

  const scheduleAt = async () => {
    if (!schedule || !at) return
    const when = new Date(at)
    setBusy(true)
    try {
      await session.flush() // schedule what's on screen: the latest draft must be saved
      for (const d of schedulable) await schedule(d.ref, { at: when, locale: session.locale })
      report({ type: 'scheduled', refs: schedulable.map((d) => d.ref), at: when.toISOString() })
      notify(
        t('notify.scheduled', {
          date: when.toLocaleString(t.locale, { dateStyle: 'medium', timeStyle: 'short' }),
        }),
      )
      close()
    } catch (e) {
      report({ type: 'error', where: 'schedule', error: e })
      notify(t('notify.scheduleFailed', { message: errorText(e) }), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      variant="panel"
      title={t('publish.title')}
      onClose={close}
      t={t}
      testId="onpage-publish-panel"
    >
      <fieldset className="po-group">
        <legend className="po-h4">{t('publish.which')}</legend>
        {docs.map((d) => {
          const pending = session.hasUnpublished(d.key)
          return (
            <label key={d.key} className="po-check">
              <input
                type="checkbox"
                checked={chosen.has(d.key)}
                disabled={!pending}
                onChange={(e) => toggle(d.key, e.target.checked)}
                data-testid={`onpage-publish-doc-${d.key}`}
              />
              <span>
                {docTitle(d)}
                {!pending && <small> · {t('publish.upToDate')}</small>}
              </span>
            </label>
          )
        })}
      </fieldset>
      <div className="po-actions">
        <button
          type="button"
          className="po-btn po-primary"
          disabled={busy || !selected.length || !!snap.busy}
          onClick={() => void publishNow()}
          data-testid="onpage-publish-selected"
        >
          {t('publish.now')}
        </button>
      </div>
      {schedule && docs.some((d) => d.schema.schedulePublish) && (
        <form
          className="po-row po-schedule"
          onSubmit={(e) => {
            e.preventDefault()
            void scheduleAt()
          }}
        >
          <label htmlFor={id}>{t('publish.schedule')}</label>
          <div className="po-alt-line">
            <input
              id={id}
              type="datetime-local"
              className="po-input"
              min={localInputValue(new Date())}
              value={at}
              onChange={(e) => setAt(e.target.value)}
              aria-describedby={`${id}-hint`}
              data-testid="onpage-schedule-at"
            />
            <button
              type="submit"
              className="po-btn"
              disabled={busy || !at || !schedulable.length}
              data-testid="onpage-schedule"
            >
              {t('publish.scheduleButton')}
            </button>
          </div>
          <small id={`${id}-hint`}>{t('publish.scheduleHint')}</small>
        </form>
      )}
    </Dialog>
  )
}
