'use client'

import { asList, type ChoiceField } from '@shipment/onpage-core'
import type { FieldEditorProps } from '../types.ts'
import { EditorPopover } from './kit.tsx'

/** A select/radio value as the selected option values. */
export const selectedValues = (raw: unknown, field: ChoiceField): string[] =>
  asList(raw, field.hasMany, (v) =>
    typeof v === 'string' || typeof v === 'number' ? String(v) : undefined,
  )

/** Select / radio: pick one (closes) or toggle several (hasMany). */
export function SelectEditor(props: FieldEditorProps<ChoiceField, string[]>) {
  const { field, value: current, commit, close, t } = props
  const many = !!field.hasMany
  const pick = (v: string | null) => {
    if (!many) {
      commit(v)
      close()
      return
    }
    const set = new Set(current)
    if (v === null) set.clear()
    else if (set.has(v)) set.delete(v)
    else set.add(v)
    commit(field.options.map((o) => o.value).filter((o) => set.has(o)))
  }
  return (
    <EditorPopover props={props} testId="onpage-select">
      <div
        className="po-pop-list"
        role="listbox"
        aria-multiselectable={many}
        aria-label={field.label}
      >
        {!field.required && !many && (
          <button
            type="button"
            role="option"
            aria-selected={!current.length}
            onClick={() => pick(null)}
          >
            {t('common.none')}
          </button>
        )}
        {field.options.map((o) => {
          const selected = current.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => pick(o.value)}
              data-testid={`onpage-option-${o.value}`}
            >
              {many ? (selected ? '☑ ' : '☐ ') : ''}
              {o.label}
            </button>
          )
        })}
      </div>
    </EditorPopover>
  )
}
