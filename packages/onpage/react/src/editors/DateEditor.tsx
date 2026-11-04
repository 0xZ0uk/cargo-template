'use client'

import type { DateField } from '@cargo/onpage-core'
import type { FieldEditorProps } from '../types.ts'
import { ApplyBar, EditorPopover, useDraft } from './kit.tsx'

/** Payload stores dates as ISO strings; the input works in local time. */
const toLocalInput = (iso: string | null, withTime: boolean): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

export const toIsoDate = (raw: unknown): string | null =>
  typeof raw === 'string' && raw ? raw : null

export function DateEditor(props: FieldEditorProps<DateField, string | null>) {
  const { field, t } = props
  const withTime = field.pickerAppearance === 'dayAndTime' || field.pickerAppearance === 'timeOnly'
  const { draft, change, save, onKeyDown, clear } = useDraft(props, {
    format: (v) => toLocalInput(v, withTime),
    // Date-only values are stored at local noon, which survives any timezone shift (as Payload's picker does).
    parse: (d) => (d ? new Date(withTime ? d : `${d}T12:00:00`).toISOString() : null),
  })
  return (
    <EditorPopover props={props} testId="onpage-date">
      <div className="po-row">
        <input
          className="po-input"
          type={withTime ? 'datetime-local' : 'date'}
          aria-label={field.label}
          data-autofocus
          value={draft}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          data-testid="onpage-date-input"
        />
      </div>
      <ApplyBar onApply={save} onClear={field.required ? undefined : clear} t={t} />
    </EditorPopover>
  )
}
