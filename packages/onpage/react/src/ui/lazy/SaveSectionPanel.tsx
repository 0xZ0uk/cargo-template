'use client'

/** Name a section and save its content, to insert it again from the block picker. */
import { errorText, getAt } from '@shipment/onpage-core'
import { useId, useState } from 'react'
import { useOnPage } from '../../context.tsx'
import { Dialog } from '../Dialog.tsx'

export function SaveSectionPanel() {
  const { panel, session, snap, setPanel, notify, t } = useOnPage()
  const [name, setName] = useState(panel?.kind === 'saveSection' ? panel.title : '')
  const [busy, setBusy] = useState(false)
  const id = useId()
  if (panel?.kind !== 'saveSection') return null
  const row = getAt(snap.docs[panel.key]?.doc, panel.path)
  const save = async () => {
    if (!row || typeof row !== 'object' || !session.dataSource.savePattern) return
    setBusy(true)
    try {
      await session.dataSource.savePattern(name.trim(), row as Record<string, unknown>)
      notify(t('notify.sectionSaved'))
      setPanel(null)
    } catch (e) {
      notify(errorText(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      variant="panel"
      title={t('saveSection.title')}
      onClose={() => setPanel(null)}
      t={t}
      testId="onpage-save-section"
    >
      <form
        className="po-row"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label htmlFor={id}>{t('saveSection.name')}</label>
        <input
          id={id}
          className="po-input"
          value={name}
          maxLength={120}
          data-autofocus
          onChange={(e) => setName(e.target.value)}
          data-testid="onpage-save-section-name"
        />
        <div className="po-actions">
          <button
            type="submit"
            className="po-btn po-primary"
            disabled={busy || !name.trim()}
            data-testid="onpage-save-section-save"
          >
            {t('saveSection.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
