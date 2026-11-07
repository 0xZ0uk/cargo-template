import type { Config, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import {
  _internal_jobSystemGlobals,
  _internal_resetJobSystemGlobals,
  buildConfig,
  getPayload,
} from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * What Payload's real job runner records for the socials tasks (#94).
 *
 * Payload 4 reads only `output` from a handler's result and logs anything
 * returned as succeeded, so these run the jobs through `payload.jobs.run` (via
 * `runQueuedSocialsJobs`) against an in-memory SQLite database and assert the
 * `payload-jobs` row: `hasError`, `error`, `log` and `totalTried`. The platform
 * adapter, source resolver and credential store are mocked: no network.
 */

vi.mock('../server/platforms/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/platforms/registry.js')>()
  return { ...actual, getPlatformAdapter: vi.fn(actual.getPlatformAdapter) }
})
vi.mock('../server/sources/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/sources/registry.js')>()
  return { ...actual, resolveSourceContext: vi.fn(actual.resolveSourceContext) }
})
vi.mock('../server/services/connectionService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/services/connectionService.js')>()
  return {
    ...actual,
    getCredentials: vi.fn(actual.getCredentials),
    saveCredentials: vi.fn(actual.saveCredentials),
  }
})

import payloadPluginSocials, {
  normalizePluginOptions,
  queueSocialConnectionRefresh,
  queueSocialPostPublish,
  queueSocialPostRetry,
  runQueuedSocialsJobs,
} from '../index.js'
import { getPlatformAdapter } from '../server/platforms/registry.js'
import { getCredentials, saveCredentials } from '../server/services/connectionService.js'
import { resolveSourceContext } from '../server/sources/registry.js'
import { PlatformApiError } from '../server/utilities/errors.js'

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
const normalizedOptions = normalizePluginOptions(pluginOptions)

let payload: Payload

beforeAll(async () => {
  const config = await buildConfig({
    collections: [{ slug: 'products', fields: [{ name: 'title', type: 'text' }] }],
    db: sqliteAdapter({ client: { url: ':memory:' }, push: true }) as Config['db'],
    editor: lexicalEditor(),
    // Keep completed jobs so a success can be asserted, not only inferred from deletion.
    jobs: { deleteJobOnComplete: false, tasks: [] },
    plugins: [payloadPluginSocials(pluginOptions)],
    secret: 'test-secret',
  })
  payload = await getPayload({ config })
}, 60_000)

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
})

afterEach(() => {
  _internal_resetJobSystemGlobals()
  // Back to the real implementations the mocks were created with.
  vi.mocked(getPlatformAdapter).mockReset()
  vi.mocked(resolveSourceContext).mockReset()
  vi.mocked(getCredentials).mockReset()
  vi.mocked(saveCredentials).mockReset()
})

type JobRow = {
  waitUntil?: null | string
  error?: { cancelled?: boolean; message?: string } | null
  hasError?: boolean | null
  log?: Array<{ error?: { message?: string }; state: string; taskSlug: string }> | null
  completedAt?: null | string
  totalTried?: null | number
}

type PostRow = { externalId?: null | string; lastError?: null | string; status: string }

let postCounter = 0

const createQueuedPost = async (data: Record<string, unknown> = {}): Promise<number | string> => {
  postCounter++
  const doc = (await payload.create({
    collection: 'social-posts' as never,
    data: {
      idempotencyKey: `key-${postCounter}-`.padEnd(64, '0'),
      meta: { queuedInput: { boardId: 'board' } },
      platform: 'pinterest',
      sourceHash: 'hash',
      sourceId: `src-${postCounter}`,
      sourceKind: 'product',
      status: 'queued',
      ...data,
    } as never,
    overrideAccess: true,
  })) as unknown as { id: number | string }
  return doc.id
}

const findJob = async (id: number | string | undefined): Promise<JobRow> =>
  (await payload.findByID({
    id: id as never,
    collection: 'payload-jobs',
    depth: 0,
    overrideAccess: true,
  })) as unknown as JobRow

const findPost = async (id: number | string): Promise<PostRow> =>
  (await payload.findByID({
    id: id as never,
    collection: 'social-posts' as never,
    depth: 0,
    overrideAccess: true,
  })) as unknown as PostRow

/** Run the queue as a worker would, more times than any task's retries allow. */
const drain = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await runQueuedSocialsJobs(payload, normalizedOptions)
  }
}

/** Move Payload's job clock (it decides which jobs are due), not the process clock. */
const setJobClock = (date: Date): void => {
  _internal_jobSystemGlobals.getCurrentDate = () => new Date(date)
}

const mockAdapterPublish = (publish: ReturnType<typeof vi.fn>) => {
  vi.mocked(resolveSourceContext).mockResolvedValue({} as never)
  vi.mocked(getPlatformAdapter).mockReturnValue({ publish } as never)
}

describe('socials jobs through Payload’s job runner', () => {
  it('records a successful publish as succeeded', async () => {
    const publish = vi.fn().mockResolvedValue({
      externalId: 'pin_1',
      externalUrl: 'https://pin.test/1',
      platform: 'pinterest',
    })
    mockAdapterPublish(publish)
    const postId = await createQueuedPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBeFalsy()
    expect(job.completedAt).toBeTruthy()
    expect(job.totalTried).toBe(1)
    expect(job.log?.map((entry) => entry.state)).toEqual(['succeeded'])
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('records a failed publish as failed, once, without a Payload retry', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('invalid board'))
    mockAdapterPublish(publish)
    const postId = await createQueuedPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.completedAt).toBeFalsy()
    expect(job.error).toMatchObject({ cancelled: true, message: 'invalid board' })
    expect(job.totalTried ?? 0).toBe(0)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(await findPost(postId)).toMatchObject({ lastError: 'invalid board', status: 'failed' })
  })

  it('does not retry a publish whose outcome is unknown', async () => {
    const publish = vi.fn().mockRejectedValue(
      new PlatformApiError({
        message: 'response lost',
        outcome: 'unknown',
        platform: 'pinterest',
        retryable: true,
      }),
    )
    mockAdapterPublish(publish)
    const postId = await createQueuedPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error).toMatchObject({
      cancelled: true,
      message: `social-posts/${postId}: publish outcome unknown; reconcile before retrying`,
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect((await findPost(postId)).status).toBe('unknown')
  })

  it('retries a throttled publish after an exponential backoff, up to the task’s retries', async () => {
    const publish = vi.fn().mockRejectedValue(
      new PlatformApiError({
        message: 'throttled',
        platform: 'pinterest',
        retryable: true,
        safeToRepeat: true,
        statusCode: 429,
      }),
    )
    mockAdapterPublish(publish)
    const postId = await createQueuedPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    let now = new Date()
    setJobClock(now)
    await drain()
    expect(publish).toHaveBeenCalledTimes(1)

    // `retries: { attempts: 3, backoff: exponential 60s }`: each retry waits
    // 1, 2, then 4 minutes, and no drain before then runs it.
    for (const [attempt, delayMs] of [
      [2, 60_000],
      [3, 120_000],
      [4, 240_000],
    ] as const) {
      const pending = await findJob(jobId)
      expect(pending.hasError).toBeFalsy()
      expect(Date.parse(pending.waitUntil ?? '') - now.getTime()).toBe(delayMs)

      setJobClock(new Date(now.getTime() + delayMs - 1_000))
      await drain()
      expect(publish).toHaveBeenCalledTimes(attempt - 1)

      now = new Date(now.getTime() + delayMs + 1)
      setJobClock(now)
      await runQueuedSocialsJobs(payload, normalizedOptions)
      expect(publish).toHaveBeenCalledTimes(attempt)
    }

    await drain()
    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error?.cancelled).toBeFalsy()
    expect(job.totalTried).toBe(4)
    expect(job.log?.map((entry) => entry.state)).toEqual(['failed', 'failed', 'failed', 'failed'])
    expect(publish).toHaveBeenCalledTimes(4)
    expect((await findPost(postId)).status).toBe('failed')
  })

  it('does not retry a retryable error that does not prove nothing was created', async () => {
    // `retryable` alone is not enough: without `safeToRepeat` (set only by the
    // shared classifier), Payload must not re-run a publish.
    const publish = vi
      .fn()
      .mockRejectedValue(
        new PlatformApiError({ message: 'upstream 503', platform: 'pinterest', retryable: true }),
      )
    mockAdapterPublish(publish)
    const postId = await createQueuedPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()
    setJobClock(new Date(Date.now() + 24 * 60 * 60_000))
    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error).toMatchObject({ cancelled: true })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('retries a transient token-refresh failure and succeeds', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ refreshToken: 'RT' } as never)
    vi.mocked(saveCredentials).mockResolvedValue(undefined as never)
    const refreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error('oauth 503'))
      .mockResolvedValue({ accessToken: 'NEW' })
    vi.mocked(getPlatformAdapter).mockReturnValue({ refreshToken } as never)
    const jobId = await queueSocialConnectionRefresh({ payload, platform: 'pinterest' })

    await drain()
    // The retry waits for the backoff.
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(Date.parse((await findJob(jobId)).waitUntil ?? '')).toBeGreaterThan(Date.now())
    setJobClock(new Date(Date.now() + 61_000))
    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBeFalsy()
    expect(job.completedAt).toBeTruthy()
    expect(job.totalTried).toBe(2)
    expect(job.log?.map((entry) => entry.state)).toEqual(['failed', 'succeeded'])
    expect(job.log?.[0]?.error?.message).toBe('connection refresh failed: pinterest: oauth 503')
    expect(refreshToken).toHaveBeenCalledTimes(2)
    expect(saveCredentials).toHaveBeenCalledTimes(1)
  })
})

describe('the publish task’s guards, through Payload’s job runner', () => {
  it.each<[string, Record<string, unknown>, Record<string, unknown>, string | undefined]>([
    [
      'a post another worker is publishing',
      { status: 'publishing' },
      { alreadyInProgress: true },
      undefined,
    ],
    [
      'a job for an older schedule',
      { meta: { queuedInput: { boardId: 'board' }, scheduleToken: 'current' } },
      { staleSchedule: true },
      'stale',
    ],
    [
      'a post not due yet',
      { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() },
      { notDue: true },
      undefined,
    ],
  ])('does nothing for %s', async (_label, data, output, scheduleToken) => {
    const publish = vi.fn()
    mockAdapterPublish(publish)
    const postId = await createQueuedPost(data)
    const status = (await findPost(postId)).status
    const jobId = await queueSocialPostPublish({ payload, postId, scheduleToken })

    await drain()

    const job = (await findJob(jobId)) as JobRow & {
      log?: Array<{ output?: Record<string, unknown> }> | null
    }
    expect(job.hasError).toBeFalsy()
    expect(job.log?.[0]?.output).toMatchObject(output)
    expect(publish).not.toHaveBeenCalled()
    expect((await findPost(postId)).status).toBe(status)
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['a cancelled post', { status: 'cancelled' }, 'post is cancelled'],
    ['a post without its queued input', { meta: {} }, '.meta.queuedInput missing'],
  ])('fails %s without a retry or a platform call', async (_label, data, message) => {
    const publish = vi.fn()
    mockAdapterPublish(publish)
    const postId = await createQueuedPost(data)
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error?.cancelled).toBe(true)
    expect(job.error?.message).toContain(message)
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('the retry task, through Payload’s job runner', () => {
  it('refuses a post whose outcome is unknown and leaves it as it was', async () => {
    const publish = vi.fn()
    mockAdapterPublish(publish)
    const postId = await createQueuedPost({ status: 'unknown' })
    const jobId = await queueSocialPostRetry({ payload, postId })

    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error?.cancelled).toBe(true)
    expect(job.error?.message).toContain('its publish outcome is unknown')
    expect((await findPost(postId)).status).toBe('unknown')
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses a failed post the platform returned an id for', async () => {
    const publish = vi.fn()
    mockAdapterPublish(publish)
    const postId = await createQueuedPost({ externalId: 'pin_rejected', status: 'failed' })
    const jobId = await queueSocialPostRetry({ payload, postId })

    await drain()

    expect((await findJob(jobId)).error?.message).toContain('pinterest returned a post id for it')
    expect(publish).not.toHaveBeenCalled()
  })

  it('re-publishes, once, a post the operator confirmed is not on the platform', async () => {
    const publish = vi.fn().mockResolvedValue({ externalId: 'pin_2', platform: 'pinterest' })
    mockAdapterPublish(publish)
    const postId = await createQueuedPost({ status: 'unknown' })
    const jobId = await queueSocialPostRetry({ confirmNotPublished: true, payload, postId })

    await drain()

    expect((await findJob(jobId)).hasError).toBeFalsy()
    expect(publish).toHaveBeenCalledOnce()
    expect(await findPost(postId)).toMatchObject({ externalId: 'pin_2', status: 'published' })
  })

  it('re-publishes a failed post', async () => {
    const publish = vi.fn().mockResolvedValue({ externalId: 'pin_3', platform: 'pinterest' })
    mockAdapterPublish(publish)
    const postId = await createQueuedPost({ lastError: 'invalid board', status: 'failed' })
    await queueSocialPostRetry({ payload, postId })

    await drain()

    expect(publish).toHaveBeenCalledOnce()
    expect(await findPost(postId)).toMatchObject({ lastError: null, status: 'published' })
  })

  it.each<[string, boolean]>([
    ['rescheduled', false],
    ['retried with confirmNotPublished', true],
  ])(
    'publishes once a failed post with a stale platform id, %s, after a throttled first try',
    async (_label, viaRetry) => {
      const publish = vi
        .fn()
        .mockRejectedValueOnce(
          new PlatformApiError({
            message: 'throttled',
            platform: 'pinterest',
            retryable: true,
            safeToRepeat: true,
            statusCode: 429,
          }),
        )
        .mockResolvedValue({ externalId: 'pin_new', platform: 'pinterest' })
      mockAdapterPublish(publish)
      // A post published before and gone from the platform (or rejected), so
      // its row still holds the earlier publication's id.
      const postId = await createQueuedPost({
        externalId: 'pin_old',
        status: viaRetry ? 'failed' : 'queued',
      })
      const jobId = viaRetry
        ? await queueSocialPostRetry({ confirmNotPublished: true, payload, postId })
        : await queueSocialPostPublish({ payload, postId })

      const now = Date.now()
      setJobClock(new Date(now))
      await drain()
      expect(publish).toHaveBeenCalledTimes(1)
      expect(await findPost(postId)).toMatchObject({ externalId: null, status: 'failed' })

      setJobClock(new Date(now + 24 * 60 * 60_000))
      await drain()

      expect(publish).toHaveBeenCalledTimes(2)
      expect(await publish.mock.results[1]?.value).toMatchObject({ externalId: 'pin_new' })
      expect(await findPost(postId)).toMatchObject({ externalId: 'pin_new', status: 'published' })
      if (!viaRetry) {
        const job = await findJob(jobId)
        expect(job.hasError).toBeFalsy()
        expect(job.log?.map((entry) => entry.state)).toEqual(['failed', 'succeeded'])
      }
    },
  )
})

describe('reconciling a post the platform holds, through Payload’s job runner', () => {
  type JobWithOutput = JobRow & { log?: Array<{ output?: Record<string, unknown> }> | null }

  /** A Facebook post scheduled natively, whose check is due. */
  const createHeldPost = (data: Record<string, unknown> = {}) =>
    createQueuedPost({
      externalId: `page_post_${postCounter + 1}`,
      meta: { pageId: 'page' },
      nextRetryAt: new Date(Date.now() - 1_000).toISOString(),
      platform: 'facebook',
      status: 'scheduled',
      ...data,
    })

  const mockAdapter = (adapter: Record<string, unknown>) => {
    vi.mocked(resolveSourceContext).mockResolvedValue({} as never)
    vi.mocked(getPlatformAdapter).mockReturnValue(adapter as never)
  }

  const publishJobsFor = async (postId: number | string) =>
    (
      await payload.find({
        collection: 'payload-jobs',
        depth: 0,
        limit: 100,
        overrideAccess: true,
        sort: 'createdAt',
        where: { taskSlug: { equals: 'socialPostPublish' } },
      })
    ).docs.filter(
      (job) =>
        String((job.input as { postId?: number | string } | undefined)?.postId) === String(postId),
    ) as unknown as JobWithOutput[]

  it('records the platform’s published verdict without publishing', async () => {
    const publish = vi.fn()
    const reconcile = vi
      .fn()
      .mockResolvedValue({ externalUrl: 'https://fb.test/p', state: 'published' })
    mockAdapter({ publish, reconcile })
    const postId = await createHeldPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    const job = (await findJob(jobId)) as JobWithOutput
    expect(job.hasError).toBeFalsy()
    expect(job.log?.[0]?.output).toMatchObject({ pending: false, reconciled: 'published' })
    expect(reconcile).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    expect(await findPost(postId)).toMatchObject({ status: 'published' })
  })

  it('fails a post whose check throws, without a retry, and never publishes it', async () => {
    const publish = vi.fn()
    // Retryable and even safe to repeat: a reconcile failure is still never retried.
    const reconcile = vi.fn().mockRejectedValue(
      new PlatformApiError({
        message: 'lookup 503',
        platform: 'facebook',
        retryable: true,
        safeToRepeat: true,
        statusCode: 503,
      }),
    )
    mockAdapter({ publish, reconcile })
    const postId = await createHeldPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()
    setJobClock(new Date(Date.now() + 24 * 60 * 60_000))
    await drain()

    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error).toMatchObject({ cancelled: true })
    expect(job.error?.message).toContain('lookup 503')
    expect(reconcile).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    const post = await findPost(postId)
    expect(post.status).toBe('failed')
    expect(post.externalId).toMatch(/^page_post_/)

    // A later publish job for the post (a sweep, a stale job) does not publish it either.
    await queueSocialPostPublish({ payload, postId })
    await drain()
    expect(publish).not.toHaveBeenCalled()
  })

  it('queues the next check of a pending post and runs it when due', async () => {
    const publish = vi.fn()
    const checkAt = new Date(Date.now() + 5 * 60_000)
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({ checkAt: checkAt.toISOString(), state: 'pending' })
      .mockResolvedValue({ state: 'published' })
    mockAdapter({ publish, reconcile })
    const postId = await createHeldPost()
    await queueSocialPostPublish({ payload, postId })

    const now = Date.now()
    setJobClock(new Date(now))
    await drain()
    expect(reconcile).toHaveBeenCalledTimes(1)
    const jobs = await publishJobsFor(postId)
    expect(jobs).toHaveLength(2)
    expect(Date.parse(jobs[1]?.waitUntil ?? '')).toBe(checkAt.getTime())
    expect((await findPost(postId)).status).toBe('scheduled')

    vi.useFakeTimers({ now: checkAt.getTime() + 1_000, toFake: ['Date'] })
    try {
      setJobClock(new Date(checkAt.getTime() + 1_000))
      await drain()
    } finally {
      vi.useRealTimers()
    }
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(publish).not.toHaveBeenCalled()
    expect((await findPost(postId)).status).toBe('published')
  })

  it('does nothing for a held post whose adapter cannot reconcile', async () => {
    const publish = vi.fn()
    mockAdapter({ publish })
    const postId = await createHeldPost({ platform: 'pinterest', status: 'publishing' })
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    const job = (await findJob(jobId)) as JobWithOutput
    expect(job.hasError).toBeFalsy()
    expect(job.log?.[0]?.output).toMatchObject({ reconcileSkipped: 'unsupported' })
    expect(publish).not.toHaveBeenCalled()
    expect((await findPost(postId)).status).toBe('publishing')
  })
})
