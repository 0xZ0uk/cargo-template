import type { Payload, PayloadRequest } from 'payload'

import type { NormalizedPluginOptions, PlatformId } from '../types/index.js'

import {
  SOCIAL_CONNECTION_REFRESH_TASK_SLUG,
  SOCIAL_INSIGHTS_REFRESH_TASK_SLUG,
  SOCIAL_POST_PUBLISH_TASK_SLUG,
  SOCIAL_POST_RETRY_TASK_SLUG,
  SOCIAL_POST_SWEEP_TASK_SLUG,
  SOCIAL_POSTS_SLUG,
  SOCIALS_QUEUE_NAME,
} from '../constants.js'
import { recordQueuedJob, schedulePublication } from '../server/services/publicationLedger.js'
import { logAsyncOperationFailure } from '../server/utilities/logger.js'

/**
 * Queue helpers + the per-`Payload` runner singleton (`runQueuedSocialsJobs`).
 *
 * Every supported scheduling mode converges on these helpers:
 *
 *   - Plugin defines tasks (see `jobTaskDefinitions.ts`).
 *   - Plugin exposes `queueX` helpers + a single `runQueuedSocialsJobs`
 *     entrypoint that drains the queue via `payload.jobs.run()`.
 *   - Host triggers BOTH the queue insertion AND the drain — via Payload's
 *     native autoRun, via external cron hitting the plugin's `/internal`
 *     endpoints, or via a long-running worker process.
 *
 * The runner singleton is keyed by the Payload instance (WeakMap) so:
 *   - Multiple plugin instances on different Payload instances don't share state.
 *   - The Payload instance becoming GC-eligible cleans up automatically.
 *   - Re-entrant calls coalesce into a single in-flight `jobs.run()`.
 */

const getRecordID = (value: unknown): number | string | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (typeof record.id === 'number' || typeof record.id === 'string') {
    return record.id
  }
  return undefined
}

const queueNames = new WeakMap<Payload, string>()

export const setSocialsQueueName = (payload: Payload, queue: string): void => {
  queueNames.set(payload, queue)
}

// ---------------------------------------------------------------------------
// Per-payload `jobs.run()` singleton
// ---------------------------------------------------------------------------

const runnerState = new WeakMap<Payload, Promise<void>>()

/**
 * Drains the socials queue. Idempotent across concurrent callers — repeated
 * invocations while a drain is in flight return the SAME promise.
 *
 * Returns `undefined` rather than the raw `jobs.run` result so callers don't
 * grow a dependency on Payload's job-tracking shape.
 */
export const runQueuedSocialsJobs = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  req?: PayloadRequest,
): Promise<void> => {
  const existing = runnerState.get(payload)
  if (existing) {
    return existing
  }

  const limit = options.scheduling.drainBatchSize
  const queue = options.scheduling.queue

  // Payload 4's Local API no longer bypasses access: `jobs.run` would require a
  // logged-in user (jobs.access.run), which cron and scheduler drains don't have.
  // Callers are gated by the plugin's own `authorize` / internal API key.
  const promise = payload.jobs
    .run({ limit, overrideAccess: true, queue, req })
    .then(() => undefined)
    .finally(() => {
      runnerState.delete(payload)
    })

  runnerState.set(payload, promise)
  return promise
}

// ---------------------------------------------------------------------------
// Sweep — find due posts and queue their publish tasks
// ---------------------------------------------------------------------------

export type SweepResult = {
  /** Due posts whose publish job could not be queued (logged; the next sweep tries again). */
  failed: number
  queued: number
  scanned: number
}

/**
 * The one "due" query, shared by `sweepDueSocialPosts` (cron, HTTP endpoint,
 * worker loop) and the `socialPostSweep` task (`scheduling.autoRun`): queued
 * posts whose `scheduledAt` has passed, plus Business Profile `publishing` and
 * Facebook `scheduled` posts whose follow-up check (`nextRetryAt`) is due.
 */
export const findDueSocialPosts = async (
  payload: Payload,
  args: { limit: number; now?: Date },
): Promise<Array<{ id: number | string }>> => {
  const now = (args.now ?? new Date()).toISOString()
  const result = await payload.find({
    collection: SOCIAL_POSTS_SLUG as never,
    depth: 0,
    limit: args.limit,
    overrideAccess: true,
    sort: 'scheduledAt',
    where: {
      or: [
        { and: [{ status: { equals: 'queued' } }, { scheduledAt: { less_than_equal: now } }] },
        {
          and: [
            { platform: { equals: 'gbp' } },
            { status: { equals: 'publishing' } },
            { nextRetryAt: { less_than_equal: now } },
          ],
        },
        {
          and: [
            { platform: { equals: 'facebook' } },
            { status: { equals: 'scheduled' } },
            { nextRetryAt: { less_than_equal: now } },
          ],
        },
      ],
    },
  })
  return result.docs as unknown as Array<{ id: number | string }>
}

/**
 * Queue a publish job for every due post (`findDueSocialPosts`). The publish
 * task decides what the job does: publish a queued post, or check a post the
 * platform still holds. A post whose job fails to queue is logged and counted
 * in `failed`; it stays due, so the next sweep picks it up.
 */
export const sweepDueSocialPosts = async (
  payload: Payload,
  options: NormalizedPluginOptions,
  req?: PayloadRequest,
  args: { limit?: number } = {},
): Promise<SweepResult> => {
  const rows = await findDueSocialPosts(payload, {
    limit: args.limit ?? options.scheduling.sweepBatchSize,
  })
  let queued = 0
  let failed = 0
  for (const row of rows) {
    try {
      await queueSocialPostPublish({ payload, postId: row.id, req })
      queued++
    } catch (error) {
      failed++
      logAsyncOperationFailure(payload, 'socials.sweep.queue', error)
    }
  }
  return { failed, queued, scanned: rows.length }
}

// ---------------------------------------------------------------------------
// Queue helpers (each task gets a thin typed wrapper around payload.jobs.queue)
// ---------------------------------------------------------------------------

type QueueArgs = {
  payload: Payload
  req?: PayloadRequest
}

const queueOnSocialsQueue = async (args: {
  input: Record<string, unknown>
  payload: Payload
  req?: PayloadRequest
  task: string
  waitUntil?: Date | string
}): Promise<number | string | undefined> => {
  const queueOptions: {
    input: Record<string, unknown>
    overrideAccess: true
    queue: string
    req?: PayloadRequest
    task: string
    waitUntil?: Date
  } = {
    input: args.input,
    // Payload 4 checks jobs.access.queue (a logged-in user) unless told otherwise;
    // sweeps and follow-up publishes run without one.
    overrideAccess: true,
    queue: queueNames.get(args.payload) ?? SOCIALS_QUEUE_NAME,
    req: args.req,
    task: args.task,
  }
  if (args.waitUntil) {
    queueOptions.waitUntil =
      args.waitUntil instanceof Date ? args.waitUntil : new Date(args.waitUntil)
  }
  const job = await args.payload.jobs.queue(queueOptions as never)
  return getRecordID(job)
}

export type QueuePublishArgs = {
  postId: number | string
  /** Defer the work until this instant (Payload Jobs' `waitUntil`). */
  scheduledAt?: Date | string
  scheduleToken?: string
} & QueueArgs

export const queueSocialPostPublish = async (
  args: QueuePublishArgs,
): Promise<number | string | undefined> => {
  const input: Record<string, unknown> = { postId: args.postId }
  if (args.scheduleToken) {
    input.scheduleToken = args.scheduleToken
  }
  return queueOnSocialsQueue({
    input,
    payload: args.payload,
    req: args.req,
    task: SOCIAL_POST_PUBLISH_TASK_SLUG,
    waitUntil: args.scheduledAt,
  })
}

export type QueueRetryArgs = {
  /**
   * The operator checked the platform and the post is not there. Without it the
   * retry task refuses a post that may already be live (`unknown`, `publishing`,
   * or with an `externalId`).
   */
  confirmNotPublished?: boolean
  postId: number | string
} & QueueArgs

export const queueSocialPostRetry = async (
  args: QueueRetryArgs,
): Promise<number | string | undefined> =>
  queueOnSocialsQueue({
    input: {
      postId: args.postId,
      ...(args.confirmNotPublished === true ? { confirmNotPublished: true } : {}),
    },
    payload: args.payload,
    req: args.req,
    task: SOCIAL_POST_RETRY_TASK_SLUG,
  })

export type QueueInsightsRefreshArgs = {
  limit?: number
  platform?: PlatformId
  windowSeconds?: number
} & QueueArgs

export const queueSocialInsightsRefresh = async (
  args: QueueInsightsRefreshArgs,
): Promise<number | string | undefined> => {
  const input: Record<string, unknown> = {}
  if (args.platform) {
    input.platform = args.platform
  }
  if (args.windowSeconds !== undefined) {
    input.windowSeconds = args.windowSeconds
  }
  if (args.limit !== undefined) {
    input.limit = args.limit
  }
  return queueOnSocialsQueue({
    input,
    payload: args.payload,
    req: args.req,
    task: SOCIAL_INSIGHTS_REFRESH_TASK_SLUG,
  })
}

export type QueueConnectionRefreshArgs = {
  platform?: PlatformId
  windowSeconds?: number
} & QueueArgs

export const queueSocialConnectionRefresh = async (
  args: QueueConnectionRefreshArgs,
): Promise<number | string | undefined> => {
  const input: Record<string, unknown> = {}
  if (args.platform) {
    input.platform = args.platform
  }
  if (args.windowSeconds !== undefined) {
    input.windowSeconds = args.windowSeconds
  }
  return queueOnSocialsQueue({
    input,
    payload: args.payload,
    req: args.req,
    task: SOCIAL_CONNECTION_REFRESH_TASK_SLUG,
  })
}

export type QueueSweepArgs = { limit?: number } & QueueArgs

export const queueSocialPostSweep = async (
  args: QueueSweepArgs,
): Promise<number | string | undefined> => {
  const input: Record<string, unknown> = {}
  if (args.limit !== undefined) {
    input.limit = args.limit
  }
  return queueOnSocialsQueue({
    input,
    payload: args.payload,
    req: args.req,
    task: SOCIAL_POST_SWEEP_TASK_SLUG,
  })
}

// ---------------------------------------------------------------------------
// One-shot helper: snapshot a publish input into a queued post row
// ---------------------------------------------------------------------------

/**
 * Persist a scheduled publish into the `social-posts` collection AND queue
 * the publish task with `waitUntil` honouring the schedule. Returns the
 * generated post id + job id so callers (admin endpoints, server actions)
 * can surface them.
 *
 * The idempotency contract matches the immediate-publish path: a row keyed
 * by `idempotencyKey` is upserted, so re-scheduling the same `(platform,
 * source, destination, asset)` tuple does NOT create duplicate work. The
 * publication ledger refuses (409) to reschedule a row that may already be on
 * the platform (`publishing`, `unknown`, `scheduled`).
 */
export const scheduleSocialPostPublish = async (args: {
  body?: string
  /** Snapshotted display fields for the admin UI. */
  destination?: {
    label?: string
    meta?: Record<string, unknown>
  }
  /** The account the post goes to (board, Instagram user, Page or location resource name). */
  destinationId?: string
  idempotencyKey: string
  imageUrl?: string
  link?: string
  options: NormalizedPluginOptions
  payload: Payload
  platform: PlatformId
  publishedByUserId?: number | string
  /** Snapshot the full publish input the adapter will replay later. */
  queuedInput: Record<string, unknown>
  req?: PayloadRequest
  scheduledAt: Date | string
  sourceHash: string
  sourceId: string
  sourceKind: string
  title?: string
}): Promise<{
  alreadyPublished?: boolean
  externalId?: string
  jobId?: number | string
  postId: number | string
  scheduledAt: string
}> => {
  const scheduledIso =
    args.scheduledAt instanceof Date
      ? args.scheduledAt.toISOString()
      : new Date(args.scheduledAt).toISOString()

  const row = await schedulePublication(args.payload, {
    body: args.body,
    destination: args.destination,
    destinationId: args.destinationId,
    idempotencyKey: args.idempotencyKey,
    imageUrl: args.imageUrl,
    link: args.link,
    platform: args.platform,
    ...(args.options.authCollection ? { publishedBy: args.publishedByUserId } : {}),
    queuedInput: args.queuedInput,
    scheduledAt: scheduledIso,
    sourceHash: args.sourceHash,
    sourceId: args.sourceId,
    sourceKind: args.sourceKind,
    title: args.title,
  })
  if (row.alreadyPublished) {
    // Already published — surface as a no-op so callers can return early.
    return {
      alreadyPublished: true,
      externalId: row.externalId,
      postId: row.postId,
      scheduledAt: row.scheduledAt,
    }
  }
  const { postId } = row

  const jobId = await queueSocialPostPublish({
    payload: args.payload,
    postId,
    req: args.req,
    scheduledAt: scheduledIso,
    scheduleToken: row.scheduleToken,
  })

  // Stamp the queued job id back onto the post for diagnostics.
  if (jobId !== undefined) {
    await recordQueuedJob(args.payload, postId, jobId)
  }

  if (row.previousJobId && String(row.previousJobId) !== String(jobId)) {
    try {
      await args.payload.jobs.cancelByID({
        id: row.previousJobId as never,
        overrideAccess: true,
      })
    } catch (error) {
      logAsyncOperationFailure(args.payload, 'socials.jobs.cancel-stale', error)
    }
  }

  return { jobId, postId, scheduledAt: scheduledIso }
}
