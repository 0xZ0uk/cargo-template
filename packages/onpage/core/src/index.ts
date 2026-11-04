/**
 * @cargo/onpage-core — framework-agnostic building blocks: document refs,
 * schema, path and field operations, the stega codec, autosave, the editor
 * session, and the port interfaces adapters implement. The default Payload REST
 * adapters are in `@cargo/onpage-core/payload`.
 *
 * The public API is listed explicitly: anything not exported here is internal
 * and may change in any release.
 */
export {
  isRefKey,
  parseRefKey,
  refKey,
  targetKey,
  type DocRef,
  type RefKey,
  type TargetKey,
} from './docref.ts'
export {
  getAt,
  insertItem,
  moveItem,
  newRowId,
  parsePath,
  pathnameOf,
  removeItem,
  rowPrefixes,
  safeLinkUrl,
  safePath,
  samePath,
  setAt,
  splitItemPath,
  updateArray,
  type PathSegment,
} from './path.ts'
export {
  isListField,
  type ArrayField,
  type BlocksField,
  type ChoiceField,
  type DateField,
  type DocumentSchema,
  type FieldOf,
  type GroupField,
  type ListField,
  type NumberField,
  type RelationField,
  type ScalarField,
  type ScalarFieldType,
  type SchemaBlock,
  type SchemaField,
  type SchemaFieldType,
  type SchemaImage,
  type SchemaLabels,
  type SchemaOption,
} from './schema.ts'
export {
  asList,
  blockFor,
  buildPatch,
  changedKeys,
  cloneRow,
  defaultsFor,
  fieldAtPath,
  isEditablePath,
  newArrayRow,
  changedPaths,
  newBlockRow,
  normalizeRichText,
  normalizeValue,
  previewRow,
  relationId,
  relationTitle,
  resolveRow,
  rowFieldsOf,
  toText,
  type FieldAtPath,
  type RowInfo,
} from './fields.ts'
export { AutosaveQueue, type AutosaveOptions, type SaveState, type SaveStatus } from './autosave.ts'
export {
  encodeMarker,
  hasStegaMarker,
  stegaClean,
  stegaCleanDeep,
  stegaDecode,
  stegaEncode,
  type Marker,
  type MarkerKind,
} from './stega.ts'
export { encodeDocument, isMachineFieldName, type EncodeFilter } from './encode.ts'
export {
  eachLexicalNode,
  isLexicalState,
  mapLexical,
  type LexicalNode,
  type LexicalState,
} from './lexical.ts'
export {
  isOnPageMode,
  isTargetKind,
  type AssistPort,
  type DataSource,
  type FieldError,
  type Doc,
  type Locator,
  type MediaItem,
  type MediaLibrary,
  type OnPageMode,
  type PreviewLink,
  type Renderer,
  type NewPage,
  type PageComment,
  type SavedSection,
  type ScheduledPublish,
  type VersionSummary,
  type SaveResult,
  type SearchHit,
  type SessionAdapter,
  type Target,
  type TargetKind,
} from './ports.ts'
export {
  EditorSession,
  isReady,
  type DocumentState,
  type EditorSessionOptions,
  type PublishResult,
  type ReadyDocumentState,
  type SessionSnapshot,
} from './session.ts'
export {
  createModeCookie,
  isLivePreviewGrant,
  modeSealer,
  readModeCookie,
  seal,
  SEAL_PURPOSE,
  sha256,
  unseal,
  type ModeCookie,
  type PreviewGrant,
  type SealMode,
  type SealSecret,
} from './seal.ts'
export { CONTEXT_KEY, COOKIE, DEFAULTS, HEADER, ROUTES } from './constants.ts'
export { assertNever, errorText } from './util.ts'
