/**
 * @cargo/onpage-react/editor-kit — building blocks for custom field editors
 * (the default editors and @cargo/onpage-lexical use exactly these).
 *
 *   const json = defineEditor({
 *     mode: 'popover',
 *     accepts: ['json'],
 *     component: (props) => <EditorPopover props={props} testId="my-json">…</EditorPopover>,
 *   })
 */
export { Dialog, type DialogProps } from './ui/Dialog.tsx'
export { useOnPage, useOnPageOptional } from './context.tsx'
export { useDebouncedSearch } from './editors/useDebouncedSearch.ts'
export { ApplyBar, EditorPopover, useDraft } from './editors/kit.tsx'
export { canEdit, defineEditor } from './registry.ts'
export {
  HIDDEN,
  UI,
  caretAt,
  copyTypography,
  placeCaret,
  placeOver,
  typographyOf,
  popoverPosition,
} from './dom.ts'
export { useTrackElement, useLayoutTick, notifyLayout } from './layout.ts'
export { useEvent } from './useEvent.ts'
export { RedoIcon, UndoIcon } from './icons.tsx'
export { escapeHtml, sanitizeHtml } from './sanitize.ts'
export type { EditorRegistry, FieldEditorDef, FieldEditorProps, GhostInput } from './types.ts'
export type { FieldOf } from '@cargo/onpage-core'
export type { Translate } from './messages.ts'
