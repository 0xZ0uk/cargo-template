/**
 * EditorSession — the editing state for every document on the page.
 *
 * Framework-agnostic and observable (subscribe/getSnapshot, so React can use
 * useSyncExternalStore). One DocumentState per DocRef: its schema, its draft
 * (populated, for rendering), its autosave queue and its last `updatedAt`.
 * Undo/redo is session-wide, so ⌘Z undoes the last edit whichever document it
 * touched. Publish, discard and reload run one at a time.
 */
import { AutosaveQueue, type SaveState } from './autosave.ts'
import { refKey, type DocRef, type RefKey } from './docref.ts'
import { buildPatch, changedKeys } from './fields.ts'
import { setAt } from './path.ts'
import type { DataSource, Doc, FieldError } from './ports.ts'
import type { DocumentSchema } from './schema.ts'
import { stegaCleanDeep } from './stega.ts'
import { errorText } from './util.ts'

export interface DocumentState {
  key: RefKey
  ref: DocRef
  status: 'loading' | 'ready' | 'error'
  /** Why loading failed (status "error"). */
  error?: string | undefined
  schema: DocumentSchema | null
  doc: Doc | null
  save: SaveState
  /** Edited in this session since load or the last publish/discard. */
  edited: boolean
  /** Fields the server called invalid in the last failed save or publish. */
  invalid?: FieldError[] | undefined
}

/** A document that can be edited: loaded, with its schema and data. */
export type ReadyDocumentState = DocumentState & {
  status: 'ready'
  schema: DocumentSchema
  doc: Doc
}

/** Narrows a document's state to one that can be edited (instead of checking `schema && doc` by hand). */
export const isReady = (state: DocumentState | undefined): state is ReadyDocumentState =>
  state?.status === 'ready' && !!state.schema && !!state.doc

export interface SessionSnapshot {
  docs: Record<RefKey, DocumentState>
  canUndo: boolean
  canRedo: boolean
  /** A publish, discard or reload is running. */
  busy: boolean
}

interface HistoryEntry {
  key: RefKey
  before: Doc
  after: Doc
}

export interface EditorSessionOptions {
  dataSource: DataSource
  locale?: string | undefined
  /** Autosave debounce, ms. Default: the collection's autosave interval, else 800. */
  autosaveDelay?: number | undefined
  /** Called after a document's edits were saved; `seq` increments per save. Renderers refresh here. */
  onSaved?: ((ref: DocRef, seq: number) => void) | undefined
}

export interface PublishResult {
  ok: boolean
  message?: string | undefined
  published: DocRef[]
  /** The fields a validation error named (the document is in `invalid` too). */
  fields?: FieldError[] | undefined
}

/** Schemas are per collection or global, not per document. */
/** One schema per document: field access can depend on the document itself. */
type SchemaKey = RefKey
const schemaKey = (ref: DocRef): SchemaKey => refKey(ref)

const HISTORY_LIMIT = 200
const IDLE: SaveState = { status: 'idle', seq: 0 }

export class EditorSession {
  readonly dataSource: DataSource
  readonly locale: string | undefined
  private docs = new Map<RefKey, DocumentState>()
  private queues = new Map<RefKey, AutosaveQueue>()
  private updatedAt = new Map<RefKey, string | undefined>()
  /** Last value queued for saving, per document (diff base for the next save). */
  private saved = new Map<RefKey, Doc>()
  /** Value before the current run of transient edits, per document. */
  private anchors = new Map<RefKey, Doc>()
  /** Documents whose value came from the page (client mode); a late server load must not replace it. */
  private fromPage = new Set<RefKey>()
  private loading = new Map<RefKey, Promise<void>>()
  private schemaCache = new Map<SchemaKey, Promise<DocumentSchema>>()
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private listeners = new Set<() => void>()
  private ops: Promise<unknown> = Promise.resolve()
  private running = 0
  private snapshot: SessionSnapshot = { docs: {}, canUndo: false, canRedo: false, busy: false }
  private disposed = false
  private readonly autosaveDelay: number | undefined
  private readonly onSaved: ((ref: DocRef, seq: number) => void) | undefined

  constructor(opts: EditorSessionOptions) {
    this.dataSource = opts.dataSource
    this.locale = opts.locale
    this.autosaveDelay = opts.autosaveDelay
    this.onSaved = opts.onSaved
  }

  // ── store plumbing ──────────────────────────────────────────────────────
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): SessionSnapshot => this.snapshot

  private emit() {
    if (this.disposed) return
    this.snapshot = {
      docs: Object.fromEntries(this.docs),
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      busy: this.running > 0,
    }
    for (const fn of this.listeners) fn()
  }

  /** After a publish: no unpublished edits, and the local copy says so. */
  private markPublished(key: RefKey) {
    const doc = this.docs.get(key)?.doc
    this.patchState(key, {
      edited: false,
      invalid: undefined,
      doc: doc ? { ...doc, _status: 'published' } : null,
    })
  }

  private patchState(key: RefKey, patch: Partial<DocumentState>) {
    const cur = this.docs.get(key)
    if (!cur) return
    this.docs.set(key, { ...cur, ...patch })
    this.emit()
  }

  get(key: RefKey): DocumentState | undefined {
    return this.docs.get(key)
  }

  /** Run session-level operations (publish, discard, reload) one at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ops.then(async () => {
      this.running += 1
      this.emit()
      try {
        return await fn()
      } finally {
        this.running -= 1
        this.emit()
      }
    })
    this.ops = run.catch(() => undefined)
    return run
  }

  // ── loading ─────────────────────────────────────────────────────────────
  private schemaFor(ref: DocRef): Promise<DocumentSchema> {
    const k = schemaKey(ref)
    let p = this.schemaCache.get(k)
    if (!p) {
      p = this.dataSource.loadSchema(ref, { locale: this.locale })
      this.schemaCache.set(k, p)
      p.catch(() => this.schemaCache.delete(k))
    }
    return p
  }

  /**
   * Start editing a document. With `initialDoc` (client mode: the page already
   * holds the draft) only the schema is fetched; otherwise the draft is loaded.
   * Opening an open document is a no-op, except that a page-provided value
   * replaces one still loading.
   */
  open(ref: DocRef, initialDoc?: Doc): Promise<void> {
    const key = refKey(ref)
    const existing = this.docs.get(key)
    if (existing && existing.status !== 'error') {
      if (initialDoc && !existing.edited && !this.fromPage.has(key)) {
        this.fromPage.add(key)
        this.adopt(key, initialDoc)
        this.emit()
      }
      return this.loading.get(key) ?? Promise.resolve()
    }
    this.docs.set(key, {
      key,
      ref,
      status: 'loading',
      schema: null,
      doc: null,
      save: IDLE,
      edited: false,
    })
    if (initialDoc) {
      this.fromPage.add(key)
      this.adopt(key, initialDoc)
    }
    this.emit()
    const task = (async () => {
      try {
        const [schema, doc] = await Promise.all([
          this.schemaFor(ref),
          initialDoc
            ? null
            : this.dataSource.loadDocument(ref, { draft: true, locale: this.locale, depth: 2 }),
        ])
        // The page may have handed us its value meanwhile; it wins.
        if (doc && !this.fromPage.has(key)) this.adopt(key, doc)
        this.patchState(key, { schema, status: 'ready', error: undefined })
      } catch (e) {
        this.patchState(key, { status: 'error', error: errorText(e) })
      } finally {
        this.loading.delete(key)
      }
    })()
    this.loading.set(key, task)
    return task
  }

  /** Try loading a document again after an error. */
  retry(key: RefKey): Promise<void> {
    const state = this.docs.get(key)
    if (!state) return Promise.resolve()
    if (state.status === 'error') return this.open(state.ref)
    this.queues.get(key)?.retry()
    return Promise.resolve()
  }

  private adopt(key: RefKey, raw: Doc) {
    // A page rendered with auto-mapping markers may hand us its marked copy; edit clean values.
    const doc = stegaCleanDeep(raw)
    this.saved.set(key, doc)
    this.updatedAt.set(key, typeof doc.updatedAt === 'string' ? doc.updatedAt : undefined)
    const cur = this.docs.get(key)
    if (cur) this.docs.set(key, { ...cur, doc })
  }

  private queueFor(key: RefKey): AutosaveQueue {
    let q = this.queues.get(key)
    if (q) return q
    const state = this.docs.get(key)
    if (!state) throw new Error(`payload-onpage: ${key} is not open in this session`)
    q = new AutosaveQueue({
      delay: this.autosaveDelay ?? state.schema?.autosaveInterval ?? 800,
      onState: (save) => {
        this.patchState(key, {
          save,
          ...(save.status === 'error' ? { invalid: save.fields } : {}),
          ...(save.status === 'saved' ? { invalid: undefined } : {}),
        })
        if (save.status === 'saved') this.onSaved?.(state.ref, save.seq)
      },
      send: async (patch) => {
        const res = await this.dataSource.saveDraft(state.ref, patch, {
          locale: this.locale,
          updatedAt: this.updatedAt.get(key),
        })
        if (res.ok && res.updatedAt) this.updatedAt.set(key, res.updatedAt)
        return res
      },
    })
    this.queues.set(key, q)
    return q
  }

  /** Schedule the editable top-level fields that changed since the last save. */
  private queueChanges(key: RefKey, next: Doc) {
    const schema = this.docs.get(key)?.schema
    if (!schema) return
    const keys = changedKeys(this.saved.get(key) ?? {}, next, schema.editable)
    if (!keys.length) return
    this.saved.set(key, next)
    this.queueFor(key).schedule(buildPatch(next, keys, schema.fields))
  }

  // ── editing ─────────────────────────────────────────────────────────────
  /** Change a document. `transient` updates the view only (live typing): no history, no save. */
  apply(key: RefKey, fn: (doc: Doc) => Doc, opts: { transient?: boolean } = {}) {
    const state = this.docs.get(key)
    if (!state?.doc) return
    const before = state.doc
    const next = fn(before)
    if (next === before) return
    if (opts.transient) {
      if (!this.anchors.has(key)) this.anchors.set(key, before)
      this.docs.set(key, { ...state, doc: next })
      this.emit()
      return
    }
    const anchor = this.anchors.get(key) ?? before
    this.anchors.delete(key)
    this.past.push({ key, before: anchor, after: next })
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
    this.docs.set(key, { ...state, doc: next, edited: true })
    this.queueChanges(key, next)
    this.emit()
  }

  setValue(key: RefKey, path: string, value: unknown, opts: { transient?: boolean } = {}) {
    this.apply(key, (d) => setAt(d, path, value), opts)
  }

  /** Drop transient changes (Escape while typing). */
  cancelTransient(key: RefKey) {
    const anchor = this.anchors.get(key)
    const state = this.docs.get(key)
    if (!anchor || !state) return
    this.anchors.delete(key)
    this.docs.set(key, { ...state, doc: anchor })
    this.emit()
  }

  private restore(key: RefKey, doc: Doc) {
    const state = this.docs.get(key)
    if (!state) return
    this.anchors.delete(key)
    this.docs.set(key, { ...state, doc, edited: true })
    this.queueChanges(key, doc)
  }

  undo() {
    const entry = this.past.pop()
    if (!entry) return
    this.future.unshift(entry)
    this.restore(entry.key, entry.before)
    this.emit()
  }

  redo() {
    const entry = this.future.shift()
    if (!entry) return
    this.past.push(entry)
    this.restore(entry.key, entry.after)
    this.emit()
  }

  // ── saving ──────────────────────────────────────────────────────────────
  async flush(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.flush()))
  }

  get hasPendingSaves(): boolean {
    return [...this.queues.values()].some((q) => q.hasPending)
  }

  /** Has unpublished changes: edited here, or its latest version is a draft. */
  private unpublished(state: DocumentState): boolean {
    return state.edited || state.doc?._status === 'draft'
  }

  /** Does this document have changes that aren't published yet? */
  hasUnpublished(key: RefKey): boolean {
    const state = this.docs.get(key)
    return !!state && this.unpublished(state)
  }

  private selected(keys?: RefKey[]): DocumentState[] {
    return [...this.docs.values()].filter(
      (s) => (!keys || keys.includes(s.key)) && s.doc && s.schema && this.unpublished(s),
    )
  }

  /** Publish every document with unpublished changes (edited here, or saved as a draft before). */
  publish(opts: { keys?: RefKey[] } = {}): Promise<PublishResult> {
    return this.serial(async () => {
      await this.flush()
      const published: DocRef[] = []
      for (const { key } of this.selected(opts.keys)) {
        // Re-read after every await: edits made meanwhile must not be lost.
        const state = this.docs.get(key)
        if (!state?.doc || !state.schema) continue
        const label = state.schema.labels.singular
        if (state.save.status === 'conflict')
          return { ok: false, message: `${label}: reload the latest version first`, published }
        if (state.save.status === 'error')
          return {
            ok: false,
            message: `${label}: ${state.save.message ?? 'unsaved changes'}`,
            published,
          }
        let res
        try {
          res = await this.dataSource.publish(
            state.ref,
            buildPatch(state.doc, state.schema.editable, state.schema.fields),
            {
              locale: this.locale,
              updatedAt: this.updatedAt.get(key),
            },
          )
        } catch (e) {
          return { ok: false, message: `${label}: ${errorText(e)}`, published }
        }
        if (!res.ok) {
          this.patchState(key, { invalid: res.fields })
          return {
            ok: false,
            message: res.message ?? `${label}: publish failed (${res.status})`,
            published,
            ...(res.fields ? { fields: res.fields } : {}),
          }
        }
        if (res.updatedAt) this.updatedAt.set(key, res.updatedAt)
        this.markPublished(key)
        published.push(state.ref)
      }
      return { ok: true, published }
    })
  }

  /** Reset drafts with unpublished changes to their published versions (also clears a conflict). */
  /**
   * Reset the drafts to their published values. Done as an edit, so it lands on
   * the undo stack: undo right after a discard brings the changes back (and
   * autosave saves them again).
   */
  discard(opts: { keys?: RefKey[] } = {}): Promise<void> {
    return this.serial(async () => {
      await this.flush()
      for (const { key, ref } of this.selected(opts.keys)) {
        const [published, latest] = await Promise.all([
          this.dataSource.loadDocument(ref, { draft: false, locale: this.locale, depth: 2 }),
          this.dataSource.loadDocument(ref, { draft: true, locale: this.locale, depth: 2 }),
        ])
        const state = this.docs.get(key)
        if (!isReady(state)) continue
        // Continue from the server's latest draft (so the stale-write guard accepts the reset).
        this.adopt(key, latest)
        this.queues.get(key)?.reset()
        const next = { ...stegaCleanDeep(latest) }
        for (const k of state.schema.editable) next[k] = published[k]
        this.apply(key, () => next)
        await this.queues.get(key)?.flush()
        this.markPublished(key)
      }
    })
  }

  /**
   * After a conflict: load the latest draft and re-apply this editor's unsaved
   * changes on top of it, field by field. Fields only someone else changed
   * keep their version; fields both changed take this editor's. Undoable.
   */
  keepMine(key: RefKey): Promise<void> {
    return this.serial(async () => {
      const state = this.docs.get(key)
      const queue = this.queues.get(key)
      const mine = queue?.unsaved
      if (!isReady(state) || !mine) return
      const ours = state.doc
      const latest = await this.dataSource.loadDocument(state.ref, {
        draft: true,
        locale: this.locale,
        depth: 2,
      })
      this.adopt(key, latest)
      queue.reset()
      const merged = { ...stegaCleanDeep(latest) }
      for (const k of Object.keys(mine)) merged[k] = ours[k]
      this.apply(key, () => merged)
      await queue.flush()
    })
  }

  /** After a conflict: load the latest draft of a document and continue from it (local edits are dropped). */
  reload(key: RefKey): Promise<void> {
    return this.serial(() => this.continueFromServer(key))
  }

  /**
   * Make a saved version the current draft (`DataSource.restoreVersion`), then
   * continue from it. Pending edits are saved first, so they're in the history.
   */
  restoreVersion(key: RefKey, versionId: string | number): Promise<void> {
    return this.serial(async () => {
      const state = this.docs.get(key)
      if (!state || !this.dataSource.restoreVersion) return
      await this.flush()
      await this.dataSource.restoreVersion(state.ref, versionId)
      await this.continueFromServer(key)
    })
  }

  /** Load the latest draft and continue from it: this document's local history is dropped. */
  private async continueFromServer(key: RefKey) {
    const state = this.docs.get(key)
    if (!state) return
    const doc = await this.dataSource.loadDocument(state.ref, {
      draft: true,
      locale: this.locale,
      depth: 2,
    })
    this.adopt(key, doc)
    this.anchors.delete(key)
    this.past = this.past.filter((e) => e.key !== key)
    this.future = this.future.filter((e) => e.key !== key)
    this.queues.get(key)?.reset()
    this.patchState(key, { edited: false })
  }

  /** Stop timers and listeners (unmount). Call flush() first to keep unsent edits. */
  dispose() {
    for (const q of this.queues.values()) q.dispose()
    this.listeners.clear()
    this.disposed = true
  }
}
