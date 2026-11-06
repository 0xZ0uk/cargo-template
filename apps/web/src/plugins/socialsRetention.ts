import type { Payload, Where } from 'payload'

/**
 * Finished `social-posts`. Not strictly terminal: publishing the same content again reclaims
 * a `cancelled` or `deleted` row (the plugin's `reservePublication`) and moves it back to
 * `publishing`, so the delete re-checks status and age. `draft`, `queued`, `scheduled`,
 * `publishing`, `unknown` and `failed` stay: they can still be retried, swept or need an
 * operator to resolve them.
 */
export const FINAL_SOCIAL_POST_STATUSES = ['published', 'cancelled', 'deleted'] as const

/** Finished rows are deleted this many days after their last update. */
export const SOCIAL_POST_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/** Rows in a final status whose last update is older than `days` days before `now`. */
export const finishedSocialPostsBefore = (now: Date, days = SOCIAL_POST_RETENTION_DAYS): Where => ({
  and: [
    { status: { in: [...FINAL_SOCIAL_POST_STATUSES] } },
    { updatedAt: { less_than: new Date(now.getTime() - days * DAY_MS).toISOString() } },
  ],
})

/**
 * Deletes finished `social-posts` past the retention window, `batchSize` rows at a time, for
 * at most `maxBatches` batches (a cron run has a CPU budget; the next run continues).
 * Returns how many rows were deleted.
 *
 * Runs in the app's Cron Trigger, so it bypasses the collection's access rules (nobody can
 * delete posts through the API).
 */
export const pruneSocialPosts = async (
  payload: Payload,
  {
    batchSize = 50,
    days,
    maxBatches = 5,
    now = new Date(),
  }: {
    batchSize?: number
    days?: number
    maxBatches?: number
    now?: Date
  } = {},
): Promise<number> => {
  const where = finishedSocialPostsBefore(now, days)
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
