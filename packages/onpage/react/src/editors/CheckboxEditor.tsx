'use client'

import type { ScalarField } from '@cargo/onpage-core'
import type { FieldEditorProps } from '../types.ts'
import { EditorPopover } from './kit.tsx'

/** A checkbox value (unset falls back to the field's default). */
export const checkedOf = (raw: unknown, field: { defaultValue?: unknown }): boolean =>
  Boolean(raw ?? field.defaultValue)

export function CheckboxEditor(props: FieldEditorProps<ScalarField, boolean>) {
  const { field, value, commit, close } = props
  return (
    <EditorPopover props={props} testId="onpage-checkbox">
      <label className="po-check">
        <input
          type="checkbox"
          data-autofocus
          checked={value}
          onChange={(e) => {
            commit(e.target.checked)
            close()
          }}
          data-testid="onpage-checkbox-input"
        />
        {field.label}
      </label>
    </EditorPopover>
  )
}
