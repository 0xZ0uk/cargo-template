/**
 * Classifies one outbound link check into exactly one bucket. Pure (no I/O, no DNS), so
 * the endpoint (stats) and the admin UI (pills, filters) share it. Checks are stored as
 * `{ status, ok, error }` and classified when the response is built, so results saved
 * before a bucket existed are classified correctly too.
 *
 * Buckets, in the order they are tested:
 * - `ok`          a 2xx answer.
 * - `blocked`     the SSRF guard refused the URL (private/internal address). Never requested.
 * - `timeout`     no answer in time.
 * - `error`       the request failed before an HTTP answer: DNS (the name doesn't exist or
 *                 doesn't resolve), TLS, connection reset, redirect loop or a bad redirect.
 * - `unverified`  the server answered, but with a code that says "I won't tell you" rather
 *                 than "this page is gone" (see `UNVERIFIED_STATUSES`). Not a broken link.
 * - `broken`      any other HTTP answer that isn't 2xx (404, 410, 5xx, …).
 */

/** One bucket per link: the stats always add up to `total`. */
export type LinkState = 'ok' | 'broken' | 'timeout' | 'error' | 'blocked' | 'unverified'

/** Every bucket, worst first (the order the External tab sorts and lists them in). */
export const LINK_STATES: readonly LinkState[] = ['broken', 'timeout', 'error', 'blocked', 'unverified', 'ok']

/**
 * HTTP statuses that mean "the server refused to tell us", not "the link is dead". The
 * checker is a bot with no cookies and a shared IP, so these are mostly bot walls and rate
 * limits that a visitor in a browser would not hit:
 * - 401 Unauthorized: the page exists but needs a login.
 * - 403 Forbidden: after the GET retry, almost always a WAF / bot wall (Cloudflare, Akamai).
 * - 429 Too Many Requests: rate limited.
 * - 451 Unavailable For Legal Reasons: blocked for the checker's region, may work elsewhere.
 * - 999: LinkedIn's (and Yahoo's) "request denied" for bots; not a standard code.
 *
 * Not in the set on purpose: 404 / 410 (gone), 5xx (broken or down, which an editor should
 * look at) and 405 / 406 (a GET retry already settles those).
 */
export const UNVERIFIED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429, 451, 999])

export interface LinkStateInput {
  status: number
  ok: boolean
  error?: string
}

/** The bucket a check result belongs to. */
export function classifyLink(r: LinkStateInput): LinkState {
  if (r.ok) return 'ok'
  if (r.error === 'blocked-private-ip') return 'blocked'
  if (r.error === 'timeout') return 'timeout'
  if (r.error) return 'error'
  if (UNVERIFIED_STATUSES.has(r.status)) return 'unverified'
  return 'broken'
}

export type LinkStats = { total: number } & Record<LinkState, number>

/** Counts by bucket. `ok + broken + timeout + error + blocked + unverified === total`. */
export function countLinkStates(results: ReadonlyArray<LinkStateInput>): LinkStats {
  const stats: LinkStats = { total: results.length, ok: 0, broken: 0, timeout: 0, error: 0, blocked: 0, unverified: 0 }
  for (const r of results) stats[classifyLink(r)]++
  return stats
}
