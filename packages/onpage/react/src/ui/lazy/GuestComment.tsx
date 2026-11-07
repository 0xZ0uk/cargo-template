'use client'

/**
 * A share-link viewer's comment on the page they were sent: their name, the
 * comment, and any text they had selected. Sent to the plugin, which takes the
 * page from the viewer's sealed link (they can't name another).
 */
import { errorText } from '@shipment/onpage-core'
import { useId, useState } from 'react'
import type { Translate } from '../../messages.ts'
import { Dialog } from '../Dialog.tsx'

const NAME_KEY = 'onpage-guest-name'
const remembered = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
const remember = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // private window or blocked storage: ask again next time
  }
}

export function GuestComment({
  action,
  quote,
  onClose,
  t,
}: {
  /** The plugin's comments endpoint. */
  action: string
  /** Text the viewer had selected on the page. */
  quote: string
  onClose: (sent: boolean) => void
  t: Translate
}) {
  const [name, setName] = useState(remembered)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, body, ...(quote ? { quote } : {}) }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          errors?: Array<{ message?: string }>
        } | null
        throw new Error(json?.errors?.[0]?.message ?? res.statusText)
      }
      remember(name)
      onClose(true)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('guest.title')}
      onClose={() => onClose(false)}
      t={t}
      testId="onpage-guest-comment"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        {quote && <blockquote className="po-quote">{quote}</blockquote>}
        <div className="po-row">
          <label htmlFor={`${id}-name`}>{t('guest.name')}</label>
          <input
            id={`${id}-name`}
            className="po-input"
            value={name}
            maxLength={80}
            required
            autoComplete="name"
            data-autofocus={name ? undefined : true}
            onChange={(e) => setName(e.target.value)}
            data-testid="onpage-guest-name"
          />
        </div>
        <div className="po-row">
          <label htmlFor={`${id}-body`}>{t('guest.comment')}</label>
          <textarea
            id={`${id}-body`}
            className="po-input po-textarea"
            value={body}
            maxLength={2000}
            required
            data-autofocus={name ? true : undefined}
            onChange={(e) => setBody(e.target.value)}
            data-testid="onpage-guest-body"
          />
        </div>
        {error && <p className="po-error">{error}</p>}
        <div className="po-actions">
          <button
            type="submit"
            className="po-btn po-primary"
            disabled={busy || !name.trim() || !body.trim()}
            data-testid="onpage-guest-send"
          >
            {t('guest.send')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export default GuestComment
