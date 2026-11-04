'use client'

/**
 * The parts every popover editor shares: the anchored dialog, the Apply/Clear
 * bar, and a draft that previews live and commits once. Exported from
 * `@cargo/onpage-react/editor-kit` for custom editors.
 */
import { useState, type ReactNode } from 'react'
import type { Translate } from '../messages.ts'
import type { FieldEditorProps } from '../types.ts'
import { Dialog } from '../ui/Dialog.tsx'

/** The popover a field editor opens beside its element, titled with the field's label. */
export function EditorPopover({
  props,
  testId,
  width,
  children,
}: {
  props: Pick<FieldEditorProps, 'element' | 'field' | 'close' | 't'>
  testId: string
  width?: number
  children: ReactNode
}) {
  return (
    <Dialog
      variant="popover"
      anchor={props.element}
      title={props.field.label}
      onClose={props.close}
      t={props.t}
      testId={testId}
      {...(width ? { width } : {})}
    >
      {children}
    </Dialog>
  )
}

/** Apply, plus Clear when the field may be empty. */
export function ApplyBar({
  onApply,
  onClear,
  t,
}: {
  onApply: () => void
  onClear?: (() => void) | undefined
  t: Translate
}) {
  return (
    <div className="po-actions">
      <button
        type="button"
        className="po-btn po-primary"
        onClick={onApply}
        data-testid="onpage-apply"
      >
        {t('common.apply')}
      </button>
      {onClear && (
        <button type="button" className="po-btn" onClick={onClear} data-testid="onpage-clear">
          {t('common.clear')}
        </button>
      )}
    </div>
  )
}

/**
 * A text draft for a value: `parse` turns the draft into a value (undefined =
 * not valid yet). Valid drafts preview live when the page renders from editor
 * state; `save` commits only a changed, valid value, then closes.
 */
export function useDraft<V>(
  props: Pick<FieldEditorProps<never, V>, 'value' | 'commit' | 'preview' | 'close' | 'live'>,
  {
    format,
    parse,
  }: { format: (value: V) => string; parse: (draft: string) => V | null | undefined },
) {
  const [draft, setDraft] = useState(() => format(props.value))
  const change = (next: string) => {
    setDraft(next)
    const value = parse(next)
    if (props.live && value !== undefined && value !== null) props.preview(value)
  }
  const save = () => {
    const value = parse(draft)
    if (value !== undefined && value !== props.value) props.commit(value)
    props.close()
  }
  /** Enter applies. */
  const onKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter') save()
  }
  return { draft, change, save, onKeyDown, clear: () => change('') }
}
