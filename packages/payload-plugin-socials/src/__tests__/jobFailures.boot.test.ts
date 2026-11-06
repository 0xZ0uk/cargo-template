import type { Config, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload } from 'payload'
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
  // Back to the real implementations the mocks were created with.
  vi.mocked(getPlatformAdapter).mockReset()
  vi.mocked(resolveSourceContext).mockReset()
  vi.mocked(getCredentials).mockReset()
  vi.mocked(saveCredentials).mockReset()
})

type JobRow = {
  error?: { cancelled?: boolean; message?: string } | null
  hasError?: boolean | null
  log?: Array<{ error?: { message?: string }; state: string; taskSlug: string }> | null
  completedAt?: null | string
  totalTried?: null | number
}

type PostRow = { lastError?: null | string; status: string }

let postCounter = 0

const createQueuedPost = async (): Promise<number | string> => {
  postCounter++
  const doc = (await payload.create({
    collection: 'social-posts' as never,
    data: {
      idempotencyKey: `key-${postCounter}`.padEnd(64, '0'),
      meta: { queuedInput: { boardId: 'board' } },
      platform: 'pinterest',
      sourceHash: 'hash',
      sourceId: `src-${postCounter}`,
      sourceKind: 'product',
      status: 'queued',
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

  it('retries a publish the provider rejected retryably, up to the task’s retries', async () => {
    const publish = vi
      .fn()
      .mockRejectedValue(
        new PlatformApiError({ message: 'throttled', platform: 'pinterest', retryable: true }),
      )
    mockAdapterPublish(publish)
    const postId = await createQueuedPost()
    const jobId = await queueSocialPostPublish({ payload, postId })

    await drain()

    // `retries: 3`: the first attempt and three retries, each re-claiming the `failed` row.
    const job = await findJob(jobId)
    expect(job.hasError).toBe(true)
    expect(job.error?.cancelled).toBeFalsy()
    expect(job.totalTried).toBe(4)
    expect(job.log?.map((entry) => entry.state)).toEqual(['failed', 'failed', 'failed', 'failed'])
    expect(publish).toHaveBeenCalledTimes(4)
    expect((await findPost(postId)).status).toBe('failed')
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
