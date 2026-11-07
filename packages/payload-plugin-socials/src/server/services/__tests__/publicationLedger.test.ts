import type { Config, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type {
  PlatformAdapter,
  PostStatus,
  PublishResult,
  ReconcileVerdict,
  SocialSourceContext,
} from '../../../types/index.js'

import payloadPluginSocials, { normalizePluginOptions } from '../../../index.js'
import { classifyRequestFailure, PlatformApiError } from '../../utilities/errors.js'
import { buildPublicationIdentity } from '../../utilities/publicationIdentity.js'
import {
  assertDeletable,
  awaitsReconciliation,
  cancelQueuedSocialPost,
  claimForPublish,
  decideRetry,
  dueForWorkWhere,
  loadPost,
  markDeleted,
  publishClaimed,
  publishNow,
  reconcilePublication,
  requirePost,
  resolveUnknownOutcome,
  schedulePublication,
} from '../publicationLedger.js'

/**
 * The publication ledger against a real Payload on in-memory SQLite, with a
 * fake adapter: the `social-posts` row is the fence against posting twice, so
 * these assert the rows, not calls on a mocked `payload`.
 */

const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const pluginOptions = {
  authorize: () => Promise.resolve(true),
  encryptionKey: HEX_KEY,
  platforms: {
    pinterest: {
      clientId: 'id',
      clientSecret: 'secret',
      enabled: true,
      redirectUri: 'https://example.test/callback',
    },
  },
  sources: { product: () => Promise.reject(new Error('stub')) },
}
const options = normalizePluginOptions(pluginOptions)

let payload: Payload

beforeAll(async () => {
  const config = await buildConfig({
    collections: [{ slug: 'products', fields: [{ name: 'title', type: 'text' }] }],
    db: sqliteAdapter({ client: { url: ':memory:' }, push: true }) as Config['db'],
    editor: lexicalEditor(),
    jobs: { tasks: [] },
    plugins: [payloadPluginSocials(pluginOptions)],
    secret: 'test-secret',
  })
  payload = await getPayload({ config })
}, 60_000)

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
})

type Row = {
  attempts?: null | number
  externalId?: null | string
  id: number | string
  lastError?: null | string
  meta?: null | Record<string, unknown>
  nextRetryAt?: null | string
  platformPublicationStatus?: null | string
  publishedAt?: null | string
  scheduledAt?: null | string
  sourceHash?: string
  status: PostStatus
  title?: null | string
}

let sourceCounter = 0
const nextCtx = (): SocialSourceContext => ({
  baseDescription: 'A regal marble lion.',
  baseTitle: 'Marble Lion',
  images: [{ role: 'main', url: 'https://cdn.example.com/main.jpg' }],
  link: 'https://example.com/products/lion',
  sourceId: `src-${++sourceCounter}`,
  sourceKind: 'product',
})

const input = { boardId: 'board_1' }

const fakeAdapter = (
  publish: () => Promise<PublishResult>,
  reconcile?: () => Promise<ReconcileVerdict>,
) => {
  const fn = vi.fn(publish)
  const reconcileFn = reconcile
    ? vi.fn((_args: Parameters<NonNullable<PlatformAdapter['reconcile']>>[0]) => reconcile())
    : undefined
  return {
    adapter: {
      publish: fn,
      ...(reconcileFn ? { reconcile: reconcileFn } : {}),
    } as unknown as PlatformAdapter,
    publish: fn,
    reconcile: reconcileFn,
  }
}

const pendingVerdict = async (): Promise<ReconcileVerdict> => ({ state: 'pending' })

/** The publish jobs queued for a post (the reconciliation checks), oldest first. */
const publishJobsFor = async (
  postId: number | string,
): Promise<Array<{ waitUntil?: null | string }>> => {
  const jobs = await payload.find({
    collection: 'payload-jobs',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    sort: 'createdAt',
    where: { taskSlug: { equals: 'socialPostPublish' } },
  })
  return jobs.docs.filter(
    (job) =>
      String((job.input as { postId?: number | string } | undefined)?.postId) === String(postId),
  ) as Array<{ waitUntil?: null | string }>
}

afterEach(() => {
  vi.restoreAllMocks()
})

const published = (over: Partial<PublishResult> = {}): PublishResult => ({
  externalId: 'pin_1',
  externalUrl: 'https://www.pinterest.com/pin/pin_1/',
  platform: 'pinterest',
  record: { body: 'Sent copy', sourceHash: 'sent-hash', title: 'Pin title' },
  ...over,
})

const row = async (id: number | string): Promise<Row> =>
  (await payload.findByID({
    id: id as never,
    collection: 'social-posts' as never,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Row

const rowForKey = async (ctx: SocialSourceContext): Promise<Row | undefined> => {
  const { idempotencyKey } = buildPublicationIdentity({
    ctx,
    input,
    platform: 'pinterest',
    sourceId: ctx.sourceId,
    sourceKind: ctx.sourceKind,
  })
  const result = await payload.find({
    collection: 'social-posts' as never,
    depth: 0,
    overrideAccess: true,
    where: { idempotencyKey: { equals: idempotencyKey } },
  })
  return result.docs[0] as unknown as Row | undefined
}

let keyCounter = 0
const createRow = async (data: Record<string, unknown>): Promise<Row> =>
  (await payload.create({
    collection: 'social-posts' as never,
    data: {
      idempotencyKey: `seed-${++keyCounter}`.padEnd(64, '0'),
      meta: { queuedInput: input },
      platform: 'pinterest',
      sourceHash: 'hash',
      sourceId: `seed-${keyCounter}`,
      sourceKind: 'product',
      ...data,
    } as never,
    overrideAccess: true,
  })) as unknown as Row

const now = (): number => Date.now()

const runPublishNow = (ctx: SocialSourceContext, adapter: PlatformAdapter) =>
  publishNow({
    adapter,
    ctx,
    input,
    options,
    payload,
    platform: 'pinterest',
    sourceHash: 'reserved-hash',
  })

describe('publishNow (publish endpoint, composer)', () => {
  it('reserves the row before calling the platform and records the result', async () => {
    const ctx = nextCtx()
    let statusDuringCall: PostStatus | undefined
    const { adapter, publish } = fakeAdapter(async () => {
      statusDuringCall = (await rowForKey(ctx))?.status
      return published()
    })

    const result = await runPublishNow(ctx, adapter)

    expect(statusDuringCall).toBe('publishing')
    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.calls[0]).toBeDefined()
    expect(result.publishedRef).toEqual({
      externalId: 'pin_1',
      externalUrl: 'https://www.pinterest.com/pin/pin_1/',
      platform: 'pinterest',
    })
    expect(await row(result.postId)).toMatchObject({
      attempts: 1,
      externalId: 'pin_1',
      lastError: null,
      platformPublicationStatus: 'published',
      publishedAt: expect.any(String),
      sourceHash: 'sent-hash',
      status: 'published',
      title: 'Pin title',
    })
  })

  it('returns an already-published post without calling the platform', async () => {
    const ctx = nextCtx()
    const first = await runPublishNow(ctx, fakeAdapter(async () => published()).adapter)
    const { adapter, publish } = fakeAdapter(async () => published({ externalId: 'pin_2' }))

    const second = await runPublishNow(ctx, adapter)

    expect(publish).not.toHaveBeenCalled()
    expect(second).toEqual({
      postId: first.postId,
      publishedRef: expect.objectContaining({ externalId: 'pin_1' }),
    })
  })

  it('lets only one of two concurrent requests call the platform', async () => {
    const ctx = nextCtx()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { adapter, publish } = fakeAdapter(async () => {
      await gate
      return published()
    })

    const results = Promise.allSettled([runPublishNow(ctx, adapter), runPublishNow(ctx, adapter)])
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    release()
    const [a, b] = await results

    expect(publish).toHaveBeenCalledOnce()
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409 })
  })

  it.each<[PostStatus, Record<string, unknown>]>([
    ['queued', {}],
    ['publishing', {}],
    ['unknown', {}],
    ['scheduled', { externalId: 'fb_1' }],
  ])('refuses (409) a %s row without calling the platform', async (status, extra) => {
    const ctx = nextCtx()
    const { idempotencyKey } = buildPublicationIdentity({
      ctx,
      input,
      platform: 'pinterest',
      sourceId: ctx.sourceId,
      sourceKind: ctx.sourceKind,
    })
    await createRow({ idempotencyKey, status, ...extra })
    const { adapter, publish } = fakeAdapter(async () => published())

    await expect(runPublishNow(ctx, adapter)).rejects.toMatchObject({ statusCode: 409 })
    expect(publish).not.toHaveBeenCalled()
  })

  it.each<PostStatus>(['failed', 'cancelled', 'deleted', 'draft'])(
    'takes back a %s row in place (same row, attempts counted)',
    async (status) => {
      const ctx = nextCtx()
      const { idempotencyKey } = buildPublicationIdentity({
        ctx,
        input,
        platform: 'pinterest',
        sourceId: ctx.sourceId,
        sourceKind: ctx.sourceKind,
      })
      const existing = await createRow({ attempts: 2, idempotencyKey, status })

      const result = await runPublishNow(ctx, fakeAdapter(async () => published()).adapter)

      expect(result.postId).toBe(existing.id)
      expect(await row(existing.id)).toMatchObject({ attempts: 3, status: 'published' })
    },
  )

  it('records a platform failure as failed, with the redacted error, and rethrows it', async () => {
    const ctx = nextCtx()
    const error = new PlatformApiError({
      message: 'rejected access_token=SECRET123',
      platform: 'pinterest',
      statusCode: 400,
    })

    await expect(runPublishNow(ctx, fakeAdapter(() => Promise.reject(error)).adapter)).rejects.toBe(
      error,
    )
    const saved = await rowForKey(ctx)
    expect(saved?.status).toBe('failed')
    expect(saved?.lastError).not.toContain('SECRET123')
  })

  it('records an unknown outcome as unknown, which nothing publishes again', async () => {
    const ctx = nextCtx()
    const error = new PlatformApiError({
      message: 'response lost',
      ...classifyRequestFailure({ effect: 'create' }),
      platform: 'pinterest',
    })
    await expect(runPublishNow(ctx, fakeAdapter(() => Promise.reject(error)).adapter)).rejects.toBe(
      error,
    )
    const saved = await rowForKey(ctx)
    expect(saved).toMatchObject({ platformPublicationStatus: 'unknown', status: 'unknown' })

    const { adapter, publish } = fakeAdapter(async () => published())
    await expect(runPublishNow(ctx, adapter)).rejects.toMatchObject({ statusCode: 409 })
    expect(await claimForPublish(payload, saved as never)).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })

  it('fences a platform success whose record cannot be saved as unknown, with its id', async () => {
    const ctx = nextCtx()
    const update = payload.update.bind(payload)
    const spy = vi.spyOn(payload, 'update').mockImplementation(((args: { data?: unknown }) => {
      if ((args.data as { status?: string } | undefined)?.status === 'published') {
        return Promise.reject(new Error('database unavailable'))
      }
      return update(args as never)
    }) as never)
    try {
      await expect(
        runPublishNow(
          ctx,
          fakeAdapter(async () => published({ meta: { boardId: 'board_1' } })).adapter,
        ),
      ).rejects.toMatchObject({ name: 'PublicationPersistenceError' })
    } finally {
      spy.mockRestore()
    }
    expect(await rowForKey(ctx)).toMatchObject({
      externalId: 'pin_1',
      meta: expect.objectContaining({ boardId: 'board_1' }),
      status: 'unknown',
    })
  })
})

describe('publishClaimed: recording what the platform said', () => {
  const claimed = async (): Promise<Row> => createRow({ attempts: 1, status: 'publishing' })

  const run = (
    postId: number | string,
    publish: () => Promise<PublishResult>,
    reconcile: (() => Promise<ReconcileVerdict>) | null = pendingVerdict,
  ) =>
    publishClaimed({
      adapter: fakeAdapter(publish, reconcile ?? undefined).adapter,
      ctx: nextCtx(),
      input,
      options,
      payload,
      postId,
    })

  it('records a natively scheduled post as scheduled, checked again after its time', async () => {
    const post = await claimed()
    const scheduledAt = new Date(now() + 3_600_000).toISOString()
    const attempt = await run(post.id, async () =>
      published({ externalUrl: undefined, scheduledAt, state: 'scheduled' }),
    )
    expect(attempt.status).toBe('published')
    const saved = await row(post.id)
    expect(saved).toMatchObject({
      platformPublicationStatus: 'pending',
      publishedAt: null,
      scheduledAt,
      status: 'scheduled',
    })
    expect(Date.parse(saved.nextRetryAt ?? '')).toBe(Date.parse(scheduledAt) + 60_000)
    // The check is queued for the same time the row is due.
    const jobs = await publishJobsFor(post.id)
    expect(jobs).toHaveLength(1)
    expect(Date.parse(jobs[0]?.waitUntil ?? '')).toBe(Date.parse(saved.nextRetryAt ?? ''))
  })

  it('checks a post scheduled in the past a minute from now, not at once', async () => {
    const post = await claimed()
    const before = now()
    await run(post.id, async () =>
      published({ scheduledAt: new Date(before - 3_600_000).toISOString(), state: 'scheduled' }),
    )
    expect(Date.parse((await row(post.id)).nextRetryAt ?? '')).toBeGreaterThanOrEqual(
      before + 60_000,
    )
  })

  it('sets no next check, and queues none, when the adapter cannot reconcile', async () => {
    const post = await claimed()
    await run(post.id, async () => published({ state: 'pending' }), null)
    expect(await row(post.id)).toMatchObject({ nextRetryAt: null, status: 'publishing' })
    expect(await publishJobsFor(post.id)).toHaveLength(0)
  })

  it('leaves the row due when the check cannot be queued, so the sweep finds it', async () => {
    const post = await claimed()
    vi.spyOn(payload.jobs, 'queue').mockRejectedValueOnce(new Error('queue down'))
    const attempt = await run(post.id, async () => published({ state: 'pending' }))
    expect(attempt.status).toBe('published')
    const saved = await row(post.id)
    expect(saved).toMatchObject({ nextRetryAt: expect.any(String), status: 'publishing' })
    expect(await publishJobsFor(post.id)).toHaveLength(0)
    const due = await payload.find({
      collection: 'social-posts' as never,
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      where: dueForWorkWhere(new Date(Date.parse(saved.nextRetryAt ?? '') + 1)) as never,
    })
    expect(due.docs.map((doc) => (doc as unknown as Row).id)).toContain(post.id)
  })

  it('records a post the platform is still processing as publishing, with its id', async () => {
    const post = await claimed()
    await run(post.id, async () => published({ state: 'pending' }))
    expect(await row(post.id)).toMatchObject({
      externalId: 'pin_1',
      nextRetryAt: expect.any(String),
      platformPublicationStatus: 'publishing',
      status: 'publishing',
    })
  })

  it('records a rejected post as failed with its id and does not retry it', async () => {
    const post = await claimed()
    const attempt = await run(post.id, async () =>
      published({ rejectionReason: 'Rejected by moderation.', state: 'rejected' }),
    )
    expect(attempt).toMatchObject({
      error: expect.objectContaining({ statusCode: 422, upstreamCode: 'REJECTED' }),
      retry: false,
      status: 'failed',
    })
    expect(await row(post.id)).toMatchObject({
      externalId: 'pin_1',
      lastError: 'Rejected by moderation.',
      platformPublicationStatus: 'failed',
      status: 'failed',
    })
  })

  it.each([
    [
      'a throttled create the platform rejected',
      classifyRequestFailure({ effect: 'create', status: 429 }),
      true,
    ],
    ['a validation rejection', classifyRequestFailure({ effect: 'create', status: 400 }), false],
    ['a retryable error that does not prove nothing was created', { retryable: true }, false],
  ])('retries only when isAutoRetrySafe: %s', async (_label, flags, retry) => {
    const post = await claimed()
    const attempt = await run(post.id, () =>
      Promise.reject(
        new PlatformApiError({ message: 'upstream', platform: 'pinterest', ...flags }),
      ),
    )
    expect(attempt).toMatchObject({ retry, status: 'failed' })
    expect((await row(post.id)).status).toBe('failed')
  })

  it('never retries an error from outside the platform clients', async () => {
    const post = await claimed()
    const attempt = await run(post.id, () => Promise.reject(new Error('bug')))
    expect(attempt).toMatchObject({ retry: false, status: 'failed' })
  })
})

describe('claimForPublish (publish task)', () => {
  it.each<[PostStatus, Record<string, unknown>, boolean]>([
    ['queued', {}, true],
    ['queued', { externalId: 'confirmed_by_operator' }, true],
    ['failed', {}, true],
    ['failed', { externalId: 'rejected_1' }, false],
    ['publishing', {}, false],
    ['unknown', {}, false],
    ['published', { externalId: 'pin_1' }, false],
    ['scheduled', { externalId: 'fb_1' }, false],
    ['cancelled', {}, false],
    ['deleted', {}, false],
    ['draft', {}, false],
  ])('%s %j → %s', async (status, extra, expected) => {
    const post = await createRow({ attempts: 1, status, ...extra })
    expect(await claimForPublish(payload, post as never)).toBe(expected)
    const saved = await row(post.id)
    expect(saved.status).toBe(expected ? 'publishing' : status)
    if (expected) {
      expect(saved.attempts).toBe(2)
    }
  })

  it('clears the platform id an earlier publication left, so a safe failure can be claimed again', async () => {
    // Published, deleted on the platform, then scheduled again: the row is
    // queued but still holds the deleted post's id.
    const post = await createRow({
      externalId: 'pin_deleted',
      externalUrl: 'https://www.pinterest.com/pin/pin_deleted/',
      status: 'queued',
    })
    expect(await claimForPublish(payload, post as never)).toBe(true)
    expect(await row(post.id)).toMatchObject({ externalId: null, status: 'publishing' })

    const attempt = await publishClaimed({
      adapter: fakeAdapter(() =>
        Promise.reject(
          new PlatformApiError({
            message: 'throttled',
            platform: 'pinterest',
            retryable: true,
            safeToRepeat: true,
            statusCode: 429,
          }),
        ),
      ).adapter,
      ctx: nextCtx(),
      input,
      options,
      payload,
      postId: post.id,
    })
    expect(attempt).toMatchObject({ retry: true, status: 'failed' })
    const failed = await row(post.id)
    expect(failed).toMatchObject({ externalId: null, status: 'failed' })
    expect(decideRetry(failed as never, { basePath: '/api/socials' })).toEqual({ kind: 'allowed' })
    // Payload's retry re-claims the row.
    expect(await claimForPublish(payload, failed as never)).toBe(true)
  })

  it('keeps the id a failed attempt recorded, which fences the row', async () => {
    const post = await createRow({ externalId: 'pin_old', status: 'queued' })
    expect(await claimForPublish(payload, post as never)).toBe(true)
    await publishClaimed({
      adapter: fakeAdapter(() =>
        Promise.resolve(published({ externalId: 'pin_rejected', state: 'rejected' })),
      ).adapter,
      ctx: nextCtx(),
      input,
      options,
      payload,
      postId: post.id,
    })
    const failed = await row(post.id)
    expect(failed).toMatchObject({ externalId: 'pin_rejected', status: 'failed' })
    expect(await claimForPublish(payload, failed as never)).toBe(false)
  })

  it('refuses a second claim once the first has taken the row', async () => {
    // Sequential, not concurrent: Payload's conditional update reads and then
    // writes, so two claims interleaved between those steps can both match
    // (see the ledger's header). A first publish of new content is atomic
    // through the unique idempotency key instead (see publishNow above).
    const post = await createRow({ status: 'queued' })
    expect(await claimForPublish(payload, post as never)).toBe(true)
    expect(await claimForPublish(payload, post as never)).toBe(false)
  })
})

describe('schedulePublication', () => {
  const fields = (idempotencyKey: string) => ({
    idempotencyKey,
    platform: 'pinterest' as const,
    queuedInput: input,
    scheduledAt: new Date(now() + 3_600_000).toISOString(),
    sourceHash: 'hash',
    sourceId: 'scheduled',
    sourceKind: 'product',
  })

  it('creates a queued row with the input and a schedule token', async () => {
    const result = await schedulePublication(payload, fields('a'.repeat(64)))
    if (result.alreadyPublished) {
      throw new Error('expected a new schedule')
    }
    expect(await row(result.postId)).toMatchObject({
      attempts: 0,
      meta: { queuedInput: input, scheduleToken: result.scheduleToken },
      status: 'queued',
    })
  })

  it('reschedules a queued row with a new token and names its previous job', async () => {
    const existing = await createRow({
      meta: { scheduleToken: 'old' },
      queuedJobId: 'job_old',
      status: 'queued',
    })
    const key = (existing as unknown as { idempotencyKey: string }).idempotencyKey
    const result = await schedulePublication(payload, fields(key))
    expect(result).toMatchObject({ postId: existing.id, previousJobId: 'job_old' })
    expect((await row(existing.id)).meta?.scheduleToken).not.toBe('old')
  })

  it.each<[PostStatus, Record<string, unknown>]>([
    ['publishing', {}],
    ['unknown', {}],
    ['scheduled', { externalId: 'fb_1' }],
  ])('refuses (409) to reschedule a %s row', async (status, extra) => {
    const existing = await createRow({ status, ...extra })
    const key = (existing as unknown as { idempotencyKey: string }).idempotencyKey
    await expect(schedulePublication(payload, fields(key))).rejects.toMatchObject({
      statusCode: 409,
    })
    expect((await row(existing.id)).status).toBe(status)
  })

  it('returns a published row as already published', async () => {
    const existing = await createRow({ externalId: 'pin_9', status: 'published' })
    const key = (existing as unknown as { idempotencyKey: string }).idempotencyKey
    expect(await schedulePublication(payload, fields(key))).toMatchObject({
      alreadyPublished: true,
      externalId: 'pin_9',
      postId: existing.id,
    })
  })
})

describe('decideRetry (retry endpoint and retry task)', () => {
  const opts = { basePath: '/socials' }
  const post = (status: PostStatus, externalId?: string) =>
    ({ id: 4, externalId, platform: 'facebook', status }) as never

  it.each<[string, PostStatus, string | undefined, string]>([
    ['unknown', 'unknown', undefined, 'its publish outcome is unknown'],
    ['publishing', 'publishing', undefined, 'a publish attempt is in progress or was interrupted'],
    [
      'failed with a platform post id',
      'failed',
      'p1_9',
      'facebook returned a post id for it (p1_9)',
    ],
  ])('refuses a %s post without confirmation', (_label, status, externalId, reason) => {
    const decision = decideRetry(post(status, externalId), opts)
    expect(decision.kind).toBe('refused')
    const message = (decision as { reason: string }).reason
    expect(message).toContain(`social-posts/4 may already be on facebook: ${reason}.`)
    expect(message).toContain('POST /socials/posts/4/resolve')
    expect(message).toContain('"confirmNotPublished": true')
  })

  it('allows a refused post once the operator confirms it is not published', () => {
    expect(decideRetry(post('unknown'), { ...opts, confirmNotPublished: true })).toEqual({
      kind: 'allowed',
    })
  })

  it('allows a failed post with no platform id and reports a published one', () => {
    expect(decideRetry(post('failed'), opts)).toEqual({ kind: 'allowed' })
    expect(decideRetry(post('published', 'p1'), opts)).toEqual({ kind: 'alreadyPublished' })
  })
})

describe('resolveUnknownOutcome', () => {
  it('records a post the operator found on the platform as published', async () => {
    const post = await createRow({ meta: { keep: true }, status: 'unknown' })
    await resolveUnknownOutcome({
      actorId: 7,
      externalId: 'pin_found',
      outcome: 'published',
      payload,
      postId: post.id,
    })
    expect(await row(post.id)).toMatchObject({
      externalId: 'pin_found',
      meta: expect.objectContaining({
        keep: true,
        reconciledBy: 7,
        reconciledOutcome: 'published',
      }),
      status: 'published',
    })
  })

  it('records an absent post as failed, which the task may claim again after a retry', async () => {
    const post = await createRow({ status: 'unknown' })
    await resolveUnknownOutcome({ outcome: 'not-published', payload, postId: post.id })
    const saved = await row(post.id)
    expect(saved.status).toBe('failed')
    expect(decideRetry(saved as never, { basePath: '/socials' })).toEqual({ kind: 'allowed' })
  })

  it('refuses a post whose outcome is known, and requires an id for published', async () => {
    const known = await createRow({ status: 'failed' })
    await expect(
      resolveUnknownOutcome({ outcome: 'not-published', payload, postId: known.id }),
    ).rejects.toMatchObject({ statusCode: 400 })
    const unknown = await createRow({ status: 'unknown' })
    await expect(
      resolveUnknownOutcome({ outcome: 'published', payload, postId: unknown.id }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect((await row(unknown.id)).status).toBe('unknown')
  })
})

describe('cancelQueuedSocialPost', () => {
  it('cancels a queued post and keeps its meta', async () => {
    const post = await createRow({
      meta: { queuedInput: input, scheduleToken: 't' },
      status: 'queued',
    })
    const at = new Date()
    expect(await cancelQueuedSocialPost({ now: at, payload, postId: post.id, userId: 3 })).toEqual({
      postId: post.id,
      status: 'cancelled',
    })
    expect(await row(post.id)).toMatchObject({
      meta: {
        cancelledAt: at.toISOString(),
        cancelledBy: 3,
        queuedInput: input,
        scheduleToken: 't',
      },
      status: 'cancelled',
    })
  })

  it.each<PostStatus>(['published', 'publishing', 'scheduled', 'unknown', 'failed'])(
    'refuses (409) a %s post and leaves it as it was',
    async (status) => {
      const post = await createRow({ status })
      await expect(cancelQueuedSocialPost({ payload, postId: post.id })).rejects.toMatchObject({
        message: expect.stringContaining(`this post is ${status}`),
        statusCode: 409,
      })
      expect((await row(post.id)).status).toBe(status)
    },
  )

  it('refuses a queued post due inside the lead time', async () => {
    const post = await createRow({
      scheduledAt: new Date(now() + 30_000).toISOString(),
      status: 'queued',
    })
    await expect(
      cancelQueuedSocialPost({ minLeadSeconds: 60, payload, postId: post.id }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('due within 60 seconds'),
      statusCode: 409,
    })
    expect((await row(post.id)).status).toBe('queued')
  })

  it('404s a missing post', async () => {
    await expect(cancelQueuedSocialPost({ payload, postId: 999_999 })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('delete guards', () => {
  it.each<PostStatus>(['published', 'publishing', 'unknown'])(
    'allows deleting a %s post',
    async (status) => {
      expect(() =>
        assertDeletable({ externalId: 'x', status } as never, { localOnly: false }),
      ).not.toThrow()
    },
  )

  it.each<PostStatus>(['failed', 'cancelled', 'deleted', 'draft', 'scheduled'])(
    'refuses deleting a %s post',
    (status) => {
      expect(() =>
        assertDeletable({ externalId: 'x', status } as never, { localOnly: true }),
      ).toThrow(/Cannot delete a post with status/)
    },
  )

  it('needs the platform id unless the delete is local only', () => {
    const post = { status: 'published' } as never
    expect(() => assertDeletable(post, { localOnly: false })).toThrow(/without an externalId/)
    expect(() => assertDeletable(post, { localOnly: true })).not.toThrow()
  })

  it('soft-deletes the row, which a later publish takes back', async () => {
    const post = await createRow({ externalId: 'pin_1', meta: { keep: true }, status: 'published' })
    await markDeleted({
      localOnly: true,
      payload,
      post: (await requirePost(payload, post.id)) as never,
      userId: 5,
    })
    expect(await loadPost(payload, post.id)).toMatchObject({
      meta: expect.objectContaining({ deletedBy: 5, deletedLocalOnly: true, keep: true }),
      status: 'deleted',
    })
  })
})

describe('reconcilePublication (publish task, for a post the platform holds)', () => {
  const held = async (data: Record<string, unknown> = {}): Promise<Row> =>
    createRow({
      externalId: `held_${++keyCounter}`,
      nextRetryAt: new Date(now() - 1_000).toISOString(),
      platformPublicationStatus: 'pending',
      status: 'scheduled',
      ...data,
    })

  const reconcile = async (post: Row, verdict: () => Promise<ReconcileVerdict>) => {
    const fake = fakeAdapter(() => Promise.reject(new Error('must not publish')), verdict)
    const attempt = await reconcilePublication({
      adapter: fake.adapter,
      options,
      payload,
      post: (await loadPost(payload, post.id))!,
    })
    expect(fake.publish).not.toHaveBeenCalled()
    return { attempt, reconcile: fake.reconcile! }
  }

  it('records a published verdict', async () => {
    const post = await held()
    const { attempt } = await reconcile(post, async () => ({
      externalUrl: 'https://example.test/live',
      state: 'published',
    }))
    expect(attempt.status).toBe('published')
    expect(await row(post.id)).toMatchObject({
      externalId: post.externalId,
      lastError: null,
      nextRetryAt: null,
      platformPublicationStatus: 'published',
      publishedAt: expect.any(String),
      status: 'published',
    })
  })

  it('records a failed verdict as failed with its id, which no claim takes back', async () => {
    const post = await held({ platformPublicationStatus: 'publishing', status: 'publishing' })
    const { attempt } = await reconcile(post, async () => ({
      reason: 'Rejected by moderation.',
      state: 'failed',
    }))
    expect(attempt.status).toBe('failed')
    const saved = await row(post.id)
    expect(saved).toMatchObject({
      externalId: post.externalId,
      lastError: 'Rejected by moderation.',
      nextRetryAt: null,
      platformPublicationStatus: 'failed',
      status: 'failed',
    })
    expect(await claimForPublish(payload, (await loadPost(payload, post.id))!)).toBe(false)
  })

  it.each([
    ['scheduled', 'pending'],
    ['publishing', 'publishing'],
  ] as const)(
    'keeps a pending %s post as it is, due again at checkAt, with a check queued',
    async (status, platformPublicationStatus) => {
      const post = await held({ status })
      const checkAt = new Date(now() + 5 * 60_000).toISOString()
      const { attempt } = await reconcile(post, async () => ({ checkAt, state: 'pending' }))
      expect(attempt.status).toBe('pending')
      expect(await row(post.id)).toMatchObject({
        nextRetryAt: checkAt,
        platformPublicationStatus,
        status,
      })
      const jobs = await publishJobsFor(post.id)
      expect(jobs).toHaveLength(1)
      expect(Date.parse(jobs[0]?.waitUntil ?? '')).toBe(Date.parse(checkAt))
    },
  )

  it('checks a pending post again in a minute when the verdict names no time', async () => {
    const post = await held()
    const before = now()
    await reconcile(post, pendingVerdict)
    const next = Date.parse((await row(post.id)).nextRetryAt ?? '')
    expect(next).toBeGreaterThanOrEqual(before + 60_000)
    expect(next).toBeLessThanOrEqual(now() + 60_000)
  })

  it('leaves a pending post due when its next check cannot be queued', async () => {
    const post = await held()
    vi.spyOn(payload.jobs, 'queue').mockRejectedValueOnce(new Error('queue down'))
    const checkAt = new Date(now() + 60_000).toISOString()
    const { attempt } = await reconcile(post, async () => ({ checkAt, state: 'pending' }))
    expect(attempt.status).toBe('pending')
    expect((await row(post.id)).nextRetryAt).toBe(checkAt)
    expect(await publishJobsFor(post.id)).toHaveLength(0)
  })

  it('fails the post, keeping its id, when the platform check throws', async () => {
    const post = await held()
    const error = new PlatformApiError({
      message: 'lookup failed',
      platform: 'facebook',
      retryable: true,
      statusCode: 503,
    })
    const { attempt } = await reconcile(post, () => Promise.reject(error))
    expect(attempt).toEqual({ error, status: 'error' })
    expect(await row(post.id)).toMatchObject({
      externalId: post.externalId,
      lastError: expect.stringContaining('lookup failed'),
      status: 'failed',
    })
    const failed = (await loadPost(payload, post.id))!
    expect(await claimForPublish(payload, failed)).toBe(false)
    expect(decideRetry(failed, { basePath: '/socials' }).kind).toBe('refused')
  })

  it('does not ask the platform before the next check is due (a duplicate job)', async () => {
    const post = await held({ nextRetryAt: new Date(now() + 60_000).toISOString() })
    const { attempt, reconcile: check } = await reconcile(post, pendingVerdict)
    expect(attempt).toEqual({ reason: 'notDue', status: 'skipped' })
    expect(check).not.toHaveBeenCalled()
  })

  it('leaves the post to an operator when the adapter cannot reconcile', async () => {
    const post = await held()
    const fake = fakeAdapter(() => Promise.reject(new Error('must not publish')))
    const attempt = await reconcilePublication({
      adapter: fake.adapter,
      options,
      payload,
      post: (await loadPost(payload, post.id))!,
    })
    expect(attempt).toEqual({ reason: 'unsupported', status: 'skipped' })
    expect(fake.publish).not.toHaveBeenCalled()
    expect((await row(post.id)).status).toBe('scheduled')
  })

  it('does not overwrite a row an operator changed while the platform was asked', async () => {
    const post = await held()
    const loaded = (await loadPost(payload, post.id))!
    await markDeleted({ localOnly: true, payload, post: loaded })
    const fake = fakeAdapter(
      () => Promise.reject(new Error('must not publish')),
      async () => ({ state: 'published' }),
    )
    const attempt = await reconcilePublication({
      adapter: fake.adapter,
      options,
      payload,
      post: loaded,
    })
    expect(attempt).toEqual({ reason: 'changed', status: 'skipped' })
    expect((await row(post.id)).status).toBe('deleted')
  })

  it('passes the row’s platform reference, with its destinationId', async () => {
    const post = await held({
      destinationId: 'page_1',
      externalUrl: 'https://example.test/p',
      meta: { pageId: 'page_1', scheduledSeconds: 1_900_000_000 },
    })
    const { reconcile: check } = await reconcile(post, pendingVerdict)
    expect(check.mock.calls[0]?.[0]).toMatchObject({
      publishedRef: {
        externalId: post.externalId,
        externalUrl: 'https://example.test/p',
        meta: { destinationId: 'page_1', pageId: 'page_1', scheduledSeconds: 1_900_000_000 },
        platform: 'pinterest',
      },
    })
  })

  it('refuses a post the platform does not hold', async () => {
    const post = await createRow({ status: 'queued' })
    const loaded = (await loadPost(payload, post.id))!
    expect(awaitsReconciliation(loaded)).toBe(false)
    await expect(
      reconcilePublication({
        adapter: fakeAdapter(() => Promise.reject(new Error('no')), pendingVerdict).adapter,
        options,
        payload,
        post: loaded,
      }),
    ).rejects.toThrow(/only a post the platform holds/)
  })
})

describe('dueForWorkWhere (the sweeps’ one due query)', () => {
  it('matches due queued posts and held posts whose check is due, on any platform', async () => {
    const past = new Date(now() - 60_000).toISOString()
    const future = new Date(now() + 3_600_000).toISOString()
    const ids = {
      heldDue: (await createRow({ externalId: 'x1', nextRetryAt: past, status: 'scheduled' })).id,
      heldLater: (await createRow({ externalId: 'x2', nextRetryAt: future, status: 'scheduled' }))
        .id,
      inFlight: (await createRow({ nextRetryAt: past, status: 'publishing' })).id,
      processingDue: (
        await createRow({ externalId: 'x3', nextRetryAt: past, status: 'publishing' })
      ).id,
      queuedDue: (await createRow({ scheduledAt: past, status: 'queued' })).id,
      queuedLater: (await createRow({ scheduledAt: future, status: 'queued' })).id,
      unknown: (await createRow({ externalId: 'x4', nextRetryAt: past, status: 'unknown' })).id,
    }
    const result = await payload.find({
      collection: 'social-posts' as never,
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      where: dueForWorkWhere() as never,
    })
    const due = new Set(result.docs.map((doc) => (doc as unknown as Row).id))
    expect(
      [...Object.entries(ids)]
        .filter(([, id]) => due.has(id))
        .map(([k]) => k)
        .sort(),
    ).toEqual(['heldDue', 'processingDue', 'queuedDue'])
  })

  it('a claim clears the next check, so an in-flight publish is never due', async () => {
    const post = await createRow({
      nextRetryAt: new Date(now() - 60_000).toISOString(),
      status: 'queued',
    })
    expect(await claimForPublish(payload, (await loadPost(payload, post.id))!)).toBe(true)
    expect(await row(post.id)).toMatchObject({ nextRetryAt: null, status: 'publishing' })
  })
})
