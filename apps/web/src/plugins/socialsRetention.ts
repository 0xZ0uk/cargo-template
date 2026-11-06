import type { Payload, Where } from 'payload'

/**
 * Finished `social-posts`, deleted 90 days after their last update. Not strictly terminal:
 * publishing the same content again reclaims a `cancelled` or `deleted` row (the plugin's
 * `reservePublication`) and moves it back to `publishing`, so the delete re-checks status and
 * age. Deleting a `published` row also drops the plugin's "already published" check, so the
 * same image can be pinned to the same board again after that; that's accepted.
 */
export const FINAL_SOCIAL_POST_STATUSES = ['published', 'cancelled', 'deleted'] as const

/** Finished rows are deleted this many days after their last update. */
export const SOCIAL_POST_RETENTION_DAYS = 90

/**
 * `failed` rows are kept twice as long: the plugin can still retry or reclaim them, and an
 * operator may want to see why a post never went out. A row reclaimed in the meantime is back
 * in `publishing` with a fresh `updatedAt`, so it isn't selected.
 */
export const FAILED_SOCIAL_POST_STATUSES = ['failed'] as const
export const FAILED_SOCIAL_POST_RETENTION_DAYS = 180

const DAY_MS = 24 * 60 * 60 * 1000

const olderThan = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString()

/**
 * Rows past their retention window: finished rows last updated more than 90 days before `now`,
 * failed rows more than 180 days before. `draft`, `queued`, `scheduled`, `publishing` and
 * `unknown` are never pruned: they are still in progress or need an operator to resolve them.
 */
export const prunableSocialPostsBefore = (now: Date): Where => ({
  or: [
    {
      and: [
        { status: { in: [...FINAL_SOCIAL_POST_STATUSES] } },
        { updatedAt: { less_than: olderThan(now, SOCIAL_POST_RETENTION_DAYS) } },
      ],
    },
    {
      and: [
        { status: { in: [...FAILED_SOCIAL_POST_STATUSES] } },
        { updatedAt: { less_than: olderThan(now, FAILED_SOCIAL_POST_RETENTION_DAYS) } },
      ],
    },
  ],
})

/**
 * Deletes `social-posts` past their retention window, `batchSize` rows at a time, for at most
 * `maxBatches` batches (a cron run has a CPU budget; the next run continues). Returns how many
 * rows were deleted.
 *
 * Runs in the app's Cron Trigger, so it bypasses the collection's access rules (nobody can
 * delete posts through the API).
 */
export const pruneSocialPosts = async (
  payload: Payload,
  {
    batchSize = 50,
    maxBatches = 5,
    now = new Date(),
  }: {
    batchSize?: number
    maxBatches?: number
    now?: Date
  } = {},
): Promise<number> => {
  const where = prunableSocialPostsBefore(now)
  let deleted = 0

  for (let batch = 0; batch < maxBatches; batch++) {
    const { docs } = await payload.find({
      collection: 'social-posts',
      depth: 0,
      limit: batchSize,
      overrideAccess: true,
      select: { status: true },
      sort: 'updatedAt',
      where,
    })
    if (docs.length === 0) break

    // Re-check the filter: a row reclaimed since the find (back to `publishing`) must stay.
    const result = await payload.delete({
      collection: 'social-posts',
      overrideAccess: true,
      where: { and: [{ id: { in: docs.map((doc) => doc.id) } }, where] },
    })
    deleted += result.docs.length
    if (docs.length < batchSize) break
  }

  return deleted
}
