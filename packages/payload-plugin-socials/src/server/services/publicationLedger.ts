import type { Payload, PayloadRequest } from 'payload'

import { randomUUID } from 'node:crypto'

import type {
  NormalizedPluginOptions,
  PlatformAdapter,
  PlatformId,
  PostStatus,
  PublishedRef,
  PublishResult,
  ReconcileVerdict,
  SocialSourceContext,
} from '../../types/index.js'

import { SOCIAL_POSTS_SLUG } from '../../constants.js'
import {
  ConflictError,
  getUnknownPublicationRef,
  hasUnknownPublicationOutcome,
  isAutoRetrySafe,
  NotFoundError,
  PlatformApiError,
  PublicationPersistenceError,
  ValidationError,
} from '../utilities/errors.js'
import { logAsyncOperationFailure, redactSecretString } from '../utilities/logger.js'
import { buildPublicationIdentity } from '../utilities/publicationIdentity.js'
import { queueReconciliationCheck } from './publicationReconciliation.js'

/**
 * The publication ledger: the one module that writes a `social-posts` row's
 * `status`. The publish endpoint, the cross-channel composer, the publish and
 * retry tasks and the post endpoints call it; platform adapters only call the
 * platform and return what happened (`PublishResult`).
 *
 * The row is the fence against posting twice: only the caller that moved the
 * row into `publishing` calls the platform. A first publish of new content
 * creates the row, and the unique `idempotencyKey` makes that atomic. Taking
 * back an existing row is a conditional update (`update` with a `where` on the
 * status); Payload runs it as a read, then a write by id, so two callers that
 * interleave between those steps can both match. That window is the same as it
 * was before the ledger; closing it needs a compare-and-swap in the database
 * (or Payload's job concurrency keys for the task), which this module cannot
 * express through the Local API.
 *
 * | From                                          | To                      | Who                                     |
 * | --------------------------------------------- | ----------------------- | --------------------------------------- |
 * | (no row), draft, failed, cancelled, deleted   | publishing              | `publishNow` (publish endpoint, composer) |
 * | (no row), draft, queued, failed, cancelled,   | queued                  | `schedulePublication` (scheduled publish) |
 * | deleted                                       |                         |                                         |
 * | queued; failed without an `externalId`        | publishing              | `claimForPublish` (publish task)        |
 * | publishing                                    | published, scheduled,   | `publishClaimed`, from the platform's   |
 * |                                               | publishing (pending),   | answer or error                         |
 * |                                               | failed, unknown         |                                         |
 * | scheduled, publishing (with an `externalId`)  | published, failed,      | `reconcilePublication`, from the        |
 * |                                               | unchanged (pending)     | adapter's `reconcile` verdict or error  |
 * | queued (anything else before claim)           | failed                  | `recordFailure` (task cannot start)     |
 * | any but published, unless it may be live      | queued                  | `requeueForRetry` (manual retry)        |
 * | unknown                                       | published, failed       | `resolveUnknownOutcome` (operator)      |
 * | queued                                        | cancelled               | `cancelQueuedSocialPost`                |
 * | published, publishing, unknown                | deleted                 | `markDeleted`, after the platform delete |
 *
 * Why the claims differ: an operator's publish may take back a row that holds
 * nothing (draft, failed, cancelled, deleted) but never a queued one, which its
 * scheduled job owns. The publish task takes queued rows, and failed rows
 * because Payload's retry of a safe-to-repeat failure re-runs the task on the
 * row the failed attempt left; a failed row with an `externalId` (a rejected or
 * unconfirmed platform post) is never taken back automatically. Both claims
 * clear the row's `externalId`/`externalUrl` as they take it (`startAttempt`),
 * so an id on a failed row always comes from its latest attempt, never from an
 * earlier publication of the same content.
 *
 * A post the platform holds (`scheduled`, or `publishing` with an
 * `externalId`: Facebook native scheduling, Business Profile moderation) waits
 * for reconciliation. `nextRetryAt` says when to ask the platform next; it is
 * set only on those rows (a claim clears it), so "due" is generic:
 * `dueForWorkWhere` is the one query the sweeps use. Reconciliation reads the
 * platform and records its verdict; it never publishes, and a failed check
 * leaves the post `failed` with its `externalId`, which no claim takes back.
 */

export type LedgerPost = {
  attempts?: null | number
  externalId?: null | string
  externalUrl?: null | string
  id: number | string
  idempotencyKey?: string
  destinationId?: null | string
  meta?: null | Record<string, unknown>
  nextRetryAt?: null | string
  platform: PlatformId
  queuedJobId?: null | string
  scheduledAt?: null | string
  sourceId: string
  sourceKind: string
  status: PostStatus
}

/** Statuses an operator's immediate publish may take back (`publishNow`). */
const RESERVABLE_STATUSES = ['cancelled', 'deleted', 'draft', 'failed'] as const

/** Statuses a scheduled publish may overwrite with a new schedule. */
const SCHEDULABLE_STATUSES = ['cancelled', 'deleted', 'draft', 'failed', 'queued'] as const

/** Statuses of a post the platform holds, when it has an `externalId`: reconciliation checks them. */
const AWAITING_PLATFORM_STATUSES = ['publishing', 'scheduled'] as const

/** How long after a publish (or a pending verdict without `checkAt`) to ask the platform again. */
const RECONCILE_DELAY_MS = 60_000

/** Statuses `markDeleted` accepts (the platform post may exist). */
const DELETABLE_STATUSES = ['published', 'publishing', 'unknown'] as const

const IN_PROGRESS_MESSAGE = 'an identical publication is already queued or in progress'

const now = (): string => new Date().toISOString()

const errorMessage = (error: unknown): string =>
  redactSecretString(error instanceof Error ? error.message : String(error))

const toPublishedRef = (result: PublishedRef): PublishedRef => ({
  externalId: result.externalId,
  ...(result.externalUrl !== undefined ? { externalUrl: result.externalUrl } : {}),
  ...(result.meta !== undefined ? { meta: result.meta } : {}),
  platform: result.platform,
})

const updatedCount = (result: unknown): number =>
  (result as { docs?: unknown[] } | undefined)?.docs?.length ?? 0

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const loadPost = async (
  payload: Payload,
  postId: number | string,
): Promise<LedgerPost | null> => {
  try {
    const row = (await payload.findByID({
      id: postId as never,
      collection: SOCIAL_POSTS_SLUG as never,
      depth: 0,
      overrideAccess: true,
    })) as unknown as LedgerPost | null
    return row?.id !== undefined && row.id !== null ? row : null
  } catch {
    return null
  }
}

/** `loadPost`, or a 404 `NotFoundError`. */
export const requirePost = async (
  payload: Payload,
  postId: number | string,
): Promise<LedgerPost> => {
  const post = await loadPost(payload, postId)
  if (!post) {
    throw new NotFoundError(`social-posts/${String(postId)} not found`)
  }
  return post
}

const findByKey = async (payload: Payload, idempotencyKey: string): Promise<LedgerPost | null> => {
  const result = await payload.find({
    collection: SOCIAL_POSTS_SLUG as never,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { idempotencyKey: { equals: idempotencyKey } },
  })
  return (result.docs[0] as LedgerPost | undefined) ?? null
}

const conditionalUpdate = async (
  payload: Payload,
  data: Record<string, unknown>,
  where: Record<string, unknown>[],
): Promise<boolean> => {
  const result = await payload.update({
    collection: SOCIAL_POSTS_SLUG as never,
    data: data as never,
    limit: 1,
    overrideAccess: true,
    where: { and: where },
  } as never)
  return updatedCount(result) === 1
}

/**
 * The write that moves a row into `publishing` for a new platform attempt
 * (`reserve`'s takeover, `claimForPublish`). It drops the platform reference an
 * earlier publication left (a deleted post, a rejected one the operator
 * re-queued), so the only `externalId` on the row is one this attempt records
 * (`recordResult`, `recordUnknown`). A retry-safe failure then leaves the row
 * `failed` with no `externalId`, which Payload's retry claims again. It runs
 * as part of the conditional update, after its `where` matched, so it never
 * widens which rows may be taken: `unknown`, `publishing`, `published` and
 * `scheduled` rows, and failed rows holding this attempt's id, stay fenced.
 */
const startAttempt = (post: Pick<LedgerPost, 'attempts'>): Record<string, unknown> => ({
  attempts: (post.attempts ?? 0) + 1,
  externalId: null,
  externalUrl: null,
  lastAttemptedAt: now(),
  nextRetryAt: null,
  status: 'publishing',
})

const alreadyPublishedRef = (post: LedgerPost): PublishedRef | undefined =>
  post.status === 'published' && post.externalId
    ? {
        externalId: post.externalId,
        externalUrl: post.externalUrl ?? undefined,
        platform: post.platform,
      }
    : undefined

// ---------------------------------------------------------------------------
// Recording outcomes
// ---------------------------------------------------------------------------

/** Mark a post `failed` with the error. Never throws: the caller's error stays authoritative. */
export const recordFailure = async (
  payload: Payload,
  postId: number | string,
  error: unknown,
): Promise<void> => {
  try {
    await payload.update({
      id: postId as never,
      collection: SOCIAL_POSTS_SLUG as never,
      data: { lastAttemptedAt: now(), lastError: errorMessage(error), status: 'failed' } as never,
      overrideAccess: true,
    })
  } catch {
    // Preserving the publish error is more important than the cleanup failure.
  }
}

const recordUnknown = async (
  payload: Payload,
  postId: number | string,
  publishedRef?: PublishedRef,
): Promise<void> => {
  try {
    const data: Record<string, unknown> = {
      ...(publishedRef
        ? { externalId: publishedRef.externalId, externalUrl: publishedRef.externalUrl }
        : {}),
      lastAttemptedAt: now(),
      lastError: publishedRef
        ? 'The provider accepted this publication, but its complete audit record could not be saved. The provider ID was captured; reconcile the row before any retry.'
        : 'The provider may have accepted this publication, but no definitive response was received. Reconcile it before retrying.',
      platformPublicationStatus: 'unknown',
      status: 'unknown',
    }
    if (publishedRef?.meta) {
      // Without the current meta, leave it: the provider id alone fences automatic retries.
      const current = await loadPost(payload, postId)
      if (current) {
        data.meta = { ...(current.meta ?? {}), ...publishedRef.meta }
      }
    }
    await payload.update({
      id: postId as never,
      collection: SOCIAL_POSTS_SLUG as never,
      data: data as never,
      overrideAccess: true,
    })
  } catch {
    // The original provider error remains authoritative when audit persistence fails.
  }
}

/**
 * When to check a post the platform holds after `publishClaimed`: a minute
 * after a native schedule's time, or a minute from now for a pending one. Only
 * for an adapter that can `reconcile`; otherwise the post waits for an operator.
 */
const firstCheckAt = (result: PublishResult, reconcilable: boolean): string | null => {
  if (!reconcilable || (result.state !== 'scheduled' && result.state !== 'pending')) {
    return null
  }
  const soonest = Date.now() + RECONCILE_DELAY_MS
  const scheduledMs = result.scheduledAt ? Date.parse(result.scheduledAt) : NaN
  return new Date(
    result.state === 'scheduled' && Number.isFinite(scheduledMs)
      ? Math.max(soonest, scheduledMs + RECONCILE_DELAY_MS)
      : soonest,
  ).toISOString()
}

const recordResult = async (args: {
  checkAt: null | string
  input: Record<string, unknown>
  options: NormalizedPluginOptions
  payload: Payload
  postId: number | string
  result: PublishResult
}): Promise<void> => {
  const { input, options, result } = args
  const state = result.state ?? 'published'
  const timestamp = now()
  const record = Object.fromEntries(
    Object.entries(result.record ?? {}).filter(([, value]) => value !== undefined),
  )
  const status = {
    pending: 'publishing',
    published: 'published',
    rejected: 'failed',
    scheduled: 'scheduled',
  }[state]
  const platformPublicationStatus = {
    pending: 'publishing',
    published: 'published',
    rejected: 'failed',
    scheduled: 'pending',
  }[state]
  await args.payload.update({
    id: args.postId as never,
    collection: SOCIAL_POSTS_SLUG as never,
    data: {
      ...record,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      lastAttemptedAt: timestamp,
      lastError:
        state === 'rejected' ? (result.rejectionReason ?? 'Rejected by the platform.') : null,
      // When reconciliation asks the platform about the post next.
      nextRetryAt: args.checkAt,
      platformPublicationStatus,
      ...(state === 'published' ? { publishedAt: timestamp } : {}),
      ...(state === 'scheduled' && result.scheduledAt ? { scheduledAt: result.scheduledAt } : {}),
      ...(options.authCollection && input.publishedByUserId !== undefined
        ? { publishedBy: input.publishedByUserId }
        : {}),
      status,
    } as never,
    overrideAccess: true,
  })
}

/**
 * The outcome of one platform call:
 *
 * - `published`: the platform has the post (or holds it: scheduled, pending
 *   moderation); reconciliation is queued when it needs one.
 * - `unknown`: the platform may have the post. The row is `unknown`; nothing
 *   may repeat the publish until an operator resolves it.
 * - `failed`: the platform does not have the post. `retry` is `isAutoRetrySafe`,
 *   the only decision on automatic retries.
 */
export type PublishAttempt =
  | { error: unknown; retry: boolean; status: 'failed' }
  | { error: unknown; status: 'unknown' }
  | { publishedRef: PublishedRef; status: 'published' }

const recordError = async (
  payload: Payload,
  postId: number | string,
  error: unknown,
): Promise<PublishAttempt> => {
  if (hasUnknownPublicationOutcome(error)) {
    await recordUnknown(payload, postId, getUnknownPublicationRef(error))
    return { error, status: 'unknown' }
  }
  await recordFailure(payload, postId, error)
  return { error, retry: isAutoRetrySafe(error), status: 'failed' }
}

/**
 * Call the platform for a post this caller reserved or claimed (`publishing`),
 * and record what happened. Never throws for a platform or audit failure: the
 * returned attempt carries the error.
 */
export const publishClaimed = async (args: {
  adapter: PlatformAdapter
  ctx: SocialSourceContext
  input: Record<string, unknown>
  options: NormalizedPluginOptions
  payload: Payload
  postId: number | string
  req?: PayloadRequest
}): Promise<PublishAttempt> => {
  const { payload, postId } = args
  let result: PublishResult
  try {
    result = await args.adapter.publish({
      ctx: args.ctx,
      input: args.input,
      options: args.options,
      payload,
      req: args.req,
    })
  } catch (error) {
    return recordError(payload, postId, error)
  }
  const publishedRef = toPublishedRef(result)
  const checkAt = firstCheckAt(result, typeof args.adapter.reconcile === 'function')
  try {
    await recordResult({
      checkAt,
      input: args.input,
      options: args.options,
      payload,
      postId,
      result,
    })
  } catch (cause) {
    // The platform has the post: fence it as unknown, with its id, so nothing repeats it.
    return recordError(payload, postId, new PublicationPersistenceError(publishedRef, cause))
  }
  if (result.state === 'rejected') {
    return {
      error: new PlatformApiError({
        message: result.rejectionReason ?? `${result.platform} rejected the post`,
        platform: result.platform,
        raw: result.meta?.raw,
        statusCode: 422,
        upstreamCode: 'REJECTED',
      }),
      retry: false,
      status: 'failed',
    }
  }
  if (checkAt) {
    // The row is due at `checkAt` already, so a failed queue only delays the check to the next sweep.
    await queueCheck({ checkAt, payload, postId, req: args.req })
  }
  return { publishedRef, status: 'published' }
}

// ---------------------------------------------------------------------------
// Reconciliation (publish task, for a post the platform holds)
// ---------------------------------------------------------------------------

/**
 * The one "due" query, for the sweeps: queued posts whose `scheduledAt` has
 * passed, and posts the platform holds whose next check (`nextRetryAt`) is due.
 */
export const dueForWorkWhere = (at: Date = new Date()): Record<string, unknown> => {
  const iso = at.toISOString()
  return {
    or: [
      { and: [{ status: { equals: 'queued' } }, { scheduledAt: { less_than_equal: iso } }] },
      {
        and: [
          { status: { in: [...AWAITING_PLATFORM_STATUSES] } },
          { externalId: { exists: true } },
          { nextRetryAt: { less_than_equal: iso } },
        ],
      },
    ],
  }
}

/**
 * Whether the platform holds this post (natively scheduled, or accepted and
 * still processing), so the publish task must reconcile it, never publish it.
 */
export const awaitsReconciliation = (post: LedgerPost): boolean =>
  Boolean(post.externalId) &&
  (AWAITING_PLATFORM_STATUSES as readonly string[]).includes(post.status)

/**
 * The platform reference stored on a row, for an adapter's `reconcile`,
 * `delete` or `getInsights`: `externalId`, `externalUrl`, and the row's `meta`
 * plus its `destinationId` (the board, Page, account or location).
 */
export const refFromPost = (
  post: Pick<LedgerPost, 'destinationId' | 'externalId' | 'externalUrl' | 'meta' | 'platform'>,
): PublishedRef => ({
  externalId: post.externalId ?? '',
  ...(post.externalUrl ? { externalUrl: post.externalUrl } : {}),
  meta: {
    ...(post.meta ?? {}),
    ...(post.destinationId ? { destinationId: post.destinationId } : {}),
  },
  platform: post.platform,
})

/**
 * The outcome of one reconciliation:
 *
 * - `published`, `failed`, `pending`: the adapter's verdict, recorded on the
 *   row (a pending post is due again at the verdict's `checkAt`).
 * - `skipped`: nothing asked or recorded. `notDue`: the next check is later (a
 *   duplicate job); `unsupported`: the adapter cannot reconcile; `changed`: the
 *   row left its state while the platform was asked (an operator deleted it).
 * - `error`: the check failed. The row is `failed` and keeps its
 *   `externalId`: the platform may have the post, so nothing may publish it
 *   again automatically.
 */
export type ReconcileAttempt =
  | { error: unknown; status: 'error' }
  | { reason: 'changed' | 'notDue' | 'unsupported'; status: 'skipped' }
  | { status: ReconcileVerdict['state']; verdict: ReconcileVerdict }

const verdictData = (post: LedgerPost, verdict: ReconcileVerdict): Record<string, unknown> => {
  const timestamp = now()
  const base = {
    ...(verdict.externalUrl ? { externalUrl: verdict.externalUrl } : {}),
    lastAttemptedAt: timestamp,
  }
  if (verdict.state === 'published') {
    return {
      ...base,
      lastError: null,
      nextRetryAt: null,
      platformPublicationStatus: 'published',
      publishedAt: timestamp,
      status: 'published',
    }
  }
  if (verdict.state === 'failed') {
    return {
      ...base,
      lastError: verdict.reason,
      nextRetryAt: null,
      platformPublicationStatus: 'failed',
      status: 'failed',
    }
  }
  const checkAtMs = verdict.checkAt ? Date.parse(verdict.checkAt) : NaN
  return {
    ...base,
    lastError: null,
    nextRetryAt: new Date(
      Number.isFinite(checkAtMs) ? checkAtMs : Date.now() + RECONCILE_DELAY_MS,
    ).toISOString(),
    // The status stays; the platform's view of it, as `recordResult` writes it.
    platformPublicationStatus: post.status === 'scheduled' ? 'pending' : 'publishing',
  }
}

const nextRetryAtIs = (value: null | string | undefined): Record<string, unknown> =>
  value ? { nextRetryAt: { equals: value } } : { nextRetryAt: { exists: false } }

/**
 * Note the job queued to check a held post on its row (`queuedJobId`), so the
 * sweep does not queue a second check of the same post while this one waits
 * (`sweepDueSocialPosts`). Written only while the row still awaits that check
 * (`nextRetryAt` is `checkAt`); never fails the caller.
 */
export const recordCheckJob = async (
  payload: Payload,
  args: { checkAt: null | string | undefined; jobId: number | string; postId: number | string },
): Promise<void> => {
  try {
    await conditionalUpdate(payload, { queuedJobId: String(args.jobId) }, [
      { id: { equals: args.postId } },
      { status: { in: [...AWAITING_PLATFORM_STATUSES] } },
      nextRetryAtIs(args.checkAt),
    ])
  } catch (error) {
    logAsyncOperationFailure(payload, 'socials.publication.reconciliation.record-job', error)
  }
}

/** Queue the next check of a held post (`queueReconciliationCheck`) and note its job on the row. */
const queueCheck = async (args: {
  checkAt: string
  payload: Payload
  postId: number | string
  req?: PayloadRequest
}): Promise<void> => {
  const jobId = await queueReconciliationCheck(args)
  if (jobId !== undefined) {
    await recordCheckJob(args.payload, { checkAt: args.checkAt, jobId, postId: args.postId })
  }
}

/**
 * Ask the platform where a post it holds stands (`adapter.reconcile`) and
 * record the verdict. Call only for a post that `awaitsReconciliation`. Never
 * publishes, and never throws for a platform failure: the attempt carries it.
 * The verdict is written with a guard on the row's status, `externalId` and
 * `nextRetryAt`, so it never overwrites a row an operator changed meanwhile,
 * and of two jobs checking the post at once only the first records a verdict.
 */
export const reconcilePublication = async (args: {
  adapter: PlatformAdapter
  options: NormalizedPluginOptions
  payload: Payload
  post: LedgerPost
  req?: PayloadRequest
}): Promise<ReconcileAttempt> => {
  const { adapter, payload, post } = args
  if (!awaitsReconciliation(post)) {
    throw new ValidationError(
      `social-posts/${String(post.id)} is ${post.status}; only a post the platform holds can be reconciled`,
    )
  }
  if (typeof adapter.reconcile !== 'function') {
    return { reason: 'unsupported', status: 'skipped' }
  }
  if (post.nextRetryAt && Date.parse(post.nextRetryAt) > Date.now()) {
    return { reason: 'notDue', status: 'skipped' }
  }
  let verdict: ReconcileVerdict
  try {
    verdict = await adapter.reconcile({
      options: args.options,
      payload,
      publishedRef: refFromPost(post),
      req: args.req,
    })
  } catch (error) {
    await recordFailure(payload, post.id, error)
    return { error, status: 'error' }
  }
  const data = verdictData(post, verdict)
  // `nextRetryAt` as this job read it: a verdict moves it, so when two jobs
  // check the same post (a sweep across isolates, an overlapping drain), the
  // later write no longer matches and only the first verdict queues a check.
  const recorded = await conditionalUpdate(payload, data, [
    { id: { equals: post.id } },
    { status: { equals: post.status } },
    { externalId: { equals: post.externalId } },
    nextRetryAtIs(post.nextRetryAt),
  ])
  if (!recorded) {
    return { reason: 'changed', status: 'skipped' }
  }
  if (verdict.state === 'pending') {
    await queueCheck({
      checkAt: data.nextRetryAt as string,
      payload,
      postId: post.id,
      req: args.req,
    })
  }
  return { status: verdict.state, verdict }
}

// ---------------------------------------------------------------------------
// Immediate publish (publish endpoint, composer)
// ---------------------------------------------------------------------------

/**
 * Reserve the post for this publication (creating its row, or taking back a
 * reservable one), so no other request publishes it meanwhile. An already
 * published row returns its reference instead; a queued or in-flight one is a
 * 409 `ConflictError`.
 */
const reserve = async (args: {
  ctx: SocialSourceContext
  input: Record<string, unknown>
  payload: Payload
  platform: PlatformId
  sourceHash: string
}): Promise<{ postId: number | string; publishedRef?: PublishedRef }> => {
  const { ctx, payload, platform } = args
  const identity = buildPublicationIdentity({
    ctx,
    input: args.input,
    platform,
    sourceId: ctx.sourceId,
    sourceKind: ctx.sourceKind,
  })
  const existing = await findByKey(payload, identity.idempotencyKey)
  if (existing) {
    const publishedRef = alreadyPublishedRef(existing)
    if (publishedRef) {
      return { postId: existing.id, publishedRef: { ...publishedRef, platform } }
    }
    const claimed = await conditionalUpdate(
      payload,
      startAttempt(existing),
      [{ id: { equals: existing.id } }, { status: { in: [...RESERVABLE_STATUSES] } }],
    )
    if (!claimed) {
      throw new ConflictError(IN_PROGRESS_MESSAGE)
    }
    return { postId: existing.id }
  }
  try {
    const created = (await payload.create({
      collection: SOCIAL_POSTS_SLUG as never,
      data: {
        attempts: 1,
        destinationId: identity.destinationId,
        idempotencyKey: identity.idempotencyKey,
        imageUrl: identity.primaryAssetUrl,
        lastAttemptedAt: now(),
        platform,
        sourceHash: args.sourceHash,
        sourceId: ctx.sourceId,
        sourceKind: ctx.sourceKind,
        status: 'publishing',
        title: ctx.baseTitle,
      } as never,
      overrideAccess: true,
    })) as unknown as { id: number | string }
    return { postId: created.id }
  } catch (error) {
    // The unique idempotency key: a concurrent request created the row first.
    if (await findByKey(payload, identity.idempotencyKey)) {
      throw new ConflictError(IN_PROGRESS_MESSAGE)
    }
    throw error
  }
}

/**
 * Publish now: reserve the post, call the platform, record the outcome. An
 * already published post returns its reference without a platform call.
 * Throws the platform's error (after recording it), or a 409 when the same
 * publication is queued or in progress.
 */
export const publishNow = async (args: {
  adapter: PlatformAdapter
  ctx: SocialSourceContext
  input: Record<string, unknown>
  options: NormalizedPluginOptions
  payload: Payload
  platform: PlatformId
  req?: PayloadRequest
  sourceHash: string
}): Promise<{ postId: number | string; publishedRef: PublishedRef }> => {
  const reservation = await reserve(args)
  if (reservation.publishedRef) {
    return { postId: reservation.postId, publishedRef: reservation.publishedRef }
  }
  const attempt = await publishClaimed({ ...args, postId: reservation.postId })
  if (attempt.status !== 'published') {
    throw attempt.error
  }
  return { postId: reservation.postId, publishedRef: attempt.publishedRef }
}

// ---------------------------------------------------------------------------
// Scheduled publish (scheduleSocialPostPublish, then the publish task)
// ---------------------------------------------------------------------------

export type ScheduleRowFields = {
  body?: string
  destination?: { label?: string; meta?: Record<string, unknown> }
  destinationId?: string
  idempotencyKey: string
  imageUrl?: string
  link?: string
  platform: PlatformId
  publishedBy?: number | string
  queuedInput: Record<string, unknown>
  scheduledAt: string
  sourceHash: string
  sourceId: string
  sourceKind: string
  title?: string
}

export type ScheduledRow =
  | { alreadyPublished: true; externalId: string; postId: number | string; scheduledAt: string }
  | {
      alreadyPublished?: false
      postId: number | string
      /** The job queued for the row's previous schedule, to cancel. */
      previousJobId?: null | string
      scheduleToken: string
    }

/**
 * Write the `queued` row for a scheduled publish, keyed by its idempotency key:
 * a new row, or a new schedule over a row that holds nothing live. A published
 * row is returned as is; a row that may be on the platform (`publishing`,
 * `unknown`, `scheduled`) is a 409. The returned `scheduleToken` must go into
 * the publish job's input: a job for an older schedule then does nothing.
 */
export const schedulePublication = async (
  payload: Payload,
  fields: ScheduleRowFields,
): Promise<ScheduledRow> => {
  const existing = await findByKey(payload, fields.idempotencyKey)
  if (existing?.status === 'published' && existing.externalId) {
    return {
      alreadyPublished: true,
      externalId: existing.externalId,
      postId: existing.id,
      scheduledAt: existing.scheduledAt ?? fields.scheduledAt,
    }
  }
  const scheduleToken = randomUUID()
  const { publishedBy, queuedInput, ...rest } = fields
  const data = {
    ...rest,
    attempts: 0,
    meta: { queuedInput, scheduleToken },
    ...(publishedBy !== undefined ? { publishedBy } : {}),
    status: 'queued',
  }
  const overwrite = async (row: LedgerPost): Promise<ScheduledRow> => {
    const updated = await conditionalUpdate(payload, data, [
      { id: { equals: row.id } },
      { status: { in: [...SCHEDULABLE_STATUSES] } },
    ])
    if (!updated) {
      throw new ConflictError(
        `${IN_PROGRESS_MESSAGE}, or may already be on ${row.platform} (social-posts/${String(row.id)} is ${row.status})`,
      )
    }
    return { postId: row.id, previousJobId: row.queuedJobId, scheduleToken }
  }
  if (existing) {
    return overwrite(existing)
  }
  try {
    const created = (await payload.create({
      collection: SOCIAL_POSTS_SLUG as never,
      data: data as never,
      overrideAccess: true,
    })) as unknown as { id: number | string }
    return { postId: created.id, scheduleToken }
  } catch (error) {
    const raced = await findByKey(payload, fields.idempotencyKey)
    if (!raced) {
      throw error
    }
    return overwrite(raced)
  }
}

/** Stamp the queued job's id on the row, for diagnostics and cancellation. Best effort. */
export const recordQueuedJob = async (
  payload: Payload,
  postId: number | string,
  jobId: number | string,
): Promise<void> => {
  try {
    await payload.update({
      id: postId as never,
      collection: SOCIAL_POSTS_SLUG as never,
      data: { queuedJobId: String(jobId) } as never,
      overrideAccess: true,
    })
  } catch {
    /* non-fatal */
  }
}

/**
 * Take a post for the publish task (a conditional update; see the header on
 * its atomicity). `false` means another worker has it, or it is not in a state
 * the task may publish: do not call the platform.
 */
export const claimForPublish = async (payload: Payload, post: LedgerPost): Promise<boolean> =>
  conditionalUpdate(
    payload,
    startAttempt(post),
    [
      { id: { equals: post.id } },
      {
        or: [
          { status: { equals: 'queued' } },
          { and: [{ status: { equals: 'failed' } }, { externalId: { exists: false } }] },
        ],
      },
    ],
  )

// ---------------------------------------------------------------------------
// Manual retry
// ---------------------------------------------------------------------------

/**
 * Whether a manual retry may re-publish a post. Re-publishing a post the
 * platform already has posts it twice, so the retry refuses a post that may
 * already be live unless the operator confirms they checked the platform
 * (`confirmNotPublished: true`):
 *
 * - `unknown`: a write's response was lost (5xx, timeout, network error).
 * - `publishing`: an attempt is in flight, or died mid-request.
 * - any row with an `externalId`: the platform returned a post id on the
 *   row's latest attempt (a scheduled Facebook post, a Business Profile post
 *   still processing or rejected, a failed reconciliation). A claim clears the
 *   id an earlier publication left, so that id alone never refuses a retry.
 *
 * Returns the refusal message, or `undefined` when the retry may go ahead.
 */
export const getRetryRefusal = (
  post: Pick<LedgerPost, 'externalId' | 'id' | 'platform' | 'status'>,
  options: { basePath: string; confirmNotPublished?: boolean },
): string | undefined => {
  if (options.confirmNotPublished === true) {
    return undefined
  }
  const reason =
    post.status === 'unknown'
      ? 'its publish outcome is unknown'
      : post.status === 'publishing'
        ? 'a publish attempt is in progress or was interrupted'
        : post.externalId
          ? `${post.platform} returned a post id for it (${post.externalId})`
          : undefined
  if (!reason) {
    return undefined
  }
  return (
    `social-posts/${post.id} may already be on ${post.platform}: ${reason}. ` +
    `Check ${post.platform} first. If the post is there, record it with ` +
    `POST ${options.basePath}/posts/${post.id}/resolve { "outcome": "published", "externalId": "…" } ` +
    `(for an unknown post). If it is not, retry with { "confirmNotPublished": true }.`
  )
}

export type RetryDecision =
  | { kind: 'allowed' }
  | { kind: 'alreadyPublished' }
  | { kind: 'refused'; reason: string }

/** The retry endpoint and the retry task both ask this before re-queueing a post. */
export const decideRetry = (
  post: LedgerPost,
  options: { basePath: string; confirmNotPublished?: boolean },
): RetryDecision => {
  if (post.status === 'published') {
    return { kind: 'alreadyPublished' }
  }
  const reason = getRetryRefusal(post, options)
  return reason ? { kind: 'refused', reason } : { kind: 'allowed' }
}

/** Put a post back to `queued` for the publish task. Call after `decideRetry` allowed it. */
export const requeueForRetry = async (payload: Payload, postId: number | string): Promise<void> => {
  await payload.update({
    id: postId as never,
    collection: SOCIAL_POSTS_SLUG as never,
    data: { lastError: null, nextRetryAt: null, status: 'queued' } as never,
    overrideAccess: true,
  })
}

// ---------------------------------------------------------------------------
// Operator actions: resolve, cancel, delete
// ---------------------------------------------------------------------------

/** Record what the operator found on the platform for a post whose outcome is `unknown`. */
export const resolveUnknownOutcome = async (args: {
  actorId?: number | string
  externalId?: string
  externalUrl?: string
  outcome: 'not-published' | 'published'
  payload: Payload
  postId: number | string
}): Promise<void> => {
  const post = await requirePost(args.payload, args.postId)
  if (post.status !== 'unknown') {
    throw new ValidationError('Only a post with unknown provider outcome can be resolved')
  }
  if (args.outcome === 'published' && !args.externalId) {
    throw new ValidationError('externalId is required when outcome is "published"')
  }
  await args.payload.update({
    id: post.id as never,
    collection: SOCIAL_POSTS_SLUG as never,
    data: {
      ...(args.outcome === 'published'
        ? {
            externalId: args.externalId,
            externalUrl: args.externalUrl,
            lastError: null,
            platformPublicationStatus: 'published',
            publishedAt: now(),
            status: 'published',
          }
        : {
            lastError: 'Operator confirmed that the provider did not create this post.',
            platformPublicationStatus: 'failed',
            status: 'failed',
          }),
      meta: {
        ...(post.meta ?? {}),
        reconciledAt: now(),
        ...(args.actorId !== undefined ? { reconciledBy: args.actorId } : {}),
        reconciledOutcome: args.outcome,
      },
    } as never,
    overrideAccess: true,
  })
}

const notQueuedMessage = (status: string): string =>
  `Only a queued post can be cancelled without touching the platform; this post is ${status}`

/**
 * Cancel a post that has not reached any platform yet, through a guarded update (`status =
 * queued`, and with `minLeadSeconds` a `scheduledAt` at least that far ahead). Payload's
 * conditional update selects the matching row and then writes it, as the publish task's claim
 * does, so the guard is not atomic against that claim: a post already due can be claimed between
 * the two steps and publish although this answers cancelled. `minLeadSeconds` closes that window,
 * because the publish task never claims a post before its time. Never calls a platform adapter: a
 * published, publishing or natively scheduled post refuses with 409 and is left as it was.
 */
export const cancelQueuedSocialPost = async (args: {
  minLeadSeconds?: number
  now?: Date
  payload: Payload
  postId: number | string
  userId?: number | string
}): Promise<{ postId: number | string; status: 'cancelled' }> => {
  const row = await requirePost(args.payload, args.postId)
  if (row.status !== 'queued') {
    throw new ConflictError(notQueuedMessage(row.status))
  }
  const at = args.now ?? new Date()
  const conditions: Record<string, unknown>[] = [
    { id: { equals: row.id } },
    { status: { equals: 'queued' } },
  ]
  if (args.minLeadSeconds !== undefined) {
    conditions.push({
      scheduledAt: {
        greater_than: new Date(at.getTime() + args.minLeadSeconds * 1000).toISOString(),
      },
    })
  }
  const cancelled = await conditionalUpdate(
    args.payload,
    {
      meta: {
        ...(row.meta ?? {}),
        cancelledAt: at.toISOString(),
        ...(args.userId !== undefined ? { cancelledBy: args.userId } : {}),
      },
      status: 'cancelled',
    },
    conditions,
  )
  if (!cancelled) {
    const latest = await requirePost(args.payload, row.id)
    if (latest.status !== 'queued') {
      throw new ConflictError(notQueuedMessage(latest.status))
    }
    throw new ConflictError(
      `The post is due within ${args.minLeadSeconds ?? 0} seconds and can no longer be cancelled safely`,
    )
  }
  if (row.queuedJobId) {
    try {
      await args.payload.jobs.cancelByID({ id: row.queuedJobId as never, overrideAccess: true })
    } catch {
      // The row status is the execution fence if the queued job already started.
    }
  }
  return { postId: row.id, status: 'cancelled' }
}

/**
 * Refuse a delete the ledger does not allow: only a post the platform may have
 * (published, publishing, unknown) can be deleted, and outside `localOnly` it
 * needs the platform's `externalId`. Queued posts are cancelled instead.
 */
export const assertDeletable = (post: LedgerPost, options: { localOnly: boolean }): void => {
  if (!(DELETABLE_STATUSES as readonly string[]).includes(post.status)) {
    throw new ValidationError(
      `Cannot delete a post with status "${String(post.status)}"; only published, publishing, unknown, or queued posts may be acted on`,
    )
  }
  if (!post.externalId && !options.localOnly) {
    throw new ValidationError(
      'Cannot delete a published post without an externalId (the post has no upstream reference)',
    )
  }
}

/**
 * Soft-delete the row after the platform delete (or without one, `localOnly`).
 * The row stays: it is the audit record and the idempotency anchor, and a
 * later publish of the same content takes it back.
 */
export const markDeleted = async (args: {
  localOnly: boolean
  payload: Payload
  post: LedgerPost
  userId?: number | string
}): Promise<void> => {
  await args.payload.update({
    id: args.post.id as never,
    collection: SOCIAL_POSTS_SLUG as never,
    data: {
      meta: {
        ...(args.post.meta ?? {}),
        deletedAt: now(),
        ...(args.userId !== undefined ? { deletedBy: args.userId } : {}),
        ...(args.localOnly ? { deletedLocalOnly: true } : {}),
      },
      status: 'deleted',
    } as never,
    overrideAccess: true,
  })
}
