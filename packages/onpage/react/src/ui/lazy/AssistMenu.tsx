'use client'

/**
 * The writing assistant's menu beside an inline text editor: ready-made asks
 * (shorter, clearer…) or the editor's own. The answer replaces the text in the
 * editor, still uncommitted: Enter keeps it, Escape drops it, ⌘Z after keeping.
 */
import { errorText, type AssistPort, type DocRef } from '@cargo/onpage-core'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Translate } from '../../messages.ts'

/** Ready-made asks: the label shown, and the instruction the assistant gets. */
const PRESETS: Array<{
  label: 'assist.shorter' | 'assist.clearer' | 'assist.friendlier' | 'assist.fix'
  instruction: string
}> = [
  { label: 'assist.shorter', instruction: 'Make it shorter. Keep the meaning.' },
  { label: 'assist.clearer', instruction: 'Make it clearer and easier to read.' },
  { label: 'assist.friendlier', instruction: 'Make the tone friendlier.' },
  { label: 'assist.fix', instruction: 'Fix spelling and grammar. Change nothing else.' },
]

export function AssistMenu({
  assist,
  anchor,
  text,
  field,
  docRef,
  path,
  locale,
  onResult,
  t,
}: {
  assist: AssistPort
  /** The inline editor: the menu sits above it. */
  anchor: RefObject<HTMLElement | null>
  /** The text now. */
  text: () => string
  field: { name: string; label: string; type: string }
  docRef: DocRef
  path: string
  locale?: string | undefined
  /** Put the answer into the editor. */
  onResult: (text: string) => void
  t: Translate
}) {
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  const ask = async (instruction: string) => {
    pending.current?.abort()
    const aborter = new AbortController()
    pending.current = aborter
    setBusy(true)
    setError(null)
    try {
      const answer = await assist.rewrite({
        text: text(),
        instruction,
        field,
        locale,
        ref: docRef,
        path,
        signal: aborter.signal,
      })
      if (!aborter.signal.aborted) onResult(answer)
    } catch (e) {
      if (!aborter.signal.aborted) setError(errorText(e))
    } finally {
      if (!aborter.signal.aborted) setBusy(false)
    }
  }

  const r = anchor.current?.getBoundingClientRect()
  // Above the text, or below it near the top of the window.
  const style = r
    ? { left: Math.max(8, r.left), top: r.top > 120 ? r.top - 92 : r.bottom + 8 }
    : { left: 8, top: 8 }
  return (
    <div
      className="po-assist"
      role="group"
      aria-label={t('assist.label')}
      style={style}
      data-testid="onpage-assist-menu"
    >
      <div className="po-actions">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="po-btn"
            disabled={busy}
            // Keep the text editor focused: a blur there would commit it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void ask(p.instruction)}
            data-testid={`onpage-assist-${p.label.slice('assist.'.length)}`}
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      <form
        className="po-alt-line"
        onSubmit={(e) => {
          e.preventDefault()
          if (custom.trim()) void ask(custom.trim())
        }}
      >
        <input
          className="po-input"
          aria-label={t('assist.custom')}
          placeholder={t('assist.custom')}
          value={custom}
          maxLength={300}
          onChange={(e) => setCustom(e.target.value)}
          data-testid="onpage-assist-custom"
        />
        <button type="submit" className="po-btn" disabled={busy || !custom.trim()}>
          {t('assist.ask')}
        </button>
      </form>
      <small role="status" className={error ? 'po-error' : undefined}>
        {busy ? t('assist.working') : (error ?? t('assist.hint'))}
      </small>
    </div>
  )
}

export default AssistMenu
