/**
 * Ports: the seams where payload-onpage meets the outside world. Each has a
 * default adapter (in this or a sibling package); anything implementing the
 * interface can replace it.
 *
 *   DataSource    how documents and schemas are read and written   payloadRest()
 *   MediaLibrary  how images are found and uploaded                 payloadUploads()
 *   Locator       how page elements map to fields (DOM)             annotations(), stega()
 *   Renderer      how the page shows a committed change             nextRefresh(), clientState()
 *   SessionAdapter how a request enters/leaves edit or preview mode tanstackSession() (server)
 * Field editors are registered in @shipment/onpage-react.
 */
import type { DocRef } from './docref.ts'
import { MARKER_KINDS } from './stega.ts'
import type { DocumentSchema } from './schema.ts'
import type { SealMode } from './seal.ts'

export type Doc = Record<string, unknown>

/** The outcome of a save: success carries the new version, failure its status. */
export type SaveResult =
  | {
      ok: true
      /** The document's new `updatedAt`. */
      updatedAt?: string | undefined
    }
  | {
      ok: false
      /** HTTP-like status: 409 means someone else saved first, 0 a network failure. */
      status: number
      message?: string | undefined
      /** The fields a validation error names, when the server says (Payload's ValidationError). */
      fields?: FieldError[] | undefined
    }

/** One invalid field: its data path (`layout.2.heading`) and the server's message. */
export interface FieldError {
  path: string
  message: string
}

/** Options callers often fill from other optional values, so `undefined` is accepted. */
type Opt<T> = T | undefined

export interface DataSource {
  loadSchema(ref: DocRef, opts: { locale?: Opt<string> }): Promise<DocumentSchema>
  loadDocument(
    ref: DocRef,
    opts: { draft: boolean; locale?: Opt<string>; depth?: Opt<number> },
  ): Promise<Doc>
  /** Save fields to the rolling draft. `updatedAt` enables stale-write detection. */
  saveDraft(
    ref: DocRef,
    data: Doc,
    opts: { locale?: Opt<string>; updatedAt?: Opt<string> },
  ): Promise<SaveResult>
  /** Make the given values live. */
  publish(
    ref: DocRef,
    data: Doc,
    opts: { locale?: Opt<string>; updatedAt?: Opt<string> },
  ): Promise<SaveResult>
  /** Find documents to link to (relationship fields), by their title field. Optional. */
  search?(
    collection: string,
    opts: {
      query?: Opt<string>
      titleField?: Opt<string>
      locale?: Opt<string>
      limit?: Opt<number>
      /** Aborted when the search is superseded (the user kept typing). */
      signal?: Opt<AbortSignal>
    },
  ): Promise<SearchHit[]>
  /** Create a read-only preview link for a document. Optional. */
  createPreviewLink?(ref: DocRef, opts: { locale?: Opt<string> }): Promise<PreviewLink>
  /**
   * Publish (or unpublish) a document at a later time: its latest saved draft
   * then. Optional; offered for documents whose schema has `schedulePublish`.
   */
  schedulePublish?(
    ref: DocRef,
    opts: { at: Date; type?: Opt<'publish' | 'unpublish'>; locale?: Opt<string> },
  ): Promise<ScheduledPublish>
  /**
   * Data paths whose field condition (`admin.condition`) is false for `doc`, the
   * document as the editor has it now. Optional; asked when the schema has `conditions`.
   */
  hiddenFields?(ref: DocRef, doc: Doc): Promise<string[]>
  /**
   * Take (or refresh) Payload's document lock for this editor, or release it.
   * `lockedBy` names someone else who holds a live lock (then nothing is
   * taken, and their lock blocks saves). Optional.
   */
  lock?(ref: DocRef, action: 'take' | 'release'): Promise<{ lockedBy: string | null }>
  /** A document's saved versions, newest first (Payload versions). Optional. */
  listVersions?(ref: DocRef, opts: { limit?: Opt<number> }): Promise<VersionSummary[]>
  /** Make a version the current draft again (it isn't published). Optional. */
  restoreVersion?(ref: DocRef, versionId: string | number): Promise<void>
  /** Comments on a document, newest first (the plugin's `comments` option). Optional. */
  listComments?(ref: DocRef): Promise<PageComment[]>
  /** Comment on a document, or on one of its fields (`path`). Optional. */
  addComment?(ref: DocRef, comment: { body: string; path?: Opt<string> }): Promise<void>
  /** Mark a comment resolved, or open it again. Optional. */
  resolveComment?(id: PageComment['id'], resolved: boolean): Promise<void>
  /** Ask reviewers to look at a page: the site is notified with a share link. Optional. */
  requestReview?(
    ref: DocRef,
    opts: { note?: Opt<string>; locale?: Opt<string> },
  ): Promise<{ url: string; expiresAt: string }>
  /** A new draft page: a copy of `ref`, titled `title` (default: "… (copy)"). Optional. */
  duplicatePage?(ref: DocRef, opts: { title?: Opt<string> }): Promise<NewPage>
  /** A new, blank draft page in `collection`. Optional. */
  createPage?(collection: string, opts: { title: string }): Promise<NewPage>
  /** Saved sections the given block types accept (the plugin's `patterns` option). Optional. */
  listPatterns?(opts: { blocks?: Opt<string[]> }): Promise<SavedSection[]>
  /** Save a section's content (a block row) under a name. Optional. */
  savePattern?(name: string, block: Doc): Promise<void>
}

/** A page made from the page: its id, and where it lives (null: no page to open). */
export interface NewPage {
  id: string | number
  path: string | null
}

/** A section saved to insert again: a block row under a name. */
export interface SavedSection {
  id: string | number
  name: string
  blockType: string
  data: Doc
}

/** A comment on a page, from an editor or a share-link viewer. */
export interface PageComment {
  id: string | number
  body: string
  /** The field it's about. */
  path?: string | undefined
  /** Text the commenter selected. */
  quote?: string | undefined
  kind: 'comment' | 'review'
  resolved: boolean
  /** ISO. */
  createdAt: string
  author?: string | undefined
  /** From a share-link viewer. */
  guest: boolean
}

/** One saved version of a document. */
export interface VersionSummary {
  id: string | number
  /** When it was saved (ISO). */
  updatedAt: string
  status?: 'draft' | 'published' | undefined
  /** Saved by autosave (rather than a publish or an explicit save). */
  autosave?: boolean | undefined
}

export interface ScheduledPublish {
  id: string | number
  /** When it runs (ISO). */
  waitUntil: string
  type: 'publish' | 'unpublish'
}

export interface PreviewLink {
  url: string
  expiresAt: string
  id?: string
}

export interface SearchHit {
  id: string | number
  title: string
  /** The document, so a client-rendered page can show it before saving. */
  doc: Doc
}

export interface MediaItem {
  id: string | number
  url?: string | null
  thumbnailUrl?: string | null
  alt?: string | null
  filename?: string | null
  /** The full document, stored in draft state so the page can render it. */
  doc: Doc
}

export interface MediaLibrary {
  search(opts: {
    query?: Opt<string>
    page?: Opt<number>
    relationTo: string
    /** Aborted when the search is superseded. */
    signal?: Opt<AbortSignal>
  }): Promise<{ items: MediaItem[]; hasMore: boolean }>
  upload?(file: File, opts: { relationTo: string; alt?: Opt<string> }): Promise<MediaItem>
  /** Change an image's alt text (on the media document, so every page using it gets it). */
  updateAlt?(id: MediaItem['id'], opts: { relationTo: string; alt: string }): Promise<MediaItem>
}

/**
 * What a page element shows: a field (`text`/`textarea`/`richtext`/`media` are
 * the kinds auto-mapping markers carry; `field` = resolve from the schema), a
 * row of an array/blocks field (`item`), or the element holding a list (`list`).
 */
/** What a page element shows: a marker's kind, or an annotation's field / row item / list. */
export const TARGET_KINDS = [...MARKER_KINDS, 'field', 'item', 'list'] as const
export type TargetKind = (typeof TARGET_KINDS)[number]
export const isTargetKind = (value: unknown): value is TargetKind =>
  (TARGET_KINDS as readonly unknown[]).includes(value)

export interface Target {
  el: Element
  ref: DocRef
  path: string
  kind: TargetKind
  label?: Opt<string>
  /** Which locator produced it ("annotation" wins over inferred ones). */
  /** Which locator found it. */
  source: 'annotation' | 'stega' | (string & {})
}

export interface Locator {
  name: string
  /** Find every target under `root`. Called on mount and after DOM changes. */
  scan(root: ParentNode): Target[]
}

export interface Renderer {
  name: string
  /**
   * Called after edits have been saved. `refresh` mode re-renders the page
   * from the server; `client` mode renders from session state and needs no work.
   */
  afterSave(info: { refs: DocRef[] }): void | Promise<void>
  /** Whether the page re-renders from session state immediately (no save round-trip needed to see edits). */
  live: boolean
}

export const ONPAGE_MODES = ['edit', 'view'] as const
export type OnPageMode = (typeof ONPAGE_MODES)[number]
export const isOnPageMode = (value: unknown): value is OnPageMode =>
  (ONPAGE_MODES as readonly unknown[]).includes(value)

/**
 * Server side: turns a browser's edit/preview access on and off. Framework
 * specific (`tanstackSession()` for TanStack Start).
 */
export interface SessionAdapter {
  /**
   * Signed-in editors: site-wide draft mode in edit or view mode. `bindTo` names
   * the auth cookie the mode is bound to, so signing out (or in as someone else)
   * ends it. Store the mode cookie from `createModeCookie(mode, { sealMode, … })`:
   * `sealMode` seals it with the plugin's secret, so it can't be forged.
   */
  enable(
    mode: OnPageMode,
    opts: { secure: boolean; bindTo?: string; sealMode: SealMode },
  ): Promise<void>
  /**
   * Preview links: read-only draft access to one page until `expiresAt`. The
   * adapter passes the framework's draft secret to `seal` and stores the sealed
   * result. Where a CDN decides cache bypass from the browser's own cookies
   * (Vercel), an adapter may also give the browser the draft credential scoped
   * to `path` and `expiresAt`; its proxy must then refuse it everywhere else.
   */
  enableLink(opts: {
    secure: boolean
    path: string
    expiresAt: Date
    seal: (draftSecret: string) => Promise<string>
  }): Promise<void>
  /** Leave edit/preview mode. `path` is the page being left, for credentials scoped to it. */
  disable(opts?: { path?: string }): Promise<void>
  getMode(): Promise<OnPageMode | null>
}

/**
 * A writing assistant (the AssistPort): rewrite a field's text as asked.
 * payload-onpage bundles no AI vendor; implement it with your own server
 * route, which calls the model and checks that the caller is signed in.
 */
export interface AssistPort {
  /** The new text for `text`, following `instruction` ("Make it shorter"). */
  rewrite(input: {
    text: string
    instruction: string
    /** The field being edited. */
    field: { name: string; label: string; type: string }
    /** The content locale being edited, if any. */
    locale?: Opt<string>
    ref: DocRef
    path: string
    /** Aborted when the editor gives up on this answer. */
    signal?: Opt<AbortSignal>
  }): Promise<string>
}
