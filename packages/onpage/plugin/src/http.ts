/** Request helpers shared by the endpoints. */
import { safePath, type DocRef } from '@cargo/onpage-core'
import type { PayloadRequest, SanitizedCollectionConfig, SanitizedGlobalConfig } from 'payload'
import { formatAdminURL, stripTrailingSlash } from 'payload/shared'

/** The site origin: `serverURL` when configured, else the request's own origin. */
export const originOf = (req: PayloadRequest): string => {
  const configured = req.payload.config.serverURL
  return configured ? stripTrailingSlash(configured) : req.origin
}

export const isSecure = (req: PayloadRequest): boolean => originOf(req).startsWith('https:')

/**
 * Absolute URL of one of our API routes (e.g. `/onpage/preview`), built the way
 * Payload builds its own: honours `routes.api`, Next's basePath and trailing slashes.
 */
export const apiURL = (req: PayloadRequest, path: `/${string}`): string =>
  formatAdminURL({ apiRoute: req.payload.config.routes.api, path, serverURL: originOf(req) })

/** Plain-text reply for the form-POST / new-tab endpoints, where JSON would just be shown raw. */
export const text = (body: string, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } })

/** Redirect to a same-origin path (anything unsafe becomes "/"). 303 turns a POST into a GET. */
export const redirectTo = (req: PayloadRequest, path: unknown, status: 303 | 307 = 303): Response =>
  Response.redirect(new URL(safePath(path) ?? '/', originOf(req)), status)

/**
 * CSRF guard for state-changing endpoints: a POST from this site (Origin, or
 * Sec-Fetch-Site when Origin is absent). `none` is refused: no legitimate
 * browser flow POSTs to these endpoints without site metadata. Returns an
 * error response or null.
 */
export function rejectCrossSite(req: PayloadRequest): Response | null {
  if (req.method?.toUpperCase() !== 'POST') return text('Method not allowed', 405)
  const origin = req.headers.get('origin')
  if (origin) return origin === originOf(req) ? null : text('Cross-site request refused', 403)
  const site = req.headers.get('sec-fetch-site')
  return site === 'same-origin' ? null : text('Cross-site request refused', 403)
}

/** A collection's or global's sanitized config. */
export function entityConfig(
  req: PayloadRequest,
  kind: 'collection',
  slug: string,
): SanitizedCollectionConfig | undefined
export function entityConfig(
  req: PayloadRequest,
  kind: 'global',
  slug: string,
): SanitizedGlobalConfig | undefined
export function entityConfig(
  req: PayloadRequest,
  kind: DocRef['kind'],
  slug: string,
): SanitizedCollectionConfig | SanitizedGlobalConfig | undefined
export function entityConfig(req: PayloadRequest, kind: DocRef['kind'], slug: string) {
  return kind === 'global'
    ? req.payload.globals.config.find((g) => g.slug === slug)
    : req.payload.collections[slug]?.config
}

/** A document ref from `kind`, `slug`, `id` query/body values. */
export function readRef(
  req: PayloadRequest,
  values: { kind?: unknown; slug?: unknown; id?: unknown },
): DocRef | null {
  const slug = typeof values.slug === 'string' ? values.slug : ''
  if (!slug) return null
  if (values.kind === 'global') return { kind: 'global', slug }
  const id = values.id
  if (typeof id === 'number') return { kind: 'collection', slug, id }
  if (typeof id !== 'string' || !id) return null
  return withIdType(req, { kind: 'collection', slug, id })
}

/**
 * The ref with its id typed the way the collection stores it (number or text),
 * so a text id that looks numeric ("007") is never coerced.
 */
export function withIdType(req: PayloadRequest, ref: DocRef): DocRef {
  if (ref.kind === 'global') return ref
  const type = req.payload.collections[ref.slug]?.customIDType ?? req.payload.db.defaultIDType
  const raw = String(ref.id)
  const n = Number(raw)
  return { ...ref, id: type === 'number' && Number.isSafeInteger(n) && String(n) === raw ? n : raw }
}
