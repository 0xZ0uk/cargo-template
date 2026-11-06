import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  FINAL_SOCIAL_POST_STATUSES,
  finishedSocialPostsBefore,
  pruneSocialPosts,
  SOCIAL_POST_RETENTION_DAYS,
} from '@/plugins/socialsRetention'

const NOW = new Date('2026-11-06T12:00:00.000Z')

describe('finishedSocialPostsBefore', () => {
  it('selects final statuses last updated more than 90 days ago', () => {
    expect(SOCIAL_POST_RETENTION_DAYS).toBe(90)
    expect(finishedSocialPostsBefore(NOW)).toEqual({
      and: [
        { status: { in: ['published', 'cancelled', 'deleted'] } },
        { updatedAt: { less_than: '2026-08-08T12:00:00.000Z' } },
      ],
    })
  })

  it('takes the window in days', () => {
    expect(finishedSocialPostsBefore(NOW, 1)).toMatchObject({
      and: [expect.anything(), { updatedAt: { less_than: '2026-11-05T12:00:00.000Z' } }],
    })
  })

  it('never selects a row that can still be retried, swept or resolved', () => {
    for (const status of ['draft', 'queued', 'scheduled', 'publishing', 'unknown', 'failed']) {
      expect(FINAL_SOCIAL_POST_STATUSES).not.toContain(status)
    }
  })
})

describe('pruneSocialPosts', () => {
  const fakePayload = (batches: number[][]) => {
    const find = vi.fn(async () => ({ docs: (batches.shift() ?? []).map((id) => ({ id })) }))
    const del = vi.fn(async () => ({ docs: [], errors: [] }))
    return { del, find, payload: { delete: del, find } as unknown as Payload }
  }

  it('deletes the selected rows by id, as the system', async () => {
    const { del, find, payload } = fakePayload([[1, 2, 3]])

    expect(await pruneSocialPosts(payload, { batchSize: 10, now: NOW })).toBe(3)

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'social-posts',
        limit: 10,
        overrideAccess: true,
        where: finishedSocialPostsBefore(NOW),
      }),
    )
    expect(del).toHaveBeenCalledWith({
      collection: 'social-posts',
      overrideAccess: true,
      where: { id: { in: [1, 2, 3] } },
    })
  })

  it('does nothing when no row is old enough', async () => {
    const { del, payload } = fakePayload([[]])

    expect(await pruneSocialPosts(payload, { now: NOW })).toBe(0)
    expect(del).not.toHaveBeenCalled()
  })

  it('continues while batches are full, up to maxBatches', async () => {
    const { del, find, payload } = fakePayload([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ])

    expect(await pruneSocialPosts(payload, { batchSize: 2, maxBatches: 3, now: NOW })).toBe(6)
    expect(find).toHaveBeenCalledTimes(3)
    expect(del).toHaveBeenCalledTimes(3)
  })

  it('stops after a short batch', async () => {
    const { find, payload } = fakePayload([[1, 2], [3], [4, 5]])

    expect(await pruneSocialPosts(payload, { batchSize: 2, maxBatches: 5, now: NOW })).toBe(3)
    expect(find).toHaveBeenCalledTimes(2)
  })
})
