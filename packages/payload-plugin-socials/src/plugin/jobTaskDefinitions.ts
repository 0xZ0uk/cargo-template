import type { Payload, PayloadRequest } from 'payload'

import { JobCancelledError } from 'payload'

import type { NormalizedPluginOptions, PlatformId, SocialSourceContext } from '../types/index.js'

import {
  PLATFORM_IDS,
  SOCIAL_CONNECTION_REFRESH_TASK_SLUG,
  SOCIAL_INSIGHTS_REFRESH_TASK_SLUG,
  SOCIAL_POST_PUBLISH_TASK_SLUG,
  SOCIAL_POST_RETRY_TASK_SLUG,
  SOCIAL_POST_SWEEP_TASK_SLUG,
  SOCIAL_POSTS_SLUG,
} from '../constants.js'
import { getPlatformAdapter } from '../server/platforms/registry.js'
import {
  awaitsReconciliation,
  claimForPublish,
  decideRetry,
  loadPost,
  publishClaimed,
  reconcilePublication,
  recordFailure,
  refFromPost,
  requeueForRetry,
} from '../server/services/publicationLedger.js'
import { resolveSourceContext } from '../server/sources/registry.js'
import { createPluginLogger, redactSecretString } from '../server/utilities/logger.js'

/**
 * Payload `TaskConfig` factories.
 *
 * The plugin owns handler bodies while the host controls cadence through
 * Payload autoRun, external cron, or a worker loop.
 *
 * Handler discipline:
 *   - Handlers receive only `{ input, req }`. No closure over options —
 *     options are fetched fresh from the plugin's `getPluginOptions()`
 *     registry every invocation. This makes the handlers safe to register
 *     once and survive hot reloads.
 *   - Failures are THROWN. Payload 4 reads only `output` from a handler's
 *     result and logs anything returned as succeeded; only a thrown error
 *     marks the job failed. Which error decides whether Payload retries:
 *       - a plain `Error` for transient failures that are safe to re-run
 *         (Payload applies the task's `retries`, with `SOCIALS_RETRY_BACKOFF`);
 *         for a publish, only when `isAutoRetrySafe` says so;
 *       - `SocialsTaskFailure` for failures the `social-posts` row already
 *         records and that must not be re-run blindly (unknown publish
 *         outcome, terminal states, non-retryable provider rejections).
 *     The README's "Job failures and retries" section has the matrix.
 *   - Side effects on `social-posts` rows use `overrideAccess: true` and
 *     pass `context: { socials:skip-hooks: true }` to keep any future
 *     re-entrant hooks inert.
 */

/**
 * A failure the task has already handled: the `social-posts` row records it
 * (`status`, `lastError`) or there is nothing to retry. It extends Payload's
 * `JobCancelledError`, the only error Payload 4 records as a job failure
 * (`hasError: true`, `error: { cancelled: true, message }`) without applying
 * the task's `retries`. Re-publishing such a post is the operator's call (the
 * `socialPostRetry` task, after `POST /api/socials/posts/:postId/resolve` for
 * an unknown outcome), never an automatic job retry: a blind re-run could
 * post twice.
 */
export class SocialsTaskFailure extends JobCancelledError {
  constructor(message: string) {
    super(message)
    this.name = 'SocialsTaskFailure'
  }
}

/**
 * Payload's backoff between a task's retries: `2^n × delay` after the n-th
 * failed attempt (1, 2, then 4 minutes). Payload sets the job's `waitUntil`,
 * so a drain before then skips it: a throttled publish is not retried inside
 * the platform's throttle window, however often the queue runs.
 */
export const SOCIALS_RETRY_BACKOFF = { type: 'exponential', delay: 60_000 } as const

const pluginOptionsByPayload = new WeakMap<Payload, NormalizedPluginOptions>()

const safeErrorMessage = (error: unknown): string =>
  redactSecretString(error instanceof Error ? error.message : String(error))

/** Internal: stash the normalized options so task handlers can look them up. */
export const setPluginOptionsForTasks = (
  payload: Payload,
  options: NormalizedPluginOptions,
): void => {
  pluginOptionsByPayload.set(payload, options)
}

const getPluginOptions = (payload: Payload): NormalizedPluginOptions => {
  const options = pluginOptionsByPayload.get(payload)
  if (!options) {
    throw new Error(
      '[Socials] plugin options not initialised — plugin must be applied to Payload config before tasks run',
    )
  }
  return options
}

// ---------------------------------------------------------------------------
// social-post-publish — the workhorse task
// ---------------------------------------------------------------------------

type PublishTaskInput = {
  postId: number | string
  scheduleToken?: string
}

/** Read a typed value from the row's free-form `meta` JSON. */
const metaString = (meta: unknown, key: string): string | undefined => {
  const value = (meta as Record<string, unknown> | null | undefined)?.[key]
  return typeof value === 'string' ? value : undefined
}

const buildPublishTaskConfig = () =>
  ({
    slug: SOCIAL_POST_PUBLISH_TASK_SLUG,
    handler: async ({ input, req }: { input: PublishTaskInput; req: PayloadRequest }) => {
      const options = getPluginOptions(req.payload)
      const log = createPluginLogger(req.payload.logger, {
        postId: input.postId,
        task: SOCIAL_POST_PUBLISH_TASK_SLUG,
      })

      const post = await loadPost(req.payload, input.postId)
      if (!post) {
        throw new SocialsTaskFailure(`social-posts/${input.postId} not found`)
      }
      if (post.status === 'published' && post.externalId) {
        // Already done — idempotent no-op.
        return {
          output: {
            alreadyPublished: true,
            externalId: post.externalId,
            postId: post.id,
          },
        }
      }
      if (post.status === 'cancelled') {
        throw new SocialsTaskFailure('post is cancelled')
      }
      if (awaitsReconciliation(post)) {
        // The platform holds this post (scheduled, or still processing): ask
        // where it stands. This branch always returns or throws; it never
        // reaches the publish path below.
        let adapter
        try {
          adapter = getPlatformAdapter(post.platform, options)
        } catch (error) {
          // No Payload retry: the post is now `failed` with its externalId, which
          // no claim takes back, so nothing posts it a second time.
          await recordFailure(req.payload, post.id, error)
          throw new SocialsTaskFailure(safeErrorMessage(error))
        }
        const reconciliation = await reconcilePublication({
          adapter,
          options,
          payload: req.payload,
          post,
          req,
        })
        if (reconciliation.status === 'error') {
          // Same as above: `failed` with its externalId, and no Payload retry.
          log.error('reconciliation failed', { error: safeErrorMessage(reconciliation.error) })
          throw new SocialsTaskFailure(safeErrorMessage(reconciliation.error))
        }
        if (reconciliation.status === 'skipped') {
          return { output: { postId: post.id, reconcileSkipped: reconciliation.reason } }
        }
        return {
          output: {
            pending: reconciliation.status === 'pending',
            postId: post.id,
            reconciled: reconciliation.status,
          },
        }
      }

      if (input.scheduleToken && input.scheduleToken !== metaString(post.meta, 'scheduleToken')) {
        return { output: { postId: post.id, staleSchedule: true } }
      }
      if (post.scheduledAt && Date.parse(post.scheduledAt) > Date.now()) {
        return { output: { notDue: true, postId: post.id } }
      }

      const queuedInput = post.meta?.queuedInput
      if (!queuedInput || typeof queuedInput !== 'object') {
        const err = `social-posts/${post.id}.meta.queuedInput missing`
        await recordFailure(req.payload, post.id, err)
        throw new SocialsTaskFailure(err)
      }

      if (!(await claimForPublish(req.payload, post))) {
        return {
          output: {
            alreadyInProgress: true,
            postId: post.id,
          },
        }
      }

      let ctx: SocialSourceContext
      try {
        ctx = await resolveSourceContext({
          id: post.sourceId,
          kind: post.sourceKind,
          payload: req.payload,
          req,
          sources: options.sources,
        })
      } catch (error) {
        await recordFailure(req.payload, post.id, error)
        throw new SocialsTaskFailure(safeErrorMessage(error))
      }

      let adapter
      try {
        adapter = getPlatformAdapter(post.platform, options)
      } catch (error) {
        await recordFailure(req.payload, post.id, error)
        throw new SocialsTaskFailure(safeErrorMessage(error))
      }
      const attempt = await publishClaimed({
        adapter,
        ctx,
        input: queuedInput as Record<string, unknown>,
        options,
        payload: req.payload,
        postId: post.id,
        req,
      })
      if (attempt.status === 'published') {
        log.info('published')
        return {
          output: {
            externalId: attempt.publishedRef.externalId,
            externalUrl: attempt.publishedRef.externalUrl,
            postId: post.id,
          },
        }
      }
      if (attempt.status === 'unknown') {
        log.error('publish outcome unknown; automatic retry suppressed')
        // The row is `unknown`, which no claim accepts, so even a re-run would
        // not publish; fail without retries anyway.
        throw new SocialsTaskFailure(
          `social-posts/${post.id}: publish outcome unknown; reconcile before retrying`,
        )
      }
      const message = safeErrorMessage(attempt.error)
      if (attempt.retry) {
        // The platform provably created nothing and asks to try again later:
        // Payload's retry (after the backoff) re-claims the `failed` row.
        log.error('publish failed; retryable', { error: message })
        throw new Error(message)
      }
      log.error('publish failed', { error: message })
      throw new SocialsTaskFailure(message)
    },
    inputSchema: [],
    interfaceName: 'SocialsPublishTaskInput',
    outputSchema: [],
    retries: { attempts: 3, backoff: SOCIALS_RETRY_BACKOFF },
  }) as const

// ---------------------------------------------------------------------------
// social-post-retry — explicit retry of a specific failed post
// ---------------------------------------------------------------------------

type RetryTaskInput = {
  /**
   * The operator checked the platform and the post is not there. Required to
   * retry a post that may already be live (see the ledger's `getRetryRefusal`).
   */
  confirmNotPublished?: boolean
  postId: number | string
}

const buildRetryTaskConfig = () =>
  ({
    slug: SOCIAL_POST_RETRY_TASK_SLUG,
    handler: async ({ input, req }: { input: RetryTaskInput; req: PayloadRequest }) => {
      const log = createPluginLogger(req.payload.logger, {
        postId: input.postId,
        task: SOCIAL_POST_RETRY_TASK_SLUG,
      })

      // Flip status back to `queued` and let the publish task handle it.
      const post = await loadPost(req.payload, input.postId)
      if (!post) {
        throw new SocialsTaskFailure(`social-posts/${input.postId} not found`)
      }
      const decision = decideRetry(post, {
        basePath: getPluginOptions(req.payload).api.basePath,
        confirmNotPublished: input.confirmNotPublished,
      })
      if (decision.kind === 'alreadyPublished') {
        return { output: { alreadyPublished: true, postId: post.id } }
      }
      if (decision.kind === 'refused') {
        // Re-publishing could post twice; the row is left as it is.
        throw new SocialsTaskFailure(decision.reason)
      }
      if (input.confirmNotPublished === true) {
        log.warn('retrying a post the operator confirmed is not published', {
          status: post.status,
        })
      }
      try {
        await requeueForRetry(req.payload, post.id)
      } catch (error) {
        // Only flips the row back to `queued`: safe for Payload to retry.
        throw new Error(safeErrorMessage(error))
      }
      // Re-queue the publish task. We DO NOT recurse into the publish task
      // body inline — the queue path keeps retry attempts visible in the
      // jobs UI.
      const { queueSocialPostPublish } = await import('./jobQueue.js')
      await queueSocialPostPublish({ payload: req.payload, postId: post.id, req })
      log.info('retry queued')
      return { output: { postId: post.id, requeued: true } }
    },
    inputSchema: [],
    interfaceName: 'SocialsRetryTaskInput',
    outputSchema: [],
    retries: { attempts: 1, backoff: SOCIALS_RETRY_BACKOFF },
  }) as const

// ---------------------------------------------------------------------------
// social-insights-refresh — pulls platform-side analytics for recent posts
// ---------------------------------------------------------------------------

type InsightsRefreshTaskInput = {
  /** Cap on posts processed per platform per invocation. */
  limit?: number
  /** When omitted: refresh insights for every platform with an adapter that supports it. */
  platform?: PlatformId
  /** Override the lookback window (seconds). */
  windowSeconds?: number
}

const refreshInsightsForPlatform = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  platform: PlatformId,
  windowSeconds: number,
  limit: number,
): Promise<{ failed: number; platform: PlatformId; refreshed: number; skipped: number }> => {
  let adapter
  try {
    adapter = getPlatformAdapter(platform, options)
  } catch {
    return { failed: 0, platform, refreshed: 0, skipped: 0 }
  }
  if (!adapter.getInsights) {
    return { failed: 0, platform, refreshed: 0, skipped: 0 }
  }
  const getInsights: NonNullable<typeof adapter.getInsights> = (args) => adapter.getInsights!(args)

  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const result = await payload.find({
    collection: SOCIAL_POSTS_SLUG as never,
    depth: 0,
    limit,
    overrideAccess: true,
    sort: '-publishedAt',
    where: {
      and: [
        { platform: { equals: platform } },
        { status: { equals: 'published' } },
        { publishedAt: { greater_than_equal: since } },
      ],
    },
  })

  let refreshed = 0
  let skipped = 0
  let failed = 0
  const rangeEnd = new Date().toISOString()
  const rangeStart = since

  const rows = result.docs as unknown as Array<{
    destinationId?: null | string
    externalId?: null | string
    externalUrl?: null | string
    id: number | string
    meta?: Record<string, unknown>
  }>
  let cursor = 0
  const refreshNext = async (): Promise<void> => {
    while (cursor < rows.length) {
      const row = rows[cursor++]
      if (!row.externalId) {
        skipped++
        continue
      }
      try {
        const snapshot = await getInsights({
          options,
          payload,
          publishedRef: refFromPost({ ...row, platform }),
          range: { end: rangeEnd, start: rangeStart },
        })
        await payload.update({
          id: row.id as never,
          collection: SOCIAL_POSTS_SLUG as never,
          data: {
            insightsFetchedAt: new Date().toISOString(),
            insightsSnapshot: snapshot,
          } as never,
          overrideAccess: true,
        })
        refreshed++
      } catch (error) {
        failed++
        createPluginLogger(payload.logger, {
          platform,
          postId: row.id,
          task: SOCIAL_INSIGHTS_REFRESH_TASK_SLUG,
        }).warn('insights refresh failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  const concurrency = Math.min(Math.max(1, options.rateLimit.maxConcurrency), rows.length || 1)
  await Promise.all(Array.from({ length: concurrency }, refreshNext))

  return { failed, platform, refreshed, skipped }
}

const buildInsightsRefreshTaskConfig = () =>
  ({
    slug: SOCIAL_INSIGHTS_REFRESH_TASK_SLUG,
    handler: async ({ input, req }: { input: InsightsRefreshTaskInput; req: PayloadRequest }) => {
      const options = getPluginOptions(req.payload)
      const log = createPluginLogger(req.payload.logger, {
        task: SOCIAL_INSIGHTS_REFRESH_TASK_SLUG,
      })
      const window = input.windowSeconds ?? options.scheduling.insightsRefreshWindowSeconds
      const limit = input.limit ?? 200
      const targets: PlatformId[] = input.platform ? [input.platform] : [...PLATFORM_IDS]

      const summaries: Array<{
        failed: number
        platform: PlatformId
        refreshed: number
        skipped: number
      }> = []
      const failedPlatforms: Array<{ error: string; platform: PlatformId }> = []
      for (const platform of targets) {
        if (!options.platforms[platform].enabled) {
          continue
        }
        try {
          const summary = await refreshInsightsForPlatform(
            req.payload,
            options,
            platform,
            window,
            limit,
          )
          summaries.push(summary)
        } catch (error) {
          log.error(`insights refresh failed for ${platform}`, {
            error: error instanceof Error ? error.message : String(error),
          })
          failedPlatforms.push({ error: safeErrorMessage(error), platform })
        }
      }
      const failed =
        failedPlatforms.length + summaries.reduce((total, summary) => total + summary.failed, 0)
      const refreshed = summaries.reduce((total, summary) => total + summary.refreshed, 0)
      if (failed > 0 && refreshed === 0) {
        // Nothing refreshed: throw so Payload retries (read-only on the
        // platform side). A partial refresh succeeds with its counts.
        throw new Error(
          `insights refresh failed (${failed} failed, 0 refreshed)` +
            (failedPlatforms.length
              ? `: ${failedPlatforms.map((f) => `${f.platform}: ${f.error}`).join('; ')}`
              : ''),
        )
      }
      return {
        output: failedPlatforms.length ? { failedPlatforms, summaries } : { summaries },
      }
    },
    inputSchema: [],
    interfaceName: 'SocialsInsightsRefreshTaskInput',
    outputSchema: [],
    retries: { attempts: 1, backoff: SOCIALS_RETRY_BACKOFF },
  }) as const

// ---------------------------------------------------------------------------
// social-connection-refresh — proactive token rotation
// ---------------------------------------------------------------------------

type ConnectionRefreshTaskInput = {
  platform?: PlatformId
  /** Override the expiry window (seconds) — refresh tokens expiring within this. */
  windowSeconds?: number
}

const buildConnectionRefreshTaskConfig = () =>
  ({
    slug: SOCIAL_CONNECTION_REFRESH_TASK_SLUG,
    handler: async ({ input, req }: { input: ConnectionRefreshTaskInput; req: PayloadRequest }) => {
      const options = getPluginOptions(req.payload)
      const log = createPluginLogger(req.payload.logger, {
        task: SOCIAL_CONNECTION_REFRESH_TASK_SLUG,
      })
      const windowMs =
        (input.windowSeconds ?? options.scheduling.connectionRefreshWindowSeconds) * 1000
      const targets: PlatformId[] = input.platform ? [input.platform] : [...PLATFORM_IDS]

      const { getCredentials } = await import('../server/services/connectionService.js')
      const refreshed: Array<{ platform: PlatformId; refreshed: boolean }> = []
      const failures: Array<{ error: string; platform: PlatformId }> = []

      for (const platform of targets) {
        if (!options.platforms[platform].enabled) {
          continue
        }
        try {
          const creds = await getCredentials(req.payload, options, platform)
          if (!creds?.accessToken && !creds?.refreshToken) {
            refreshed.push({ platform, refreshed: false })
            continue
          }
          const expiresAt = creds.accessTokenExpiresAt
            ? Date.parse(creds.accessTokenExpiresAt)
            : NaN
          if (Number.isFinite(expiresAt) && expiresAt - Date.now() > windowMs) {
            // Token still has time left — skip.
            refreshed.push({ platform, refreshed: false })
            continue
          }
          const adapter = getPlatformAdapter(platform, options)
          if (typeof adapter.refreshToken === 'function') {
            const result = await adapter.refreshToken({
              options,
              payload: req.payload,
              refreshToken: creds.refreshToken,
            })
            const { saveCredentials } = await import('../server/services/connectionService.js')
            await saveCredentials(req.payload, options, platform, {
              accessToken: result.accessToken,
              accessTokenExpiresAt: result.accessTokenExpiresAt,
              refreshToken: result.refreshToken,
              refreshTokenExpiresAt: result.refreshTokenExpiresAt,
              scopes: result.scopes,
              updateAccount: false,
            })
            refreshed.push({ platform, refreshed: true })
          } else {
            // No adapter-level refresh — the request-layer cache will lazily
            // refresh on next use. Mark not-refreshed for telemetry.
            refreshed.push({ platform, refreshed: false })
          }
        } catch (error) {
          log.error(`connection refresh failed for ${platform}`, {
            error: error instanceof Error ? error.message : String(error),
          })
          refreshed.push({ platform, refreshed: false })
          failures.push({ error: safeErrorMessage(error), platform })
        }
      }
      if (failures.length) {
        // Throw so Payload retries. Safe: the retry skips a platform refreshed
        // in this run once its new token is outside the window, and
        // refreshing a token again does not touch any post.
        throw new Error(
          `connection refresh failed: ${failures.map((f) => `${f.platform}: ${f.error}`).join('; ')}`,
        )
      }
      return { output: { refreshed } }
    },
    inputSchema: [],
    interfaceName: 'SocialsConnectionRefreshTaskInput',
    outputSchema: [],
    retries: { attempts: 1, backoff: SOCIALS_RETRY_BACKOFF },
  }) as const

// ---------------------------------------------------------------------------
// social-post-sweep — queues publish tasks for due posts (sweepDueSocialPosts)
// ---------------------------------------------------------------------------

type SweepTaskInput = {
  /** Override the batch size (default: scheduling.sweepBatchSize). */
  limit?: number
}

const buildSweepTaskConfig = () =>
  ({
    slug: SOCIAL_POST_SWEEP_TASK_SLUG,
    handler: async ({ input, req }: { input: SweepTaskInput; req: PayloadRequest }) => {
      const options = getPluginOptions(req.payload)
      const log = createPluginLogger(req.payload.logger, { task: SOCIAL_POST_SWEEP_TASK_SLUG })
      const { sweepDueSocialPosts } = await import('./jobQueue.js')
      // The same due query as the cron, the HTTP endpoint and worker loops.
      const { failed, queued, scanned } = await sweepDueSocialPosts(req.payload, options, req, {
        limit: input.limit,
      })
      log.info(`sweep queued ${queued} of ${scanned} due posts`)
      if (failed > 0 && queued === 0) {
        // `retries: 0`: the job is marked failed and the next sweep picks the
        // still-due posts up again.
        throw new Error(`sweep could not queue any of ${scanned} due posts`)
      }
      return { output: failed ? { failed, queued, scanned } : { queued, scanned } }
    },
    inputSchema: [],
    interfaceName: 'SocialsSweepTaskInput',
    outputSchema: [],
    retries: 0,
  }) as const

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const ALL_TASK_BUILDERS = [
  buildPublishTaskConfig,
  buildRetryTaskConfig,
  buildInsightsRefreshTaskConfig,
  buildConnectionRefreshTaskConfig,
  buildSweepTaskConfig,
] as const

export {
  buildConnectionRefreshTaskConfig,
  buildInsightsRefreshTaskConfig,
  buildPublishTaskConfig,
  buildRetryTaskConfig,
  buildSweepTaskConfig,
}
