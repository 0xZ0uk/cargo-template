import type { PostStatus } from '../../constants.js'

/**
 * Whether a manual retry (`socialPostRetry`, `POST {basePath}/internal/posts/:postId/retry`)
 * may re-publish a post. Re-publishing a post the platform already has posts it
 * twice, so the retry refuses a post that may already be live unless the
 * operator confirms they checked the platform (`confirmNotPublished: true`):
 *
 * - `unknown`: a write's response was lost (5xx, timeout, network error).
 * - `publishing`: an attempt is in flight, or died mid-request.
 * - any row with an `externalId`: the platform returned a post id (a
 *   scheduled Facebook post, a Business Profile post still processing or
 *   rejected, a failed reconciliation).
 *
 * Returns the refusal message, or `undefined` when the retry may go ahead.
 */
export const getRetryRefusal = (
  post: {
    externalId?: null | string
    id: number | string
    platform: string
    status: PostStatus
  },
  options: { basePath: string; confirmNotPublished?: boolean },
): string | undefined => {
  if (options.confirmNotPublished === true) {
    return undefined
  }
  const reason =
    post.status === 'unknown'
      ? 'its publish outcome is unknown'
      : post.status === 'publishing'
        ? 'a publish attempt is in progress or was interrupted'
        : post.externalId
          ? `${post.platform} returned a post id for it (${post.externalId})`
          : undefined
  if (!reason) {
    return undefined
  }
  return (
    `social-posts/${post.id} may already be on ${post.platform}: ${reason}. ` +
    `Check ${post.platform} first. If the post is there, record it with ` +
    `POST ${options.basePath}/posts/${post.id}/resolve { "outcome": "published", "externalId": "…" } ` +
    `(for an unknown post). If it is not, retry with { "confirmNotPublished": true }.`
  )
}
