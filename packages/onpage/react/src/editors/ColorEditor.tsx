'use client'

import type { ScalarField } from '@shipment/onpage-core'
import type { FieldEditorProps } from '../types.ts'
import { ApplyBar, EditorPopover, useDraft } from './kit.tsx'

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export const toColor = (raw: unknown): string | null =>
  typeof raw === 'string' && raw ? raw : null

/** Hex color with a native picker. Use it from a text field: `admin.custom.onpage.editor: 'color'`. */
export function ColorEditor(props: FieldEditorProps<ScalarField, string | null>) {
  const { field, t } = props
  const { draft, change, save, onKeyDown } = useDraft(props, {
    format: (v) => v ?? '',
    parse: (d) => (d === '' ? null : HEX.test(d) ? d : undefined),
  })
  return (
    <EditorPopover props={props} testId="onpage-color" width={260}>
      <div className="po-row po-inline-row">
        <input
          type="color"
          aria-label={field.label}
          value={HEX.test(draft) && draft.length === 7 ? draft : '#000000'}
          onChange={(e) => change(e.target.value)}
          data-testid="onpage-color-picker"
        />
        <input
          className="po-input"
          aria-label={field.label}
          data-autofocus
          value={draft}
          placeholder="#1e40af"
          aria-invalid={draft !== '' && !HEX.test(draft)}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          data-testid="onpage-color-input"
        />
      </div>
      <ApplyBar onApply={save} t={t} />
    </EditorPopover>
  )
}
