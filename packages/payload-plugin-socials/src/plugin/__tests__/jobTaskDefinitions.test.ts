import type { PayloadRequest } from 'payload'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalizedPluginOptions } from '../../types/index.js'

import {
  classifyRequestFailure,
  PlatformApiError,
  PublicationPersistenceError,
} from '../../server/utilities/errors.js'

vi.mock('../../server/platforms/registry.js', () => ({ getPlatformAdapter: vi.fn() }))
vi.mock('../../server/sources/registry.js', () => ({ resolveSourceContext: vi.fn() }))
vi.mock('../jobQueue.js', () => ({ queueSocialPostPublish: vi.fn() }))
vi.mock('../../server/services/connectionService.js', () => ({
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
}))

import { getPlatformAdapter } from '../../server/platforms/registry.js'
import { getCredentials, saveCredentials } from '../../server/services/connectionService.js'
import { resolveSourceContext } from '../../server/sources/registry.js'
import { queueSocialPostPublish } from '../jobQueue.js'
import {
  SocialsTaskFailure,
  buildConnectionRefreshTaskConfig,
  buildInsightsRefreshTaskConfig,
  buildPublishTaskConfig,
  buildRetryTaskConfig,
  buildSweepTaskConfig,
  setPluginOptionsForTasks,
} from '../jobTaskDefinitions.js'

const options = {
  api: { basePath: '/socials' },
  platforms: {
    facebook: { enabled: true },
    gbp: { enabled: true },
    instagram: { enabled: true },
    pinterest: { enabled: true },
  },
  rateLimit: { maxConcurrency: 4 },
  scheduling: {
    connectionRefreshWindowSeconds: 86_400,
    insightsRefreshWindowSeconds: 2_592_000,
    sweepBatchSize: 100,
  },
} as unknown as NormalizedPluginOptions

const mkReq = (payload: Record<string, unknown>): PayloadRequest => {
  const req = { payload: { logger: undefined, ...payload } } as unknown as PayloadRequest
  setPluginOptionsForTasks(req.payload, options)
  return req
}

const publish = buildPublishTaskConfig().handler
const retry = buildRetryTaskConfig().handler
const insights = buildInsightsRefreshTaskConfig().handler
const connectionRefresh = buildConnectionRefreshTaskConfig().handler
const sweep = buildSweepTaskConfig().handler

beforeEach(() => {
  vi.clearAllMocks()
})

/** A handled failure: Payload marks the job failed without applying `retries`. */
const expectHandledFailure = async (promise: Promise<unknown>, message: string) => {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(SocialsTaskFailure)
  expect((error as Error).message).toBe(message)
}

describe('socialPostPublish handler', () => {
  it('fails when the post is missing', async () => {
    const req = mkReq({ findByID: vi.fn().mockRejectedValue(new Error('nf')) })
    await expectHandledFailure(publish({ input: { postId: 1 }, req }), 'social-posts/1 not found')
  })

  it('is a no-op when already published', async () => {
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({ id: 1, externalId: 'pin_1', status: 'published' }),
    })
    const result = await publish({ input: { postId: 1 }, req })
    expect(result).toEqual({ output: { alreadyPublished: true, externalId: 'pin_1', postId: 1 } })
  })

  it('fails a cancelled post', async () => {
    const req = mkReq({ findByID: vi.fn().mockResolvedValue({ id: 1, status: 'cancelled' }) })
    await expectHandledFailure(publish({ input: { postId: 1 }, req }), 'post is cancelled')
  })

  it('fails and marks the post when queuedInput is missing', async () => {
    const update = vi.fn().mockResolvedValue({})
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({ id: 1, meta: {}, status: 'queued' }),
      update,
    })
    await expectHandledFailure(
      publish({ input: { postId: 1 }, req }),
      'social-posts/1.meta.queuedInput missing',
    )
    expect(update).toHaveBeenCalled()
  })

  it('ignores a stale schedule token without claiming or publishing', async () => {
    const adapterPublish = vi.fn()
    vi.mocked(getPlatformAdapter).mockReturnValue({ publish: adapterPublish } as never)
    const update = vi.fn()
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: {}, scheduleToken: 'current' },
        platform: 'pinterest',
        status: 'queued',
      }),
      update,
    })
    expect(await publish({ input: { postId: 1, scheduleToken: 'stale' }, req })).toEqual({
      output: { postId: 1, staleSchedule: true },
    })
    expect(update).not.toHaveBeenCalled()
    expect(adapterPublish).not.toHaveBeenCalled()
  })

  it('does not claim a scheduled post before its current due time', async () => {
    const update = vi.fn()
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: {} },
        platform: 'pinterest',
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        status: 'queued',
      }),
      update,
    })
    expect(await publish({ input: { postId: 1 }, req })).toEqual({
      output: { notDue: true, postId: 1 },
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('fails when the source context cannot be resolved', async () => {
    vi.mocked(resolveSourceContext).mockRejectedValue(new Error('no resolver'))
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 1 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })
    await expectHandledFailure(publish({ input: { postId: 1 }, req }), 'no resolver')
    expect(update).toHaveBeenCalled()
  })

  it('publishes and returns the external ref on success', async () => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    const adapterPublish = vi
      .fn()
      .mockResolvedValue({ externalId: 'pin_1', externalUrl: 'https://p' })
    vi.mocked(getPlatformAdapter).mockReturnValue({ publish: adapterPublish } as never)
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 9,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update: vi.fn().mockResolvedValue({ docs: [{ id: 9 }], errors: [] }),
    })
    const result = await publish({ input: { postId: 9 }, req })
    expect(result).toEqual({ output: { externalId: 'pin_1', externalUrl: 'https://p', postId: 9 } })
    expect(adapterPublish).toHaveBeenCalled()
  })

  it('marks the post failed when the adapter publish throws, without a task retry', async () => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    vi.mocked(getPlatformAdapter).mockReturnValue({
      publish: vi.fn().mockRejectedValue(new Error('upstream 500')),
    } as never)
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 1 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })
    await expectHandledFailure(publish({ input: { postId: 1 }, req }), 'upstream 500')
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: 'upstream 500', status: 'failed' }),
      }),
    )
  })

  it('throws a retryable error when the provider rejected the publish retryably', async () => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    vi.mocked(getPlatformAdapter).mockReturnValue({
      publish: vi.fn().mockRejectedValue(
        new PlatformApiError({
          message: 'throttled',
          platform: 'pinterest',
          retryable: true,
          safeToRepeat: true,
        }),
      ),
    } as never)
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 1 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })
    const error = await publish({ input: { postId: 1 }, req }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(SocialsTaskFailure)
    expect((error as Error).message).toBe('payload-plugin-socials: throttled')
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    )
  })

  it.each([
    ['a retryable error that does not prove nothing was created', { retryable: true }],
    ['a 5xx on the creating request', classifyRequestFailure({ effect: 'create', status: 503 })],
    ['a timeout on the creating request', classifyRequestFailure({ effect: 'create' })],
  ])('never lets Payload retry %s', async (_label, flags) => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    vi.mocked(getPlatformAdapter).mockReturnValue({
      publish: vi
        .fn()
        .mockRejectedValue(
          new PlatformApiError({ message: 'upstream', platform: 'pinterest', ...flags }),
        ),
    } as never)
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 1 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })
    const error = await publish({ input: { postId: 1 }, req }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SocialsTaskFailure)
  })

  it('records an unknown provider outcome and suppresses automatic task retry', async () => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    vi.mocked(getPlatformAdapter).mockReturnValue({
      publish: vi.fn().mockRejectedValue(
        new PlatformApiError({
          message: 'response lost',
          outcome: 'unknown',
          platform: 'pinterest',
        }),
      ),
    } as never)
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 1 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })
    await expectHandledFailure(
      publish({ input: { postId: 1 }, req }),
      'social-posts/1: publish outcome unknown; reconcile before retrying',
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'unknown' }),
      }),
    )
  })

  it('captures a provider id after audit persistence fails and suppresses task retry', async () => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    vi.mocked(getPlatformAdapter).mockReturnValue({
      publish: vi.fn().mockRejectedValue(
        new PublicationPersistenceError(
          {
            externalId: 'pin_created',
            meta: { boardId: 'b' },
            platform: 'pinterest',
          },
          new Error('database unavailable'),
        ),
      ),
    } as never)
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 1 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 1,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })

    await expectHandledFailure(
      publish({ input: { postId: 1 }, req }),
      'social-posts/1: publish outcome unknown; reconcile before retrying',
    )
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalId: 'pin_created', status: 'unknown' }),
      }),
    )
  })

  it('does not publish when another worker already claimed the row', async () => {
    const adapterPublish = vi.fn()
    vi.mocked(getPlatformAdapter).mockReturnValue({ publish: adapterPublish } as never)
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 8,
        meta: { queuedInput: { boardId: 'b' } },
        platform: 'pinterest',
        sourceId: 's',
        sourceKind: 'product',
        status: 'queued',
      }),
      update: vi.fn().mockResolvedValue({ docs: [], errors: [] }),
    })
    expect(await publish({ input: { postId: 8 }, req })).toEqual({
      output: { alreadyInProgress: true, postId: 8 },
    })
    expect(adapterPublish).not.toHaveBeenCalled()
  })

  it('regression: proceeds past claim and calls adapter.publish when bulk update returns real BulkOperationResult with docs', async () => {
    vi.mocked(resolveSourceContext).mockResolvedValue({ images: [] } as never)
    const adapterPublish = vi
      .fn()
      .mockResolvedValue({ externalId: 'ext_42', externalUrl: 'https://social/42' })
    vi.mocked(getPlatformAdapter).mockReturnValue({ publish: adapterPublish } as never)
    const update = vi.fn().mockResolvedValue({ docs: [{ id: 42 }], errors: [] })
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({
        id: 42,
        meta: { queuedInput: { boardId: 'b', text: 'Hello' } },
        platform: 'pinterest',
        sourceId: 'src_1',
        sourceKind: 'product',
        status: 'queued',
      }),
      update,
    })
    const result = await publish({ input: { postId: 42 }, req })
    expect(adapterPublish).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      output: { externalId: 'ext_42', externalUrl: 'https://social/42', postId: 42 },
    })
  })
})

describe('socialPostRetry handler', () => {
  it('fails when the post is missing', async () => {
    const req = mkReq({ findByID: vi.fn().mockResolvedValue(null) })
    await expectHandledFailure(retry({ input: { postId: 1 }, req }), 'social-posts/1 not found')
  })

  it('throws a retryable error when the row cannot be re-queued', async () => {
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({ id: 4, status: 'failed' }),
      update: vi.fn().mockRejectedValue(new Error('db down')),
    })
    const error = await retry({ input: { postId: 4 }, req }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(SocialsTaskFailure)
    expect(queueSocialPostPublish).not.toHaveBeenCalled()
  })

  it('is a no-op when already published', async () => {
    const req = mkReq({ findByID: vi.fn().mockResolvedValue({ id: 1, status: 'published' }) })
    expect(await retry({ input: { postId: 1 }, req })).toEqual({
      output: { alreadyPublished: true, postId: 1 },
    })
  })

  it.each([
    [
      'unknown',
      { id: 4, platform: 'facebook', status: 'unknown' },
      'its publish outcome is unknown',
    ],
    [
      'publishing',
      { id: 4, platform: 'facebook', status: 'publishing' },
      'a publish attempt is in progress or was interrupted',
    ],
    [
      'failed with a platform post id',
      { externalId: 'p1_9', id: 4, platform: 'facebook', status: 'failed' },
      'facebook returned a post id for it (p1_9)',
    ],
  ])('refuses to re-publish a %s post without confirmation', async (_label, post, reason) => {
    const update = vi.fn()
    const req = mkReq({ findByID: vi.fn().mockResolvedValue(post), update })
    const error = await retry({ input: { postId: 4 }, req }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SocialsTaskFailure)
    expect((error as Error).message).toContain(
      `social-posts/4 may already be on facebook: ${reason}.`,
    )
    expect((error as Error).message).toContain('POST /socials/posts/4/resolve')
    expect((error as Error).message).toContain('"confirmNotPublished": true')
    expect(update).not.toHaveBeenCalled()
    expect(queueSocialPostPublish).not.toHaveBeenCalled()
  })

  it('re-queues an unknown post the operator confirmed is not published', async () => {
    const update = vi.fn().mockResolvedValue({})
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({ id: 4, platform: 'facebook', status: 'unknown' }),
      update,
    })
    const result = await retry({ input: { confirmNotPublished: true, postId: 4 }, req })
    expect(result).toEqual({ output: { postId: 4, requeued: true } })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'queued' }) }),
    )
    expect(queueSocialPostPublish).toHaveBeenCalled()
  })

  it('re-queues a failed post', async () => {
    const update = vi.fn().mockResolvedValue({})
    const req = mkReq({
      findByID: vi.fn().mockResolvedValue({ id: 4, status: 'failed' }),
      update,
    })
    const result = await retry({ input: { postId: 4 }, req })
    expect(result).toEqual({ output: { postId: 4, requeued: true } })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'queued' }) }),
    )
    expect(queueSocialPostPublish).toHaveBeenCalled()
  })
})

describe('socialInsightsRefresh handler', () => {
  it('refreshes posts with an external id and skips those without', async () => {
    vi.mocked(getPlatformAdapter).mockReturnValue({
      getInsights: vi.fn().mockResolvedValue({ impressions: 5 }),
    } as never)
    const update = vi.fn().mockResolvedValue({})
    const find = vi.fn().mockResolvedValue({
      docs: [
        { id: 1, externalId: 'pin_1' },
        { id: 2, externalId: null },
      ],
    })
    const req = mkReq({ find, update })
    const result = await insights({ input: { platform: 'pinterest' }, req })
    expect(result.output.summaries).toEqual([
      { failed: 0, platform: 'pinterest', refreshed: 1, skipped: 1 },
    ])
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('keeps a partial refresh a success and throws when nothing refreshed', async () => {
    const getInsights = vi
      .fn()
      .mockResolvedValueOnce({ impressions: 5 })
      .mockRejectedValueOnce(new Error('upstream 500'))
    vi.mocked(getPlatformAdapter).mockReturnValue({ getInsights } as never)
    const find = vi.fn().mockResolvedValue({
      docs: [
        { id: 1, externalId: 'pin_1' },
        { id: 2, externalId: 'pin_2' },
      ],
    })
    const req = mkReq({ find, update: vi.fn().mockResolvedValue({}) })
    const partial = await insights({ input: { platform: 'pinterest' }, req })
    expect(partial.output.summaries[0]).toMatchObject({ failed: 1, refreshed: 1 })

    getInsights.mockReset().mockRejectedValue(new Error('upstream 500'))
    const error = await insights({ input: { platform: 'pinterest' }, req }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(SocialsTaskFailure)
    expect((error as Error).message).toContain('2 failed, 0 refreshed')
  })

  it('skips a platform whose adapter has no getInsights', async () => {
    vi.mocked(getPlatformAdapter).mockReturnValue({} as never)
    const req = mkReq({ find: vi.fn() })
    const result = await insights({ input: { platform: 'facebook' }, req })
    expect(result.output.summaries[0]).toMatchObject({ refreshed: 0 })
  })
})

describe('socialConnectionRefresh handler', () => {
  it('refreshes a token that is about to expire', async () => {
    vi.mocked(getCredentials).mockResolvedValue({
      accessToken: 'AT',
      accessTokenExpiresAt: new Date(Date.now() + 1000).toISOString(),
      refreshToken: 'RT',
    } as never)
    const refreshToken = vi.fn().mockResolvedValue({ accessToken: 'NEW', refreshToken: 'NRT' })
    vi.mocked(getPlatformAdapter).mockReturnValue({ refreshToken } as never)
    const req = mkReq({})
    const result = await connectionRefresh({ input: { platform: 'pinterest' }, req })
    expect(result.output.refreshed).toEqual([{ platform: 'pinterest', refreshed: true }])
    expect(saveCredentials).toHaveBeenCalled()
  })

  it('skips a token with plenty of time left', async () => {
    vi.mocked(getCredentials).mockResolvedValue({
      accessToken: 'AT',
      accessTokenExpiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      refreshToken: 'RT',
    } as never)
    const result = await connectionRefresh({ input: { platform: 'pinterest' }, req: mkReq({}) })
    expect(result.output.refreshed).toEqual([{ platform: 'pinterest', refreshed: false }])
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('refreshes legacy credentials that have no access-token expiry', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ refreshToken: 'RT' } as never)
    const refreshToken = vi.fn().mockResolvedValue({ accessToken: 'NEW' })
    vi.mocked(getPlatformAdapter).mockReturnValue({ refreshToken } as never)
    const result = await connectionRefresh({ input: { platform: 'pinterest' }, req: mkReq({}) })
    expect(result.output.refreshed).toEqual([{ platform: 'pinterest', refreshed: true }])
    expect(refreshToken).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'RT' }))
  })

  it('throws a retryable error when a token refresh fails', async () => {
    vi.mocked(getCredentials).mockResolvedValue({ refreshToken: 'RT' } as never)
    vi.mocked(getPlatformAdapter).mockReturnValue({
      refreshToken: vi.fn().mockRejectedValue(new Error('oauth 503')),
    } as never)
    const error = await connectionRefresh({
      input: { platform: 'pinterest' },
      req: mkReq({}),
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(SocialsTaskFailure)
    expect((error as Error).message).toBe('connection refresh failed: pinterest: oauth 503')
  })

  it('reports not-refreshed when there are no credentials', async () => {
    vi.mocked(getCredentials).mockResolvedValue(null)
    const result = await connectionRefresh({ input: { platform: 'gbp' }, req: mkReq({}) })
    expect(result.output.refreshed).toEqual([{ platform: 'gbp', refreshed: false }])
  })
})

describe('socialPostSweep handler', () => {
  it('queues a publish task for each due post', async () => {
    const find = vi.fn().mockResolvedValue({ docs: [{ id: 1 }, { id: 2 }] })
    const result = await sweep({ input: {}, req: mkReq({ find }) })
    expect(result.output).toEqual({ queued: 2, scanned: 2 })
    expect(queueSocialPostPublish).toHaveBeenCalledTimes(2)
  })

  it('reports partial queue failures and throws when none could be queued', async () => {
    const find = vi.fn().mockResolvedValue({ docs: [{ id: 1 }, { id: 2 }] })
    vi.mocked(queueSocialPostPublish)
      .mockResolvedValueOnce(10)
      .mockRejectedValueOnce(new Error('db down'))
    expect((await sweep({ input: {}, req: mkReq({ find }) })).output).toEqual({
      failed: 1,
      queued: 1,
      scanned: 2,
    })
    vi.mocked(queueSocialPostPublish).mockRejectedValue(new Error('db down'))
    await expect(sweep({ input: {}, req: mkReq({ find }) })).rejects.toThrow(
      'sweep could not queue any of 2 due posts',
    )
  })
})
