/**
 * Retention purge scheduler.
 *
 * Trims the four append-only time-series datasets once a day so a long-lived install
 * does not accumulate them forever. Started from plugin onInit whenever a time-series
 * feature is on (retention is mandatory for them) or `retentionDays` names a dataset.
 *
 * Same shape as rankTracker / alertsScheduler: idempotent start, one interval,
 * cleared on SIGTERM / SIGINT.
 */
import type { Payload } from 'payload'
import { purgeRetention, resolveRetention, type RetentionConfig, type RetentionOptions } from './retention.js'
import type { SeoDataStoreResolver } from './store/index.js'

/** What the purge needs besides `retentionDays`: enabled datasets, row caps and the store. */
export interface RetentionRunOptions extends RetentionOptions {
  resolveStore?: SeoDataStoreResolver
}

const PURGE_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
// Later than the other two jobs: a purge is never urgent, and running it after
// boot has settled keeps it off the critical path of a cold start.
const STARTUP_DELAY = 5 * 60 * 1000 // 5 minutes after init

let intervalId: ReturnType<typeof setInterval> | null = null
let listenersAttached = false

/** One retention purge, logged (also run by the `seoRetentionPurge` job). Never throws. */
export async function runRetentionPurge(
  payload: Payload,
  retention: RetentionConfig | undefined,
  options: RetentionRunOptions = {},
): Promise<void> {
  try {
    const result = await purgeRetention(payload, retention, {
      ...options,
      store: options.resolveStore?.(payload),
    })
    if (!result.ran) return
    const failed = result.results.filter((r) => r.error)
    for (const entry of failed) {
      payload.logger.warn(`[seo] retention: ${entry.collection} failed — ${entry.error}`)
    }
    if (result.totalDeleted > 0) {
      const detail = result.results
        .filter((r) => r.deleted > 0)
        .map((r) => `${r.collection}=${r.deleted}`)
        .join(' ')
      payload.logger.info(`[seo] retention: removed ${result.totalDeleted} row(s) (${detail})`)
    }
  } catch (error) {
    payload.logger.error(
      `[seo] retention scheduler error: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

export function startRetentionPurge(
  payload: Payload,
  retention: RetentionConfig | undefined,
  options: RetentionRunOptions = {},
): void {
  // Idempotent — avoid leaking a previous interval / doubling the job on re-init.
  stopRetentionPurge()

  const targets = resolveRetention(retention, options)
  if (targets.length === 0) return

  setTimeout(() => {
    void runRetentionPurge(payload, retention, options)
  }, STARTUP_DELAY)

  intervalId = setInterval(() => {
    void runRetentionPurge(payload, retention, options)
  }, PURGE_INTERVAL)

  if (!listenersAttached) {
    const cleanup = () => stopRetentionPurge()
    process.on('SIGTERM', cleanup)
    process.on('SIGINT', cleanup)
    listenersAttached = true
  }

  payload.logger.info(
    `[seo] retention: scheduled every 24h — ${targets
      .map((t) => `${t.slug}:${t.days}d`)
      .join(', ')}`,
  )
}

export function stopRetentionPurge(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}
