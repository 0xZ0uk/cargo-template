import type { Payload } from 'payload'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../plugin/jobQueue.js', () => ({ queueSocialPostPublish: vi.fn() }))
vi.mock('../../utilities/logger.js', () => ({ logAsyncOperationFailure: vi.fn() }))

import { queueSocialPostPublish } from '../../../plugin/jobQueue.js'
import { logAsyncOperationFailure } from '../../utilities/logger.js'
import { queueReconciliationCheck } from '../publicationReconciliation.js'

const payload = {} as Payload
const checkAt = '2026-07-20T12:05:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(queueSocialPostPublish).mockResolvedValue('job-1')
})

describe('queueReconciliationCheck', () => {
  it('queues a publish job for the post, held until checkAt', async () => {
    await expect(queueReconciliationCheck({ checkAt, payload, postId: 42 })).resolves.toBe('job-1')
    expect(queueSocialPostPublish).toHaveBeenCalledWith({
      payload,
      postId: 42,
      req: undefined,
      scheduledAt: checkAt,
    })
  })

  it('logs a queue failure and leaves the sweep as the fallback', async () => {
    const error = new Error('queue unavailable')
    vi.mocked(queueSocialPostPublish).mockRejectedValue(error)

    await expect(
      queueReconciliationCheck({ checkAt, payload, postId: 'post-1' }),
    ).resolves.toBeUndefined()
    expect(logAsyncOperationFailure).toHaveBeenCalledWith(
      payload,
      'socials.publication.reconciliation.queue',
      error,
    )
  })
})
