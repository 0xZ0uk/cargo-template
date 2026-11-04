/** Public types of the editor UI. */
import type { ComponentType } from 'react'
import type {
  AssistPort,
  DocRef,
  EditorSession,
  MediaLibrary,
  Renderer,
  SchemaField,
  SchemaFieldType,
  SessionSnapshot,
  Target,
  TargetKind,
  RefKey,
} from '@cargo/onpage-core'
import type { Translate } from './messages.ts'

export interface EditingState {
  /** refKey of the document */
  key: RefKey
  path: string
  /** Editor id from the registry ("text", "richText", …). */
  editor: string
  point?: { x: number; y: number } | undefined
  /** The element that was clicked (several elements may show one field). */
  el?: Element | undefined
}

/** Which panel is open. */
export type Panel =
  | { kind: 'settings'; key: RefKey; path: string; title: string }
  | { kind: 'blocks'; key: RefKey; listPath: string; index: number }
  /** The documents' own fields that aren't on the page (SEO, dates, references…). */
  | { kind: 'page' }
  /** Choose what to publish, or schedule it. */
  | { kind: 'publish' }
  /** Saved versions: restore one, see what changed since published. */
  | { kind: 'versions' }
  /** Comments on the page, and review requests. */
  | { kind: 'comments' }
  /** Save a section (a blocks row) to insert again later. */
  | { kind: 'saveSection'; key: RefKey; path: string; title: string }
  | null

export interface Selection {
  key: RefKey
  path: string
}

/**
 * Props a field editor receives. `F` is the field kind it edits (e.g.
 * `NumberField`, with `min`/`max`) and `V` its value after `normalize`.
 */
export interface FieldEditorProps<F extends SchemaField = SchemaField, V = unknown> {
  docKey: RefKey
  path: string
  field: F
  /** The element showing the field (re-resolved after each refresh). */
  element: () => Element | null
  value: V
  /** Commit a value (one undo step, autosaved). */
  commit: (value: unknown) => void
  /** Live preview while editing (no history entry, not saved). */
  preview: (value: unknown) => void
  /** Close the editor (after commit, or to cancel: transient previews are reverted). */
  close: () => void
  /** Leave a stand-in showing the new content until the page re-renders (refresh mode). */
  ghost: (g: GhostInput) => void
  /** True when the page renders this document from editor state (instant); false = server refresh. */
  live: boolean
  point?: { x: number; y: number } | undefined
  /** UI strings. */
  t: Translate
}

/** What an editor leaves on the page until it re-renders. */
export interface GhostInput {
  html: string
  className?: string | undefined
  style?: Partial<CSSStyleDeclaration> | undefined
}

/**
 * A field editor (the FieldEditor port). `inline` editors replace the element
 * in place (text, rich text); `popover` editors open beside it or as a dialog
 * (select, date, relationship, image…). Register your own by id and refer to it
 * from a field with `admin: { custom: { onpage: { editor: 'my-id' } } }`, or by
 * field type ("json", "code"…) to replace or add a default. Build one with
 * `defineEditor()` so its props are typed by the field kinds it accepts.
 */
export interface FieldEditorDef {
  mode: 'inline' | 'popover'
  /** Field types it can edit. The registry never hands it any other kind. Default: any. */
  accepts?: readonly SchemaFieldType[]
  /** The raw stored value → the editor's value. Default: passed through. */
  normalize?: (raw: unknown, field: SchemaField) => unknown
  component: ComponentType<FieldEditorProps>
}

export type EditorRegistry = Record<string, FieldEditorDef>

/** Navigation targets. `exit` and `mode` are endpoints the editor POSTs to. */
export interface Links {
  exit: string
  admin?: (ref: DocRef) => string
  mode?: (mode: 'edit' | 'view') => string
}

export interface TargetIndex {
  all: Target[]
  /** Targets whose element is exactly `el`. */
  at: (el: Element) => Target[]
  find: (key: RefKey, path: string, kinds?: TargetKind[]) => Target | undefined
}

/** A short message shown in the dock. */
export interface Flash {
  text: string
  bad?: boolean | undefined
}

/**
 * The editor's stable API: the session, configuration and actions. It changes
 * only when the editor is reconfigured, so components that only act (toolbars,
 * custom UI, client-mode documents) don't re-render on every keystroke.
 */
/**
 * What happened in the editor, for logging and error reporting (`onEvent`).
 * Messages are the server's or the network's, untranslated.
 */
export type OnPageEvent =
  | { type: 'saved'; ref: DocRef }
  | { type: 'saveFailed'; ref: DocRef; message: string }
  | { type: 'conflict'; ref: DocRef }
  | { type: 'loadFailed'; ref: DocRef; message: string }
  | { type: 'published'; refs: DocRef[] }
  | { type: 'publishFailed'; message: string }
  | { type: 'scheduled'; refs: DocRef[]; at: string }
  | { type: 'error'; where: 'render' | 'publish' | 'schedule' | 'share' | 'media'; error: unknown }

export interface OnPageApi {
  session: EditorSession
  renderer: Renderer
  media?: MediaLibrary | undefined
  editors: EditorRegistry
  links: Links
  t: Translate
  setPanel: (p: Panel) => void
  setEditing: (e: EditingState | null) => void
  setSelected: (s: Selection | null) => void
  /** Is this document rendered from session state (client mode)? */
  isLive: (key: RefKey) => boolean
  /** Client-mode documents register here (they don't need a server refresh). */
  registerClientDoc: (key: RefKey) => () => void
  /** Open the right editor for a field (registry resolution); false if none applies. */
  edit: (
    key: RefKey,
    path: string,
    opts?: {
      point?: { x: number; y: number } | undefined
      kind?: TargetKind | undefined
      anchor?: Element | undefined
    },
  ) => boolean
  /** Re-render documents after an operation outside autosave (publish, reload). */
  rerender: (refs: DocRef[]) => Promise<void>
  /** Show a short message in the dock: translated text (`notify(t('notify.published'))`), or an error's text. */
  notify: (text: string, bad?: boolean) => void
  /** Tell the site's `onEvent` handler what happened. */
  report: (event: OnPageEvent) => void
  /** The site's writing assistant, if it has one (`assist`). */
  assist?: AssistPort | undefined
  addGhost: (g: GhostInput & { key: RefKey; path: string }) => void
}

/** What changes as people edit: the documents, what's on the page and what's open. */
export interface OnPageState {
  snap: SessionSnapshot
  targets: TargetIndex
  panel: Panel
  editing: EditingState | null
  selected: Selection | null
  /** Documents shown on the current page (the session may hold others from earlier pages). */
  docKeys: RefKey[]
  /** Someone else holds Payload's lock on these documents: their names. */
  lockedBy: Readonly<Record<RefKey, string>>
  /** The page is re-rendering after a save (refresh mode). */
  rendering: boolean
  /** The dock's current message. */
  flash: Flash | null
}

/** Everything inside the editor (`useOnPage()`): its API and its state. */
export type OnPageContextValue = OnPageApi & OnPageState

export type PanelKind = NonNullable<Panel>['kind']
