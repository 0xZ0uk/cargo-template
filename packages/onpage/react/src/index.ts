/**
 * @cargo/onpage-react — the on-page editor UI.
 *
 *   <OnPageEditor dataSource={payloadRest()} media={payloadUploads()} links={{ exit: '/api/onpage/exit' }} />
 *
 * Framework adapters (e.g. @cargo/onpage-tanstack-start) mount it for you. Building a
 * field editor? See `@cargo/onpage-react/editor-kit`.
 */
export { OnPageEditor, type OnPageEditorProps } from './editor/OnPageEditor.tsx'
export { OnPageClient, type OnPageClientProps } from './OnPageClient.tsx'
export {
  PreviewToolbar,
  inPreviewFrame,
  FRAME_PARAM,
  type PreviewToolbarProps,
} from './ui/PreviewToolbar.tsx'
export { useOnPage, useOnPageApi, useOnPageOptional, useSessionSnapshot } from './context.tsx'
export type {
  EditorRegistry,
  FieldEditorDef,
  FieldEditorProps,
  Links,
  OnPageApi,
  OnPageContextValue,
  OnPageEvent,
  OnPageState,
  PanelKind,
  TargetIndex,
} from './types.ts'
export {
  defaultEditors,
  CheckboxEditor,
  ColorEditor,
  DateEditor,
  InlineText,
  NumberEditor,
  RelationshipEditor,
  SelectEditor,
  UploadEditor,
} from './editors/index.ts'
export { resolveEditor, mergeEditors } from './registry.ts'
export { annotations, stega, composite } from './locators.ts'
export {
  editable,
  editableOff,
  p,
  ATTR,
  type Editable,
  type EditableTarget,
  type FieldKind,
} from './annotations.ts'
export { clientState, fullReload } from './renderers.ts'
export {
  defaultMessages,
  createTranslate,
  type Messages,
  type MessageKey,
  type Translate,
} from './messages.ts'
