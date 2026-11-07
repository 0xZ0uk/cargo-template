/**
 * The plugin's endpoints, under `${api}${routePrefix}` (default /api/onpage):
 *
 *   GET  /schema/:kind/:slug   editable field schema for the signed-in editor (JSON)
 *   POST /enter                start editing or previewing a document's page
 *   POST /mode                 switch the current page between editing and previewing
 *   POST /exit                 leave edit/preview mode
 *   POST /preview-link         create a sealed, expiring read-only link (JSON)
 *   GET  /preview?token=       open a preview link
 *
 * JSON endpoints throw Payload's errors, so responses, logging, CORS and
 * translations match Payload's own. The form/new-tab endpoints answer in plain
 * text or redirect. State-changing endpoints are same-origin POSTs (CSRF-safe),
 * and every authorization decision goes through ./access (Payload's access rules).
 */
import {
  isOnPageMode,
  modeSealer,
  parseRefKey,
  pathnameOf,
  refKey,
  ROUTES,
  safePath,
  samePath,
  SEAL_PURPOSE,
  seal,
  stegaClean,
  stegaCleanDeep,
  type DocRef,
  type DocumentSchema,
  type PreviewGrant,
  type SealSecret,
  type SessionAdapter,
} from '@shipment/onpage-core'
import {
  addDataAndFileToRequest,
  APIError,
  Forbidden,
  NotFound,
  type Endpoint,
  type PayloadRequest,
  type TypedLocale,
} from 'payload'
import {
  getAutosaveInterval,
  hasAutosaveEnabled,
  hasDraftsEnabled,
  hasScheduledPublishEnabled,
  toWords,
} from 'payload/shared'
import {
  canEditDocument,
  canPublishDocument,
  canUseOnPage,
  documentPermissions,
  isUpdateDenied,
} from './access.ts'
import {
  apiURL,
  entityConfig,
  isSecure,
  json,
  readRef,
  redirectTo,
  rejectCrossSite,
  text,
  withIdType,
} from './http.ts'
import type { Entry, OnPageOptions } from './options.ts'
import { resolvePath } from './paths.ts'
import { hasConditions, hiddenPaths } from './conditions.ts'
import { applyLock } from './locks.ts'
import { hasSlugField, slugify, uniqueSlug } from './pages.ts'
import { MAX_PATTERN_BYTES, PATTERNS } from './patterns.ts'
import {
  boundedText,
  COMMENTS,
  commentTarget,
  commentsWhere,
  guestGrant,
  LIMITS,
} from './comments.ts'
import { label, relationTargets, serializeFields } from './schema.ts'
import { createPreviewToken, verifyPreviewToken } from './tokens.ts'

export interface EndpointContext {
  options: OnPageOptions & { session: SessionAdapter }
  prefix: `/${string}`
  entry: (kind: DocRef['kind'], slug: string) => Entry | undefined
  entries: Entry[]
}

const DAY = 24 * 3600

/** A user's display name: their collection's title field, else their email. */
const authorName = (req: PayloadRequest, user: unknown): string | undefined => {
  if (!user || typeof user !== 'object') return undefined
  const u = user as Record<string, unknown>
  const titleField =
    req.payload.collections[req.payload.config.admin.user]?.config.admin?.useAsTitle
  const title = titleField ? u[titleField] : undefined
  if (typeof title === 'string' && title) return title
  return typeof u.email === 'string' ? u.email : undefined
}

const secretOf = (req: PayloadRequest, options: OnPageOptions): SealSecret =>
  options.secret ?? req.payload.config.secret

/** Name of the auth cookie an editor's mode is bound to. */
const authCookieOf = (req: PayloadRequest, options: OnPageOptions): string =>
  options.authCookie ?? `${req.payload.config.cookiePrefix || 'payload'}-token`

/**
 * Seal and bind options for `session.enable`. Without the auth cookie in the
 * request (header or API-key auth, a renamed cookie) the mode can't be bound,
 * so signing out wouldn't end it: allowed, but logged.
 */
const enableOptions = (req: PayloadRequest, options: OnPageOptions) => {
  const bindTo = authCookieOf(req, options)
  const sent = (req.headers.get('cookie') ?? '')
    .split(';')
    .some((c) => c.trim().startsWith(`${bindTo}=`))
  if (!sent)
    req.payload.logger.warn(
      `payload-onpage: no "${bindTo}" cookie on this request, so edit mode isn't bound to the editor's session and won't end when they sign out. Set the plugin's \`authCookie\` option if your auth cookie has another name.`,
    )
  return { secure: isSecure(req), bindTo, sealMode: modeSealer(secretOf(req, options)) }
}

/** A locale value from a body, if it's one Payload knows. */
const knownLocale = (req: PayloadRequest, value: unknown): TypedLocale | undefined =>
  typeof value === 'string' && req.payload.config.localization
    ? req.payload.config.localization.localeCodes.find((c) => c === value)
    : undefined

export function createEndpoints(ctx: EndpointContext): Endpoint[] {
  const { options, prefix } = ctx
  const { session } = options

  /** True when the user may update at least one enabled document (row-level rules count). */
  const canEditAnything = async (req: PayloadRequest): Promise<boolean> => {
    const checks = await Promise.all(
      ctx.entries.map((e) => documentPermissions(req, { kind: e.kind, slug: e.slug })),
    )
    return checks.some((perms) => !isUpdateDenied(perms))
  }

  const schema: Endpoint = {
    path: `${prefix}${ROUTES.schema}/:kind/:slug`,
    method: 'get',
    handler: async (req) => {
      const kind = req.routeParams?.kind === 'global' ? 'global' : 'collection'
      const slug = typeof req.routeParams?.slug === 'string' ? req.routeParams.slug : ''
      const entry = ctx.entry(kind, slug)
      const cfg = entityConfig(req, kind, slug)
      if (!entry || !cfg) throw new NotFound(req.t)
      if (!(await canUseOnPage(req, options))) throw new Forbidden(req.t)

      // With the document's id, field rules that depend on the document (`({ doc })`)
      // are evaluated against it, so the editor offers exactly what a save will keep.
      const id = req.searchParams.get('id')
      const ref = kind === 'collection' && id ? readRef(req, { kind, slug, id }) : null
      const perms = await documentPermissions(req, ref ?? { kind, slug })
      if (isUpdateDenied(perms)) throw new Forbidden(req.t)
      const pending: Promise<void>[] = []
      const all = serializeFields(cfg.fields, {
        i18n: req.i18n,
        blocks: req.payload.config.blocks,
        permissions: perms?.fields,
        defaults: { req, pending },
      })
      await Promise.all(pending)
      const only = entry.options.fields
      const fields = only ? all.filter((f) => only.includes(f.name)) : all

      const i18n = { i18n: req.i18n }
      const relations: NonNullable<DocumentSchema['relations']> = {}
      // Rich text can link to the site's pages: the collections enabled here.
      const hasRichText = (list: typeof fields): boolean =>
        list.some(
          (f) =>
            f.type === 'richText' ||
            ((f.type === 'group' || f.type === 'array') && hasRichText(f.fields)) ||
            (f.type === 'blocks' && f.blocks.some((b) => hasRichText(b.fields))),
        )
      const linkTargets = hasRichText(fields)
        ? ctx.entries.filter((e) => e.kind === 'collection').map((e) => e.slug)
        : []
      for (const target of [...relationTargets(fields), ...linkTargets]) {
        const c = entityConfig(req, 'collection', target)
        if (c)
          relations[target] = {
            titleField: c.admin?.useAsTitle ?? 'id',
            label: label(c.labels?.singular, toWords(target), i18n),
          }
      }
      const labels =
        'labels' in cfg
          ? {
              singular: label(cfg.labels?.singular, toWords(slug), i18n),
              plural: label(cfg.labels?.plural, toWords(slug), i18n),
            }
          : {
              singular: label(cfg.label, toWords(slug), i18n),
              plural: label(cfg.label, toWords(slug), i18n),
            }
      const useAsTitle = 'labels' in cfg ? cfg.admin?.useAsTitle : undefined
      const localization = req.payload.config.localization
      const body: DocumentSchema = {
        kind,
        slug,
        labels,
        editable: fields.map((f) => f.name),
        fields,
        drafts: hasDraftsEnabled(cfg),
        ...(hasScheduledPublishEnabled(cfg) ? { schedulePublish: true } : {}),
        ...(hasConditions(cfg.fields, req.payload.config.blocks) ? { conditions: true } : {}),
        ...(options.comments ? { comments: true } : {}),
        ...(options.patterns ? { patterns: true } : {}),
        ...(ref || kind === 'global'
          ? {
              canPublish: await canPublishDocument(req, ref ?? { kind: 'global', slug }, options),
            }
          : {}),
        ...(hasAutosaveEnabled(cfg) ? { autosaveInterval: getAutosaveInterval(cfg) } : {}),
        ...(useAsTitle ? { useAsTitle } : {}),
        ...(Object.keys(relations).length ? { relations } : {}),
        ...(linkTargets.length ? { linkTargets } : {}),
        ...(localization
          ? { defaultLocale: localization.defaultLocale, locales: localization.localeCodes }
          : {}),
      }
      return json(body)
    },
  }

  const enter: Endpoint = {
    path: `${prefix}${ROUTES.enter}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      // Authenticate before parsing the ref, so anonymous callers can't probe
      // which slugs are enabled by the status code.
      if (!req.user) return text('Sign in to the admin first', 401)
      if (!(await canUseOnPage(req, options))) return text('You cannot use on-page editing', 403)
      const q = req.searchParams
      const ref = readRef(req, { kind: q.get('kind'), slug: q.get('slug'), id: q.get('id') })
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      if (!ref || !entry) return text('Unknown document', 400)
      if (!(await canEditDocument(req, ref, options)))
        return text('You cannot edit this document', 403)
      const locale = req.locale && req.locale !== 'all' ? req.locale : undefined
      const path = safePath(q.get('path')) ?? (await resolvePath(req, ref, entry, locale))
      if (!path) return text('This document has no page to open', 404)
      const mode = q.get('mode')
      await session.enable(isOnPageMode(mode) ? mode : 'edit', enableOptions(req, options))
      return redirectTo(req, path)
    },
  }

  const mode: Endpoint = {
    path: `${prefix}${ROUTES.mode}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      if (!req.user) return text('Sign in to the admin first', 401)
      if (!(await canUseOnPage(req, options))) return text('You cannot use on-page editing', 403)
      if (!(await canEditAnything(req))) return text('You cannot edit any document', 403)
      const q = req.searchParams
      const next = q.get('mode')
      await session.enable(isOnPageMode(next) ? next : 'edit', enableOptions(req, options))
      return redirectTo(req, q.get('path'))
    },
  }

  const exit: Endpoint = {
    path: `${prefix}${ROUTES.exit}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      const path = safePath(req.searchParams.get('path'))
      await session.disable(path ? { path: pathnameOf(path) } : undefined)
      return redirectTo(req, path)
    },
  }

  const previewLink: Endpoint = {
    path: `${prefix}${ROUTES.previewLink}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      if (!req.headers.get('content-type')?.includes('application/json'))
        throw new APIError('Expected a JSON body', 415)
      await addDataAndFileToRequest(req) // parses JSON, or throws a 400
      // Authenticate before parsing the ref, so anonymous callers can't probe
      // which slugs are enabled by the status code.
      if (!(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const body: Record<string, unknown> = req.data ?? {}
      const ref = readRef(req, body)
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      if (!ref || !entry) throw new APIError('Unknown document', 400)
      if (!(await canEditDocument(req, ref, options))) throw new Forbidden(req.t)
      const locale = knownLocale(req, body.locale)
      // The path is always derived on the server: a link opens this document's page and nothing else.
      const path = await resolvePath(req, ref, entry, locale)
      if (!path) throw new APIError('This document has no page', 404)
      const { token, payload } = await createPreviewToken(
        { ref: refKey(ref), path, ...(locale ? { locale } : {}) },
        secretOf(req, options),
        options.previewLinkTTL ?? DAY,
      )
      return json({
        url: `${apiURL(req, `${prefix}${ROUTES.preview}`)}?token=${encodeURIComponent(token)}`,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        id: payload.jti,
      })
    },
  }

  const preview: Endpoint = {
    path: `${prefix}${ROUTES.preview}`,
    method: 'get',
    handler: async (req) => {
      const invalid = () => text('This preview link is invalid or has expired.', 403)
      const secret = secretOf(req, options)
      const token = await verifyPreviewToken(req.searchParams.get('token') ?? '', secret)
      const parsed = token && parseRefKey(token.ref)
      const ref = parsed && withIdType(req, parsed)
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      if (!token || !ref || !entry) return invalid()
      // Still the document's page? (It may have been deleted, or its slug changed.)
      const current = await resolvePath(req, ref, entry, knownLocale(req, token.locale))
      if (!current || !samePath(current, token.path)) return invalid()
      if (
        options.validatePreviewLink &&
        !(await options.validatePreviewLink({
          req,
          ref,
          path: token.path,
          issuedAt: token.iat,
          id: token.jti,
        }))
      ) {
        return invalid()
      }
      await session.enableLink({
        secure: isSecure(req),
        path: pathnameOf(token.path),
        expiresAt: new Date(token.exp * 1000),
        seal: (draftSecret) => {
          const grant: PreviewGrant = {
            path: pathnameOf(token.path),
            ref: token.ref,
            exp: token.exp,
            draft: draftSecret,
            id: token.jti,
          }
          return seal(grant, secret, SEAL_PURPOSE.previewCookie)
        },
      })
      return redirectTo(req, token.path, 307)
    },
  }

  /**
   * Schedule a publish (or unpublish), as the admin's own scheduler does: a
   * `schedulePublish` job that publishes the document's latest draft then.
   */
  const schedule: Endpoint = {
    path: `${prefix}${ROUTES.schedule}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      if (!req.headers.get('content-type')?.includes('application/json'))
        throw new APIError('Expected a JSON body', 415)
      await addDataAndFileToRequest(req)
      if (!(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const body: Record<string, unknown> = req.data ?? {}
      const ref = readRef(req, body)
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      const cfg = ref && entityConfig(req, ref.kind, ref.slug)
      if (!ref || !entry || !cfg) throw new APIError('Unknown document', 400)
      if (!hasScheduledPublishEnabled(cfg))
        throw new APIError(
          'Scheduling is off for this document: set versions.drafts.schedulePublish',
          400,
        )
      if (!(await canPublishDocument(req, ref, options))) throw new Forbidden(req.t)
      const at = typeof body.at === 'string' ? new Date(body.at) : null
      if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
        throw new APIError('Choose a time in the future', 400)
      const type = body.type === 'unpublish' ? 'unpublish' : 'publish'
      const locale = knownLocale(req, body.locale)
      const user = req.user
      const job = await req.payload.jobs.queue({
        task: 'schedulePublish',
        input: {
          type,
          ...(ref.kind === 'global'
            ? { global: ref.slug }
            : { doc: { relationTo: ref.slug, value: ref.id } }),
          ...(locale ? { locale } : {}),
          ...(user ? { user: { relationTo: user.collection, value: user.id } } : {}),
        },
        waitUntil: at,
        req,
      })
      return json({ id: job.id, waitUntil: at.toISOString(), type })
    },
  }

  /** Which fields' `admin.condition` hides them for the document as the editor has it. */
  const conditions: Endpoint = {
    path: `${prefix}${ROUTES.conditions}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      if (!req.headers.get('content-type')?.includes('application/json'))
        throw new APIError('Expected a JSON body', 415)
      await addDataAndFileToRequest(req)
      if (!(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const body: Record<string, unknown> = req.data ?? {}
      const ref = readRef(req, body)
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      const cfg = ref && entityConfig(req, ref.kind, ref.slug)
      if (!ref || !entry || !cfg) throw new APIError('Unknown document', 400)
      if (!(await canEditDocument(req, ref, options))) throw new Forbidden(req.t)
      const data = body.data
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new APIError('Expected the document as `data`', 400)
      const hidden = hiddenPaths(cfg.fields, stegaCleanDeep(data as Record<string, unknown>), {
        user: req.user,
        blocks: req.payload.config.blocks,
      })
      return json({ hidden })
    },
  }

  /** Take, refresh or release Payload's document lock for the editor (see ./locks). */
  const lock: Endpoint = {
    path: `${prefix}${ROUTES.lock}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      if (!req.headers.get('content-type')?.includes('application/json'))
        throw new APIError('Expected a JSON body', 415)
      await addDataAndFileToRequest(req)
      if (!(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const body: Record<string, unknown> = req.data ?? {}
      const ref = readRef(req, body)
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      const cfg = ref && entityConfig(req, ref.kind, ref.slug)
      if (!ref || !entry || !cfg) throw new APIError('Unknown document', 400)
      if (!(await canEditDocument(req, ref, options))) throw new Forbidden(req.t)
      return json(await applyLock(req, ref, cfg, body.action === 'release' ? 'release' : 'take'))
    },
  }

  /** The document a JSON request is about, once the body is parsed (null: unknown). */
  const docOf = (req: PayloadRequest, body: Record<string, unknown>) => {
    const ref = readRef(req, body)
    return ref && ctx.entry(ref.kind, ref.slug) ? ref : null
  }
  const jsonBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
    if (!req.headers.get('content-type')?.includes('application/json'))
      throw new APIError('Expected a JSON body', 415)
    await addDataAndFileToRequest(req)
    return req.data ?? {}
  }
  const isEditorOf = async (req: PayloadRequest, ref: DocRef) =>
    !!req.user && (await canUseOnPage(req, options)) && (await canEditDocument(req, ref, options))
  const guestsAllowed = typeof options.comments === 'object' && !!options.comments.guests

  /** Comments on a document, newest first: for its editors. */
  const listComments: Endpoint = {
    path: `${prefix}${ROUTES.comments}`,
    method: 'get',
    handler: async (req) => {
      const q = req.searchParams
      const ref = readRef(req, { kind: q.get('kind'), slug: q.get('slug'), id: q.get('id') })
      if (!ref || !ctx.entry(ref.kind, ref.slug)) throw new APIError('Unknown document', 400)
      if (!(await isEditorOf(req, ref))) throw new Forbidden(req.t)
      const { docs } = await req.payload.find({
        collection: COMMENTS,
        where: commentsWhere(ref),
        sort: '-createdAt',
        limit: 100,
        depth: 1,
        overrideAccess: true,
        req,
      })
      return json({
        comments: docs.map((doc) => {
          const c = doc as Record<string, unknown>
          const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
          return {
            id: c.id,
            body: str(c.body) ?? '',
            path: str(c.path),
            quote: str(c.quote),
            kind: c.kind === 'review' ? 'review' : 'comment',
            resolved: c.resolved === true,
            createdAt: str(c.createdAt) ?? '',
            author: authorName(req, c.author) ?? str(c.guestName),
            guest: !c.author,
          }
        }),
      })
    },
  }

  /** Add a comment: an editor of the document, or (with `comments.guests`) a share-link viewer of it. */
  const addComment: Endpoint = {
    path: `${prefix}${ROUTES.comments}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      const body = await jsonBody(req)
      const text = boundedText(body.body, LIMITS.body)
      if (!text) throw new APIError(`Write a comment of at most ${LIMITS.body} characters`, 400)
      const quote = body.quote === undefined ? null : boundedText(body.quote, LIMITS.quote)
      const named = docOf(req, body)
      let ref: DocRef
      const data: Record<string, unknown> = { body: text, ...(quote ? { quote } : {}) }
      if (named && (await isEditorOf(req, named))) {
        ref = named
        const path = typeof body.path === 'string' && body.path.length <= 200 ? body.path : null
        Object.assign(data, { author: req.user!.id, ...(path ? { path } : {}) })
      } else {
        // A share-link viewer: the document is the one their sealed grant covers, never one they name.
        const grant = guestsAllowed ? await guestGrant(req, secretOf(req, options)) : null
        const parsed = grant && parseRefKey(grant.ref)
        if (!grant || !parsed || (named && refKey(named) !== grant.ref)) throw new Forbidden(req.t)
        ref = withIdType(req, parsed)
        const name = boundedText(body.name, LIMITS.name)
        if (!name) throw new APIError(`Give your name (at most ${LIMITS.name} characters)`, 400)
        const link = grant.id ?? grant.ref
        const { totalDocs } = await req.payload.count({
          collection: COMMENTS,
          where: {
            and: [
              { link: { equals: link } },
              { createdAt: { greater_than: new Date(Date.now() - 3600_000).toISOString() } },
            ],
          },
          overrideAccess: true,
          req,
        })
        if (totalDocs >= LIMITS.perLinkPerHour)
          throw new APIError('Too many comments from this link; try again later', 429)
        Object.assign(data, { guestName: name, link })
      }
      Object.assign(data, commentTarget(ref))
      const created = await req.payload.create({
        collection: COMMENTS,
        data,
        overrideAccess: true,
        req,
      })
      return json({ id: created.id })
    },
  }

  /** May this share-link viewer comment? (The toolbar asks before offering it.) */
  const guestStatus: Endpoint = {
    path: `${prefix}${ROUTES.comments}/guest`,
    method: 'get',
    handler: async (req) =>
      json({
        enabled: guestsAllowed && !!(await guestGrant(req, secretOf(req, options))),
      }),
  }

  /** Mark a comment resolved (or not): editors of its document. */
  const resolveComment: Endpoint = {
    path: `${prefix}${ROUTES.comments}/resolve`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      const body = await jsonBody(req)
      const id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null
      if (id === null) throw new APIError('Which comment?', 400)
      const comment = await req.payload
        .findByID({ collection: COMMENTS, id, depth: 0, overrideAccess: true, req })
        .catch(() => null)
      if (!comment) throw new NotFound(req.t)
      const target = comment.doc as { relationTo?: string; value?: unknown } | undefined
      const ref = target?.relationTo
        ? readRef(req, { kind: 'collection', slug: target.relationTo, id: String(target.value) })
        : typeof comment.global === 'string'
          ? readRef(req, { kind: 'global', slug: comment.global })
          : null
      if (!ref || !(await isEditorOf(req, ref))) throw new Forbidden(req.t)
      await req.payload.update({
        collection: COMMENTS,
        id,
        data: { resolved: body.resolved !== false },
        overrideAccess: true,
        req,
      })
      return json({ ok: true })
    },
  }

  /**
   * Ask for a review: a fresh share link, the site's `onReviewRequest` hook
   * (email, Slack…), and the request kept as a comment.
   */
  const review: Endpoint = {
    path: `${prefix}${ROUTES.review}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      const body = await jsonBody(req)
      const ref = docOf(req, body)
      const entry = ref && ctx.entry(ref.kind, ref.slug)
      if (!ref || !entry) throw new APIError('Unknown document', 400)
      if (!(await isEditorOf(req, ref))) throw new Forbidden(req.t)
      const note =
        body.note === undefined || body.note === '' ? '' : boundedText(body.note, LIMITS.body)
      if (note === null) throw new APIError(`Keep the note under ${LIMITS.body} characters`, 400)
      const locale = knownLocale(req, body.locale)
      const path = await resolvePath(req, ref, entry, locale)
      if (!path) throw new APIError('This document has no page', 404)
      const { token, payload } = await createPreviewToken(
        { ref: refKey(ref), path, ...(locale ? { locale } : {}) },
        secretOf(req, options),
        options.previewLinkTTL ?? DAY,
      )
      const url = `${apiURL(req, `${prefix}${ROUTES.preview}`)}?token=${encodeURIComponent(token)}`
      const expiresAt = new Date(payload.exp * 1000).toISOString()
      await req.payload.create({
        collection: COMMENTS,
        data: {
          ...commentTarget(ref),
          kind: 'review',
          body: note || 'Review requested',
          author: req.user!.id,
        },
        overrideAccess: true,
        req,
      })
      await options.onReviewRequest?.({ req, ref, note, url, expiresAt })
      return json({ ok: true, url, expiresAt })
    },
  }

  /**
   * A new page from the page: a copy of a document (`action: 'duplicate'`), or
   * a blank one titled `title`. Created as a draft with a unique slug; Payload
   * checks the user's create access. Answers with the new page's id and path.
   */
  const pages: Endpoint = {
    path: `${prefix}${ROUTES.pages}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      const body = await jsonBody(req)
      if (!req.user || !(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const slug = typeof body.slug === 'string' ? body.slug : ''
      const entry = ctx.entry('collection', slug)
      const cfg = req.payload.collections[slug]?.config
      if (!entry || entry.kind !== 'collection' || !cfg)
        throw new APIError('Unknown collection', 400)
      const titleField = cfg.admin?.useAsTitle
      const title = body.title === undefined ? null : boundedText(body.title, 200)
      if (body.title !== undefined && !title) throw new APIError('Give the page a title', 400)
      const withAddress = async (t: string) => ({
        ...(titleField && titleField !== 'id' ? { [titleField]: t } : {}),
        ...(hasSlugField(cfg) ? { slug: await uniqueSlug(req, slug, slugify(t)) } : {}),
      })
      let created: { id: string | number }
      if (body.action === 'duplicate') {
        const ref = readRef(req, { kind: 'collection', slug, id: body.id })
        if (!ref || ref.kind !== 'collection') throw new APIError('Which page?', 400)
        const source = await req.payload
          .findByID({
            collection: slug,
            id: ref.id,
            draft: true,
            depth: 0,
            req,
            overrideAccess: false,
          })
          .catch(() => null)
        if (!source) throw new NotFound(req.t)
        const named: unknown = titleField
          ? (source as Record<string, unknown>)[titleField]
          : undefined
        const copyTitle =
          title ?? `${typeof named === 'string' ? stegaClean(named) : 'Page'} (copy)`
        created = await req.payload.duplicate({
          collection: slug,
          id: ref.id,
          data: await withAddress(copyTitle),
          draft: true,
          req,
          overrideAccess: false,
        })
      } else {
        if (!title) throw new APIError('Give the page a title', 400)
        created = await req.payload.create({
          collection: slug,
          data: { ...(await withAddress(title)), _status: 'draft' },
          draft: true,
          req,
          overrideAccess: false,
        })
      }
      const path = await resolvePath(req, { kind: 'collection', slug, id: created.id }, entry)
      return json({ id: created.id, path })
    },
  }

  /** Saved sections, for editors: the ones whose block type `blocks` allows (all without it). */
  const listPatterns: Endpoint = {
    path: `${prefix}${ROUTES.patterns}`,
    method: 'get',
    handler: async (req) => {
      if (!req.user || !(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const allowed = req.searchParams.get('blocks')?.split(',').filter(Boolean)
      const { docs } = await req.payload.find({
        collection: PATTERNS,
        ...(allowed?.length ? { where: { blockType: { in: allowed } } } : {}),
        sort: 'name',
        limit: 200,
        depth: 0,
        overrideAccess: true,
        req,
      })
      return json({
        patterns: docs.map((doc) => {
          const d = doc as Record<string, unknown>
          return {
            id: d.id,
            name: typeof d.name === 'string' ? d.name : '',
            blockType: typeof d.blockType === 'string' ? d.blockType : '',
            data: d.data,
          }
        }),
      })
    },
  }

  /** Save a section's content under a name. */
  const savePattern: Endpoint = {
    path: `${prefix}${ROUTES.patterns}`,
    method: 'post',
    handler: async (req) => {
      const refused = rejectCrossSite(req)
      if (refused) return refused
      const body = await jsonBody(req)
      if (!req.user || !(await canUseOnPage(req, options))) throw new Forbidden(req.t)
      const name = boundedText(body.name, 120)
      if (!name) throw new APIError('Name the section', 400)
      const block = body.block
      if (
        !block ||
        typeof block !== 'object' ||
        Array.isArray(block) ||
        typeof (block as { blockType?: unknown }).blockType !== 'string'
      )
        throw new APIError('Expected a block with a blockType', 400)
      const data = stegaCleanDeep(block as Record<string, unknown>)
      if (JSON.stringify(data).length > MAX_PATTERN_BYTES)
        throw new APIError('This section is too large to save', 413)
      const created = await req.payload.create({
        collection: PATTERNS,
        data: { name, blockType: data.blockType, data },
        overrideAccess: true,
        req,
      })
      return json({ id: created.id })
    },
  }

  const commentEndpoints = options.comments
    ? [listComments, addComment, guestStatus, resolveComment, review]
    : []

  return [
    schema,
    enter,
    mode,
    exit,
    previewLink,
    preview,
    schedule,
    conditions,
    lock,
    pages,
    ...(options.patterns ? [listPatterns, savePattern] : []),
    ...commentEndpoints,
  ]
}
