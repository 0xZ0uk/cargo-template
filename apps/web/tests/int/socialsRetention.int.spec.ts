import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  FAILED_SOCIAL_POST_RETENTION_DAYS,
  FAILED_SOCIAL_POST_STATUSES,
  FINAL_SOCIAL_POST_STATUSES,
  prunableSocialPostsBefore,
  pruneSocialPosts,
  SOCIAL_POST_RETENTION_DAYS,
} from '@/plugins/socialsRetention'

const NOW = new Date('2026-11-06T12:00:00.000Z')

describe('prunableSocialPostsBefore', () => {
  it('selects finished rows after 90 days and failed rows after 180 days', () => {
    expect(SOCIAL_POST_RETENTION_DAYS).toBe(90)
    expect(FAILED_SOCIAL_POST_RETENTION_DAYS).toBe(180)
    expect(prunableSocialPostsBefore(NOW)).toEqual({
      or: [
        {
          and: [
            { status: { in: ['published', 'cancelled', 'deleted'] } },
            { updatedAt: { less_than: '2026-08-08T12:00:00.000Z' } },
          ],
        },
        {
          and: [
            { status: { in: ['failed'] } },
            { updatedAt: { less_than: '2026-05-10T12:00:00.000Z' } },
          ],
        },
      ],
    })
  })

  it('never selects a row that is in progress or needs an operator', () => {
    const pruned: readonly string[] = [
      ...FINAL_SOCIAL_POST_STATUSES,
      ...FAILED_SOCIAL_POST_STATUSES,
    ]
    for (const status of ['draft', 'queued', 'scheduled', 'publishing', 'unknown']) {
      expect(pruned).not.toContain(status)
    }
  })
})

describe('pruneSocialPosts', () => {
  const fakePayload = (batches: number[][], reclaimed: number[] = []) => {
    const find = vi.fn(async () => ({ docs: (batches.shift() ?? []).map((id) => ({ id })) }))
    // Deletes the requested ids, except the ones in `reclaimed` (left a final status).
    const del = vi.fn(
      async ({ where }: { where: { and: [{ id: { in: number[] } }, unknown] } }) => ({
        docs: where.and[0].id.in.filter((id) => !reclaimed.includes(id)).map((id) => ({ id })),
        errors: [],
      }),
    )
    return { del, find, payload: { delete: del, find } as unknown as Payload }
  }

  it('deletes the selected rows by id and the same filter, as the system', async () => {
    const { del, find, payload } = fakePayload([[1, 2, 3]])

    expect(await pruneSocialPosts(payload, { batchSize: 10, now: NOW })).toBe(3)

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'social-posts',
        limit: 10,
        overrideAccess: true,
        where: prunableSocialPostsBefore(NOW),
      }),
    )
    expect(del).toHaveBeenCalledWith({
      collection: 'social-posts',
      overrideAccess: true,
      where: { and: [{ id: { in: [1, 2, 3] } }, prunableSocialPostsBefore(NOW)] },
    })
  })

  it("keeps a row reclaimed between the find and the delete, and doesn't count it", async () => {
    const { payload } = fakePayload([[1, 2, 3]], [2])

    expect(await pruneSocialPosts(payload, { batchSize: 10, now: NOW })).toBe(2)
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
