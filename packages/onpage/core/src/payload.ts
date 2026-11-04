/**
 * @cargo/onpage-core/payload — the default adapters over Payload's REST API (cookie auth, same origin):
 *   payloadRest()     DataSource for collections and globals
 *   payloadUploads()  MediaLibrary over an upload collection
 * Every write is a normal PATCH, so access control, hooks, validation, drafts
 * and versions behave exactly as in the admin.
 */
import type { DocRef } from './docref.ts'
import { DEFAULTS, HEADER, ROUTES } from './constants.ts'
import { stegaClean, stegaCleanDeep } from './stega.ts'
import type {
  DataSource,
  Doc,
  FieldError,
  MediaItem,
  MediaLibrary,
  NewPage,
  PageComment,
  PreviewLink,
  SavedSection,
  SaveResult,
  ScheduledPublish,
  SearchHit,
  VersionSummary,
} from './ports.ts'
import type { DocumentSchema } from './schema.ts'

export interface PayloadRestOptions {
  /** API base, default "/api". */
  apiBase?: string
  /** Plugin endpoint prefix, default "/onpage". */
  prefix?: `/${string}`
  /** Extra request init (headers for a custom auth scheme, etc.). */
  init?: RequestInit
  fetch?: typeof fetch
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v))
  return s.toString()
}

/** The best human-readable message from a Payload error response. */
interface PayloadErrorBody {
  error?: string
  errors?: Array<{
    message?: string
    data?: { errors?: Array<{ message?: string; path?: string; field?: string }> }
  }>
}

const readBody = async (res: Response): Promise<PayloadErrorBody | null> => {
  try {
    return (await res.clone().json()) as PayloadErrorBody
  } catch {
    return null
  }
}

export async function errorMessage(res: Response): Promise<string> {
  const body = await readBody(res)
  if (!body) return res.statusText || `HTTP ${res.status}`
  const first = body.errors?.[0]
  const detail = first?.data?.errors?.[0]?.message
  return [first?.message ?? body.error ?? res.statusText, detail].filter(Boolean).join(': ')
}

/** Every field a Payload ValidationError names, with its message. */
export async function fieldErrors(res: Response): Promise<FieldError[]> {
  const body = await readBody(res)
  return (body?.errors ?? []).flatMap((e) =>
    (e.data?.errors ?? []).flatMap((d) => {
      const path = d.path ?? d.field
      return typeof path === 'string' && path
        ? [{ path, message: typeof d.message === 'string' ? d.message : '' }]
        : []
    }),
  )
}

interface ClientOptions {
  init?: RequestInit
  fetch?: typeof fetch
}

/**
 * The fetch and request init both adapters use: cookie auth by default, plus the
 * caller's `init` (custom auth headers…) on every request. Headers are merged
 * through `Headers`, so a `Headers` instance or tuple list works as well as an object.
 */
function client(opts: ClientOptions) {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const init = (extra: RequestInit = {}): RequestInit => {
    const headers = new Headers(opts.init?.headers)
    new Headers(extra.headers).forEach((v, k) => headers.set(k, v))
    return { credentials: 'include', ...opts.init, ...extra, headers }
  }
  return { f, init }
}

export function payloadRest(
  opts: PayloadRestOptions = {},
): DataSource & Required<Pick<DataSource, 'createPreviewLink'>> {
  const api = opts.apiBase ?? DEFAULTS.apiRoute
  const prefix = opts.prefix ?? DEFAULTS.routePrefix
  const { f, init } = client(opts)
  const docUrl = (ref: DocRef) =>
    ref.kind === 'global' ? `${api}/globals/${ref.slug}` : `${api}/${ref.slug}/${ref.id}`

  const write = async (
    ref: DocRef,
    data: Doc,
    o: { locale?: string | undefined; updatedAt?: string | undefined },
    publish: boolean,
  ): Promise<SaveResult> => {
    const query = qs({
      locale: o.locale,
      depth: 0,
      draft: publish ? undefined : true,
      autosave: publish ? undefined : true,
    })
    const body = publish ? { ...data, _status: 'published' } : data
    const res = await f(
      `${docUrl(ref)}?${query}`,
      init({
        method: ref.kind === 'global' ? 'POST' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          // Stale-write guard, checked by the plugin (409 when someone else saved since).
          ...(o.updatedAt ? { [HEADER.ifUnmodifiedSince]: o.updatedAt } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
    if (!res.ok) {
      const fields = await fieldErrors(res)
      return {
        ok: false,
        status: res.status,
        message: await errorMessage(res),
        ...(fields.length ? { fields } : {}),
      }
    }
    const json = (await res.json().catch(() => ({}))) as { doc?: Doc; result?: Doc } & Doc
    const doc: Doc = json.doc ?? json.result ?? json
    return { ok: true, updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : undefined }
  }

  /** POST JSON to one of the plugin's endpoints; the parsed answer, or the server's error. */
  const post = async <T>(route: string, body: unknown): Promise<T> => {
    const res = await f(
      `${api}${prefix}${route}`,
      init({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    if (!res.ok) throw new Error(await errorMessage(res))
    return (await res.json()) as T
  }

  return {
    async loadSchema(ref, o): Promise<DocumentSchema> {
      const res = await f(
        `${api}${prefix}/schema/${ref.kind}/${ref.slug}?${qs({
          locale: o.locale,
          id: ref.kind === 'collection' ? ref.id : undefined,
        })}`,
        init(),
      )
      if (!res.ok) throw new Error(`Schema for ${ref.slug}: ${await errorMessage(res)}`)
      return (await res.json()) as DocumentSchema
    },
    async loadDocument(ref, o) {
      const res = await f(
        `${docUrl(ref)}?${qs({ draft: o.draft, depth: o.depth ?? 2, locale: o.locale })}`,
        init(),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      return (await res.json()) as Doc
    },
    saveDraft: (ref, data, o) => write(ref, data, o, false),
    publish: (ref, data, o) => write(ref, data, o, true),
    // Payload's own REST API: its access control decides what each user may find.
    async search(collection, o): Promise<SearchHit[]> {
      const titleField = o.titleField ?? 'id'
      const p = new URLSearchParams({ depth: '1', limit: String(o.limit ?? 10) })
      if (o.locale) p.set('locale', o.locale)
      if (o.query)
        p.set(`where[${titleField}][${titleField === 'id' ? 'equals' : 'like'}]`, o.query)
      const res = await f(`${api}/${collection}?${p}`, init(o.signal ? { signal: o.signal } : {}))
      if (!res.ok) throw new Error(await errorMessage(res))
      const body = (await res.json()) as { docs?: Doc[] }
      return (body.docs ?? []).map((doc) => {
        const title = doc[titleField]
        return {
          id: doc.id as string | number,
          title: typeof title === 'string' && title ? title : String(doc.id),
          doc,
        }
      })
    },
    async lock(ref, action) {
      const res = await f(
        `${api}${prefix}${ROUTES.lock}`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: ref.kind,
            slug: ref.slug,
            id: ref.kind === 'collection' ? ref.id : undefined,
            action,
          }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      const body = (await res.json()) as { lockedBy?: unknown }
      return { lockedBy: typeof body.lockedBy === 'string' ? body.lockedBy : null }
    },
    async listVersions(ref, o): Promise<VersionSummary[]> {
      const base = ref.kind === 'global' ? `${api}/globals/${ref.slug}` : `${api}/${ref.slug}`
      const p = new URLSearchParams({
        sort: '-updatedAt',
        limit: String(o.limit ?? 20),
        depth: '0',
      })
      if (ref.kind === 'collection') p.set('where[parent][equals]', String(ref.id))
      const res = await f(`${base}/versions?${p}`, init())
      if (!res.ok) throw new Error(await errorMessage(res))
      const body = (await res.json()) as {
        docs?: Array<{
          id: string | number
          updatedAt?: string
          autosave?: boolean
          version?: { _status?: string }
        }>
      }
      return (body.docs ?? []).map((v) => ({
        id: v.id,
        updatedAt: v.updatedAt ?? '',
        status:
          v.version?._status === 'published' || v.version?._status === 'draft'
            ? v.version._status
            : undefined,
        autosave: !!v.autosave,
      }))
    },
    async restoreVersion(ref, versionId): Promise<void> {
      const base = ref.kind === 'global' ? `${api}/globals/${ref.slug}` : `${api}/${ref.slug}`
      // As a draft: restoring from the page never publishes.
      const res = await f(
        `${base}/versions/${encodeURIComponent(String(versionId))}?draft=true&depth=0`,
        init({ method: 'POST' }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
    },
    async listComments(ref): Promise<PageComment[]> {
      const p = new URLSearchParams({ kind: ref.kind, slug: ref.slug })
      if (ref.kind === 'collection') p.set('id', String(ref.id))
      const res = await f(`${api}${prefix}${ROUTES.comments}?${p}`, init())
      if (!res.ok) throw new Error(await errorMessage(res))
      return ((await res.json()) as { comments?: PageComment[] }).comments ?? []
    },
    async addComment(ref, c) {
      const res = await f(
        `${api}${prefix}${ROUTES.comments}`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: ref.kind,
            slug: ref.slug,
            id: ref.kind === 'collection' ? ref.id : undefined,
            body: c.body,
            path: c.path,
          }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
    },
    async resolveComment(id, resolved) {
      const res = await f(
        `${api}${prefix}${ROUTES.comments}/resolve`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, resolved }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
    },
    async requestReview(ref, o) {
      const res = await f(
        `${api}${prefix}${ROUTES.review}`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: ref.kind,
            slug: ref.slug,
            id: ref.kind === 'collection' ? ref.id : undefined,
            note: o.note,
            locale: o.locale,
          }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      return (await res.json()) as { url: string; expiresAt: string }
    },
    async duplicatePage(ref, o): Promise<NewPage> {
      if (ref.kind !== 'collection') throw new Error('Only collection documents can be copied')
      return post<NewPage>(ROUTES.pages, {
        action: 'duplicate',
        slug: ref.slug,
        id: ref.id,
        title: o.title,
      })
    },
    async createPage(collection, o): Promise<NewPage> {
      return post<NewPage>(ROUTES.pages, { slug: collection, title: o.title })
    },
    async listPatterns(o): Promise<SavedSection[]> {
      const q = o.blocks?.length ? `?blocks=${encodeURIComponent(o.blocks.join(','))}` : ''
      const res = await f(`${api}${prefix}${ROUTES.patterns}${q}`, init())
      if (!res.ok) throw new Error(await errorMessage(res))
      return ((await res.json()) as { patterns?: SavedSection[] }).patterns ?? []
    },
    async savePattern(name, block) {
      await post(ROUTES.patterns, { name, block: stegaCleanDeep(block) })
    },
    async hiddenFields(ref, doc): Promise<string[]> {
      const res = await f(
        `${api}${prefix}${ROUTES.conditions}`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: ref.kind,
            slug: ref.slug,
            id: ref.kind === 'collection' ? ref.id : undefined,
            data: stegaCleanDeep(doc),
          }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      const body = (await res.json()) as { hidden?: unknown }
      return Array.isArray(body.hidden) ? body.hidden.filter((p) => typeof p === 'string') : []
    },
    async schedulePublish(ref, o): Promise<ScheduledPublish> {
      const res = await f(
        `${api}${prefix}${ROUTES.schedule}`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: ref.kind,
            slug: ref.slug,
            id: ref.kind === 'collection' ? ref.id : undefined,
            at: o.at.toISOString(),
            type: o.type ?? 'publish',
            locale: o.locale,
          }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      return (await res.json()) as ScheduledPublish
    },
    async createPreviewLink(ref, o): Promise<PreviewLink> {
      const res = await f(
        `${api}${prefix}/preview-link`,
        init({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: ref.kind,
            slug: ref.slug,
            id: ref.kind === 'collection' ? ref.id : undefined,
            locale: o.locale,
          }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      return (await res.json()) as PreviewLink
    },
  }
}

export interface PayloadUploadsOptions {
  apiBase?: string
  pageSize?: number
  /** Extra request init (headers for a custom auth scheme, etc.), as for `payloadRest`. */
  init?: RequestInit
  fetch?: typeof fetch
}

/** Smallest image size at least this wide is used for picker thumbnails. */
const THUMB_WIDTH = 240

/**
 * A thumbnail URL: Payload's `thumbnailURL` (the collection's adminThumbnail),
 * else the smallest generated size that is still wide enough, whatever the
 * sizes are named (`sizes` in Payload 3, `variants` in Payload 4), else the original.
 */
function thumbOf(doc: Doc): string | undefined {
  if (typeof doc.thumbnailURL === 'string' && doc.thumbnailURL) return doc.thumbnailURL
  const sizes = Object.values(
    (doc.variants ?? doc.sizes ?? {}) as Record<
      string,
      { url?: string | null; width?: number | null } | undefined
    >,
  )
    .filter(
      (s): s is { url: string; width?: number | null } => typeof s?.url === 'string' && !!s.url,
    )
    .sort((a, b) => (a.width ?? Infinity) - (b.width ?? Infinity))
  const fit = sizes.find((s) => (s.width ?? 0) >= THUMB_WIDTH) ?? sizes.at(-1)
  return fit?.url ?? (typeof doc.url === 'string' ? doc.url : undefined)
}

const toItem = (doc: Doc): MediaItem => ({
  id: doc.id as string | number,
  url: (doc.url as string) ?? null,
  thumbnailUrl: thumbOf(doc) ?? null,
  alt: (doc.alt as string) ?? null,
  filename: (doc.filename as string) ?? null,
  doc,
})

export function payloadUploads(
  opts: PayloadUploadsOptions = {},
): MediaLibrary & Required<Pick<MediaLibrary, 'upload' | 'updateAlt'>> {
  const api = opts.apiBase ?? DEFAULTS.apiRoute
  const { f, init } = client(opts)
  return {
    async search({ query, page = 1, relationTo, signal }) {
      const p = new URLSearchParams({
        depth: '0',
        limit: String(opts.pageSize ?? 30),
        page: String(page),
        sort: '-createdAt',
      })
      p.set('where[and][0][mimeType][contains]', 'image')
      if (query) {
        p.set('where[and][1][or][0][filename][like]', query)
        p.set('where[and][1][or][1][alt][like]', query)
      }
      const res = await f(`${api}/${relationTo}?${p}`, init(signal ? { signal } : {}))
      if (!res.ok) throw new Error(await errorMessage(res))
      const body = (await res.json()) as { docs?: Doc[]; hasNextPage?: boolean }
      return { items: (body.docs ?? []).map(toItem), hasMore: Boolean(body.hasNextPage) }
    },
    async upload(file, { relationTo, alt }) {
      const form = new FormData()
      form.append('file', file)
      // Document fields must go in `_payload`; loose multipart parts are ignored by Payload.
      form.append(
        '_payload',
        JSON.stringify({ alt: alt ?? file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }),
      )
      const res = await f(`${api}/${relationTo}`, init({ method: 'POST', body: form }))
      if (!res.ok) throw new Error(await errorMessage(res))
      return toItem(((await res.json()) as { doc: Doc }).doc)
    },
    async updateAlt(id, { relationTo, alt }) {
      const res = await f(
        `${api}/${relationTo}/${encodeURIComponent(String(id))}?depth=0`,
        init({
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // The media collection may not be enabled for on-page editing, so no
          // server hook strips markers from it: send clean text.
          body: JSON.stringify({ alt: stegaClean(alt) }),
        }),
      )
      if (!res.ok) throw new Error(await errorMessage(res))
      return toItem(((await res.json()) as { doc: Doc }).doc)
    },
  }
}
