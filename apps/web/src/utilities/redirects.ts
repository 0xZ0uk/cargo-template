/**
 * Pure helpers for applying the SEO analyzer's `seo-redirects` records on the frontend.
 *
 * The plugin stores `from` as a same-site path (`normalizeFromPath`) and `to` as a relative
 * path or an absolute http(s) URL (`validateRedirectTarget`). Both checks are reused from the
 * plugin's `shared` entry, so a record the admin accepts and one the site applies follow the
 * same policy. Case and trailing slashes are kept as typed, so matching normalises both sides.
 */
import { normalizeFromPath, validateRedirectTarget } from '@cargo/payload-seo-analyzer/shared'

export type RedirectStatus = 301 | 302

export type RedirectRecord = {
  from?: string | null
  to?: string | null
  type?: string | null
}

export type RedirectEntry = {
  status: RedirectStatus
  to: string
}

/** Lookup table keyed by `normalizeRedirectPath(from)`. */
export type RedirectIndex = Map<string, RedirectEntry>

export type ResolvedRedirect = {
  href: string
  statusCode: RedirectStatus
}

/**
 * Key used to compare a request path with a stored `from`: percent-decoded, lower-cased,
 * with a leading slash and no trailing slash (the root stays `/`). Returns null for values
 * that can never be a same-site path.
 */
export const normalizeRedirectPath = (raw: unknown): string | null => {
  let path = normalizeFromPath(raw)
  if (!path) return null

  try {
    // `decodeURI` leaves reserved characters (`%2F`, `%3F`, …) encoded, which keeps `/a%2Fb`
    // distinct from `/a/b`.
    path = decodeURI(path)
  } catch {
    // Malformed escape sequence: compare the raw text.
  }

  path = path.toLowerCase().replace(/\/+$/, '')

  return path === '' ? '/' : path
}

/**
 * Applies the plugin's destination policy: a single-leading-slash relative path or an
 * absolute http(s) URL. Protocol-relative URLs, backslashes, control characters and any
 * other scheme (`javascript:`, `data:`, …) are refused.
 */
export const safeRedirectTarget = (raw: unknown): string | null => {
  const result = validateRedirectTarget(raw)

  return result.valid ? (result.normalized ?? null) : null
}

/**
 * Builds the lookup table from the stored records. Records with an unusable `from` or `to`
 * are skipped. When two records share a key the first one wins, so callers should pass them
 * most-recent-first.
 */
export const buildRedirectIndex = (records: readonly RedirectRecord[]): RedirectIndex => {
  const index: RedirectIndex = new Map()

  for (const record of records) {
    const key = normalizeRedirectPath(record.from)
    const to = safeRedirectTarget(record.to)

    if (!key || !to || index.has(key)) continue

    index.set(key, { status: record.type === '302' ? 302 : 301, to })
  }

  return index
}

/**
 * Appends the request's query string to the target. Parameters the target already sets win,
 * so `?utm_source=x` survives `/old → /new?ref=a` as `/new?ref=a&utm_source=x`.
 */
const withSearch = (target: string, search: string) => {
  if (!search || search === '?') return target

  const url = new URL(target, 'http://redirect.invalid')
  const incoming = new URLSearchParams(search)

  for (const [key, value] of incoming) {
    if (!url.searchParams.has(key)) url.searchParams.append(key, value)
  }

  const relative = `${url.pathname}${url.search}${url.hash}`

  return target.startsWith('/') ? relative : `${url.origin}${relative}`
}

/**
 * Finds the redirect for a request path. Returns null when none matches, and when the target
 * is the request path itself (which would loop forever).
 *
 * @param pathname - the request's URL pathname, as sent (percent-encoded)
 * @param search - the request's raw query string, with or without the leading `?`
 */
export const matchRedirect = (
  index: RedirectIndex,
  pathname: string,
  search = '',
): ResolvedRedirect | null => {
  const key = normalizeRedirectPath(pathname)
  const entry = key ? index.get(key) : undefined

  if (!key || !entry) return null

  if (entry.to.startsWith('/') && normalizeRedirectPath(entry.to.split(/[?#]/)[0]) === key) {
    return null
  }

  return { href: withSearch(entry.to, search), statusCode: entry.status }
}
