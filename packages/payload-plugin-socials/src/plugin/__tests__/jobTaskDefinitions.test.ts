import type { PayloadRequest } from 'payload'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalizedPluginOptions } from '../../types/index.js'

vi.mock('../../server/platforms/registry.js', () => ({ getPlatformAdapter: vi.fn() }))
vi.mock('../jobQueue.js', () => ({ sweepDueSocialPosts: vi.fn() }))
vi.mock('../../server/services/connectionService.js', () => ({
  getCredentials: vi.fn(),
  saveCredentials: vi.fn(),
}))

import { getPlatformAdapter } from '../../server/platforms/registry.js'
import { getCredentials, saveCredentials } from '../../server/services/connectionService.js'
import { sweepDueSocialPosts } from '../jobQueue.js'
import {
  SocialsTaskFailure,
  buildConnectionRefreshTaskConfig,
  buildInsightsRefreshTaskConfig,
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

const insights = buildInsightsRefreshTaskConfig().handler
const connectionRefresh = buildConnectionRefreshTaskConfig().handler
const sweep = buildSweepTaskConfig().handler

beforeEach(() => {
  vi.clearAllMocks()
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
    const error = await insights({ input: { platform: 'pinterest' }, req }).catch((e: unknown) => e)
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
  it('runs sweepDueSocialPosts, with its limit override', async () => {
    vi.mocked(sweepDueSocialPosts).mockResolvedValue({ failed: 0, queued: 2, scanned: 2 })
    const req = mkReq({})
    const result = await sweep({ input: { limit: 7 }, req })
    expect(result.output).toEqual({ queued: 2, scanned: 2 })
    expect(sweepDueSocialPosts).toHaveBeenCalledWith(req.payload, options, req, { limit: 7 })
  })

  it('reports partial queue failures and throws when none could be queued', async () => {
    vi.mocked(sweepDueSocialPosts).mockResolvedValueOnce({ failed: 1, queued: 1, scanned: 2 })
    expect((await sweep({ input: {}, req: mkReq({}) })).output).toEqual({
      failed: 1,
      queued: 1,
      scanned: 2,
    })
    vi.mocked(sweepDueSocialPosts).mockResolvedValueOnce({ failed: 2, queued: 0, scanned: 2 })
    await expect(sweep({ input: {}, req: mkReq({}) })).rejects.toThrow(
      'sweep could not queue any of 2 due posts',
    )
  })
})
