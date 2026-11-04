/**
 * Retention purge endpoints.
 *
 *   GET  /retention  → what the configured windows would remove (admin, read-only)
 *   POST /retention  → run the purge now (admin)
 *
 * Registered only when there is something to purge (a time-series feature is on, or
 * `retentionDays` names a dataset), so a host without either has no delete endpoint at
 * all — the route does not exist rather than existing and refusing.
 */
import type { PayloadHandler } from 'payload'
import { isSeoAdminRequest } from '../helpers/isAdmin.js'
import { describeRetention, purgeRetention, type RetentionConfig } from '../retention.js'
import type { RetentionRunOptions } from '../retentionScheduler.js'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** GET — dry run. Reports the cutoffs without touching a row. */
export function createRetentionStatusHandler(
  retention: RetentionConfig | undefined,
  options: RetentionRunOptions = {},
): PayloadHandler {
  return async (req) => {
    // SEO admin, not merely a panel user: this describes what a destructive
    // operation would remove.
    if (!isSeoAdminRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    return Response.json({ targets: describeRetention(retention, new Date(), options) }, { headers: NO_STORE })
  }
}

/** POST — run the purge now. Same windows as the daily job; no body is read. */
export function createRetentionPurgeHandler(
  retention: RetentionConfig | undefined,
  options: RetentionRunOptions = {},
): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoAdminRequest(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })

      // The windows come from the plugin config, never from the request: a
      // caller must not be able to pass `days: 0` and empty the tables.
      const result = await purgeRetention(req.payload, retention, {
        ...options,
        store: options.resolveStore?.(req.payload),
      })
      if (!result.ran) {
        return Response.json(
          { error: 'No retention window configured' },
          { status: 409, headers: NO_STORE },
        )
      }
      return Response.json(result, { headers: NO_STORE })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] retention purge error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
