/**
 * SEO Logs endpoint handler.
 * - GET: Returns 404 logs for the admin dashboard (with stats)
 * - POST: Logs a new 404 hit (requires the secret header, or an SEO-admin session)
 * - DELETE: Clear/ignore logs
 *
 * Rows live in the plugin's data store (`dataStore` option), never necessarily in the
 * main database. Hosts that render their own 404s record them in-process with
 * `recordSeoNotFound(payload, hit)` instead of POSTing here.
 *
 * Growth: a new URL is created only while the log holds fewer than `SEO_LOGS_MAX_ROWS`
 * (default 5,000) rows; a known URL only gets its counter bumped. The retention job trims
 * the rest (90 days since the last hit by default).
 */

import type { Payload, PayloadHandler } from 'payload'
import { safeEqual } from '../helpers/tokenCrypto.js'
import { seoLogsMaxRows, type RetentionMaxRows } from '../retention.js'
import { payloadStoreResolver, seoStoreRuntime, type NotFoundHit, type NotFoundRecordResult, type NotFoundType, type SeoDataStoreResolver } from '../store/index.js'
import { createBucketRateLimiter, rateLimitKey, type SeoRateLimit } from '../rateLimiter.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import { isProbePath } from '../helpers/probePaths.js'

import { isSeoAdminRequest as isAdmin, isSeoPanelUser } from '../helpers/isAdmin.js'

const VALID_LOG_TYPES = ['404', 'redirect', 'error']

/**
 * Length cap for the free-text fields a 404 hit carries.
 *
 * `url` was already refused past 500 characters, but `referrer` and `userAgent`
 * are just as visitor-controlled — they are the raw `Referer` / `User-Agent`
 * headers relayed by the host middleware — and went to the database untouched.
 * A visitor hitting a missing page with a multi-kilobyte Referer therefore grew
 * the seo-logs table in BYTES, not in rows (the row is upserted, so the value is
 * overwritten on every hit), and the admin 404 panel reads those fields back.
 *
 * Truncate rather than reject: the caller is a visitor's browser, not an
 * integrator we can hand a useful 400 to, and refusing would drop the 404 report
 * itself — the very data the panel exists for. 500 characters amputates no real
 * user agent (the longest legitimate ones sit well under 256).
 */
export const MAX_LOG_TEXT_LENGTH = 500

/** Trim, then cap — used for the two visitor-supplied text fields. */
function cappedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_LOG_TEXT_LENGTH) : undefined
}

/**
 * Validate and normalise one hit: lower case, no query string or hash, text fields capped.
 * Returns an error message for a hit that must not be stored.
 */
export function prepareNotFoundHit(raw: {
  url?: unknown
  type?: unknown
  referrer?: unknown
  userAgent?: unknown
}): NotFoundHit | { error: string } {
  const url = typeof raw.url === 'string' ? raw.url.trim() : undefined
  const type = typeof raw.type === 'string' ? raw.type.trim() : '404'
  if (!url) return { error: 'Missing url' }
  if (url.length > MAX_LOG_TEXT_LENGTH) return { error: 'URL too long (max 500 chars)' }
  if (!VALID_LOG_TYPES.includes(type)) {
    return { error: `Invalid type. Must be one of: ${VALID_LOG_TYPES.join(', ')}` }
  }
  return {
    url: url.toLowerCase().split('?')[0]!.split('#')[0]!,
    type: type as NotFoundType,
    referrer: cappedText(raw.referrer),
    userAgent: cappedText(raw.userAgent),
  }
}

/**
 * Record a 404 from the host's own frontend, in-process (no HTTP round trip, no secret).
 * A no-op returning `null` when the plugin's `seoLogs` feature is off. Never throws: a
 * failed log must not turn a 404 page into a 500.
 *
 * @example
 * await recordSeoNotFound(payload, { url: '/missing', referrer: request.headers.get('referer') })
 */
export async function recordSeoNotFound(
  payload: Payload,
  raw: { url: string; type?: NotFoundType; referrer?: string | null; userAgent?: string | null },
): Promise<NotFoundRecordResult | null> {
  const runtime = seoStoreRuntime(payload)
  if (!runtime?.enabled.includes('seo-logs')) return null
  const hit = prepareNotFoundHit(raw)
  if ('error' in hit) return null
  // Scanner probes (`/wp-login.php`, `/.env`) would fill the row cap with noise.
  if (isProbePath(hit.url, runtime.notFoundProbeFilter)) return null
  try {
    const result = await runtime.resolveStore(payload).notFound.record(hit, seoLogsMaxRows(runtime.maxRows))
    if (result === 'capped') warnCapped(payload, seoLogsMaxRows(runtime.maxRows))
    return result
  } catch (error) {
    payload.logger.error(`[seo] recordSeoNotFound failed: ${error instanceof Error ? error.message : 'unknown'}`)
    return null
  }
}

let cappedWarned = false
function warnCapped(payload: Payload, max: number) {
  if (cappedWarned) return
  cappedWarned = true
  payload.logger.warn(
    `[seo] seo-logs reached the ${max}-row cap — new 404 paths are no longer recorded. ` +
      'Clear the panel or raise SEO_LOGS_MAX_ROWS.',
  )
}

export function createSeoLogsHandler(
  seoLogsSecret?: string,
  rateLimit?: SeoRateLimit,
  resolveStore: SeoDataStoreResolver = payloadStoreResolver,
  maxRows?: RetentionMaxRows,
): PayloadHandler {
  // Rate limiter for POST: 30 requests per 60 seconds per caller (user, else IP)
  const postLimiter = createBucketRateLimiter('seo-logs', rateLimit)

  return async (req) => {
    const method = req.method?.toUpperCase()

    // POST: Log a hit (requires the secret header, or an SEO-admin session)
    if (method === 'POST') {
      try {
        // Rate limit POST requests. The bucket is keyed by the authenticated user when
        // there is one: keyed by IP alone, a caller varying X-Forwarded-For (which the
        // client controls) got a fresh bucket on every request and never hit the limit.
        if (!(await postLimiter.check(rateLimitKey(req)))) {
          return Response.json(
            { error: 'Too Many Requests. Please try again later.' },
            { status: 429 },
          )
        }

        // Auth check: secret header OR SEO-admin session
        if (seoLogsSecret) {
          const headerSecret = req.headers.get('x-seo-secret')
          if (!headerSecret) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }
          // Timing-safe comparison to prevent timing attacks. `safeEqual` compares
          // BYTE lengths, not code-unit lengths: a non-ASCII secret made the previous
          // check pass the length test and then throw inside timingSafeEqual.
          if (!safeEqual(headerSecret, seoLogsSecret)) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }
        } else {
          // No secret configured — require an SEO ADMIN, not merely a panel session.
          // This POST writes `seo-logs`, whose collection ACL is `create: isSeoAdminRequest`,
          // and the 404 report it feeds is what admins turn into 301s. A panel session alone
          // let every editor/author/viewer write rows the collection refuses them, and
          // contradicted the option's own contract ("POST requires authenticated admin user").
          // Hosts that want anonymous 404 middleware to log must set `seoLogsSecret`.
          if (!isAdmin(req)) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }
        }

        const body = await parseJsonBody(req)
        const hit = prepareNotFoundHit(body)
        if ('error' in hit) return Response.json({ error: hit.error }, { status: 400 })
        // Same filter as `recordSeoNotFound`: a host's 404 middleware shouldn't log scanner probes.
        if (isProbePath(hit.url, seoStoreRuntime(req.payload)?.notFoundProbeFilter)) {
          return Response.json({ success: true, action: 'ignored' })
        }

        const max = seoLogsMaxRows(maxRows)
        const action = await resolveStore(req.payload).notFound.record(hit, max)
        if (action === 'capped') {
          warnCapped(req.payload, max)
          return Response.json({ success: false, action })
        }
        return Response.json({ success: true, action })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to log'
        req.payload.logger.error(`[seo] seo-logs POST error: ${message}`)
        return Response.json({ error: message }, { status: 500 })
      }
    }

    // GET & DELETE: Require auth
    if (!isSeoPanelUser(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // DELETE: Clear or ignore logs (admin only)
    if (method === 'DELETE') {
      if (!isAdmin(req)) {
        return Response.json({ error: 'Admin access required' }, { status: 403 })
      }
      try {
        const urlObj = new URL(req.url as string)
        const id = urlObj.searchParams.get('id')
        const action = urlObj.searchParams.get('action') || 'delete'

        const store = resolveStore(req.payload).notFound
        if (id) {
          if (action === 'ignore') await store.ignore(id)
          else await store.remove(id)
          return Response.json({ success: true })
        }

        // Clear all non-ignored logs in a single bulk delete operation
        const deletedCount = await store.clear()
        return Response.json({ success: true, deleted: deletedCount })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete'
        req.payload.logger.error(`[seo] seo-logs DELETE error: ${message}`)
        return Response.json({ error: message }, { status: 500 })
      }
    }

    // GET: Return all 404 logs sorted by count (most frequent first)
    try {
      const urlObj = new URL(req.url as string)
      const showIgnored = urlObj.searchParams.get('ignored') === '1'

      const logs = await resolveStore(req.payload).notFound.list({ includeIgnored: showIgnored, limit: 500 })

      const stats = {
        total: logs.length,
        totalHits: logs.reduce((s, l) => s + (l.count || 0), 0),
        unique404: logs.filter((l) => l.type === '404').length,
      }

      return Response.json({ logs, stats })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] seo-logs GET error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
