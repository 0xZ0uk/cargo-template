'use client'

import type { NumberField } from '@shipment/onpage-core'
import type { FieldEditorProps } from '../types.ts'
import { ApplyBar, EditorPopover, useDraft } from './kit.tsx'

export const toNumber = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) ? raw : null

/** Number input, with a slider when the field has min and max. */
export function NumberEditor(props: FieldEditorProps<NumberField, number | null>) {
  const { field, t } = props
  const { draft, change, save, onKeyDown } = useDraft(props, {
    format: (v) => (v === null ? '' : String(v)),
    parse: (d) => (d === '' ? null : Number.isNaN(Number(d)) ? undefined : Number(d)),
  })
  const slider = field.min !== undefined && field.max !== undefined
  return (
    <EditorPopover props={props} testId="onpage-number">
      <div className="po-row">
        {slider && (
          <input
            type="range"
            aria-label={field.label}
            min={field.min}
            max={field.max}
            value={draft || field.min}
            onChange={(e) => change(e.target.value)}
            data-testid="onpage-number-slider"
          />
        )}
        <input
          className="po-input"
          type="number"
          aria-label={field.label}
          data-autofocus
          min={field.min}
          max={field.max}
          value={draft}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          data-testid="onpage-number-input"
        />
      </div>
      <ApplyBar onApply={save} t={t} />
    </EditorPopover>
  )
}
