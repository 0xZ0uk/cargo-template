import type { Endpoint } from 'payload'

import type { NormalizedPluginOptions, PlatformId } from '../../types/index.js'

import { PLATFORM_IDS } from '../../constants.js'
import { getPlatformAdapter } from '../platforms/registry.js'
import {
  assertDeletable,
  cancelQueuedSocialPost,
  markDeleted,
  refFromPost,
  requirePost,
  resolveUnknownOutcome,
} from '../services/publicationLedger.js'
import { assertAccess } from '../utilities/access.js'
import { ValidationError } from '../utilities/errors.js'
import { errorResponse, getRouteParam, jsonResponse, parseRequestBody } from '../utilities/http.js'

/**
 * DELETE {basePath}/posts/:postId
 *
 * Two operation modes depending on row status:
 *
 * **Cancel mode (status = 'queued')**
 *   Cancels a queued post without calling any platform adapter (nothing has
 *   been published yet). Sets status to 'cancelled' and records
 *   meta.cancelledAt / meta.cancelledBy. Returns { ok, postId, status: 'cancelled' }.
 *   The cancelled row remains re-claimable for republish-in-place (the
 *   publication ledger's `publishNow` takes back cancelled rows).
 *
 * **Soft-delete mode (status = 'published')**
 *   Two sub-modes:
 *
 *   Normal mode (default):
 *   1. Validates the row exists and is in `published` state with an externalId.
 *   2. For a platform whose adapter has no `delete` (Instagram: Meta's Graph
 *      API does not delete published IG Business media): returns HTTP 422
 *      with an actionable message, leaving the row as it is.
 *   3. Otherwise: calls the platform adapter's `delete` method.
 *      a typed/status-coded upstream 404 is treated as success
 *      (deletion is idempotent).
 *   4. Updates the row to status `deleted` and records `meta.deletedAt` and
 *      `meta.deletedBy`. Never hard-deletes the row.
 *
 *   localOnly mode (?localOnly=true):
 *   Skips all upstream platform calls entirely and soft-deletes the local row
 *   only. Sets `meta.deletedLocalOnly: true` to flag that the upstream post
 *   was not removed via the API (e.g. it was already deleted in the platform
 *   app). The same published + externalId guards apply. The resulting
 *   `deleted` row is re-claimable for republish-in-place, exactly like rows
 *   deleted via the normal path.
 *
 * Access: publisher scope.
 *
 * POST {basePath}/posts/:postId/cancel is the cancel-only route: it cancels a queued row and
 * never calls a platform, so it cannot remove a live post. Body `{ minLeadSeconds? }` also
 * refuses when the post is due within that many seconds. Anything but a queued row is a 409.
 */
/** The 422 for a platform whose adapter cannot delete a post (no `delete`). */
export const deleteUnsupportedMessage = (
  label: string,
  options: Pick<NormalizedPluginOptions, 'api'>,
): string =>
  `${label} does not support removing published posts through its API. ` +
  `Delete the post in the ${label} app, then use mark-deleted to reconcile: ` +
  `DELETE ${options.api.basePath}/posts/:postId?localOnly=true`

export const createPostDeleteEndpoints = (options: NormalizedPluginOptions): Endpoint[] => [
  {
    handler: async (req) => {
      try {
        await assertAccess(req, options, 'publisher')

        const postId = getRouteParam(req, 'postId')
        if (!postId) {
          throw new ValidationError('postId route parameter is required')
        }

        // Detect localOnly flag from query string.
        const localOnly =
          req.query &&
          typeof req.query === 'object' &&
          'localOnly' in req.query &&
          req.query.localOnly === 'true'

        const row = await requirePost(req.payload, postId)

        const userId =
          req.user && typeof (req.user as { id?: number | string }).id !== 'undefined'
            ? (req.user as { id: number | string }).id
            : undefined

        // A queued row has no upstream post, so status is the cancellation fence.
        if (row.status === 'queued') {
          const cancelled = await cancelQueuedSocialPost({
            payload: req.payload,
            postId: row.id,
            userId,
          })
          return jsonResponse({ ok: true, ...cancelled })
        }

        assertDeletable(row, { localOnly })

        const platform = row.platform as PlatformId
        if (!PLATFORM_IDS.includes(platform)) {
          throw new ValidationError(`Unknown platform "${String(platform)}"`)
        }

        if (!localOnly) {
          // A status-coded upstream 404 is treated as idempotent success.
          const adapter = getPlatformAdapter(platform, options)
          if (typeof adapter.delete !== 'function') {
            return jsonResponse(
              { error: deleteUnsupportedMessage(adapter.label, options), ok: false },
              422,
            )
          }
          try {
            await adapter.delete({
              options,
              payload: req.payload,
              publishedRef: refFromPost(row),
              req,
            })
          } catch (deleteError) {
            // If the upstream says the post is already gone (HTTP 404),
            // treat it as success. Any other upstream error is fatal — we must NOT
            // mark the row deleted if the upstream deletion failed.
            if (!isUpstreamNotFoundError(deleteError)) {
              throw deleteError
            }
          }
        }

        await markDeleted({ localOnly, payload: req.payload, post: row, userId })

        return jsonResponse({ ok: true, postId: row.id, status: 'deleted' })
      } catch (error) {
        return errorResponse(req, error)
      }
    },
    method: 'delete',
    path: `${options.api.basePath}/posts/:postId`,
  },
  {
    handler: async (req) => {
      try {
        await assertAccess(req, options, 'publisher')
        const postId = getRouteParam(req, 'postId')
        if (!postId) {
          throw new ValidationError('postId route parameter is required')
        }
        const body = await parseRequestBody(req)
        const outcome = body.outcome
        if (outcome !== 'published' && outcome !== 'not-published') {
          throw new ValidationError('outcome must be "published" or "not-published"')
        }
        const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : ''
        const actorId =
          req.user && typeof (req.user as { id?: number | string }).id !== 'undefined'
            ? (req.user as { id: number | string }).id
            : undefined
        await resolveUnknownOutcome({
          actorId,
          externalId: externalId || undefined,
          externalUrl: typeof body.externalUrl === 'string' ? body.externalUrl.trim() : undefined,
          outcome,
          payload: req.payload,
          postId,
        })
        return jsonResponse({ ok: true, outcome, postId })
      } catch (error) {
        return errorResponse(req, error)
      }
    },
    method: 'post',
    path: `${options.api.basePath}/posts/:postId/resolve`,
  },
  {
    handler: async (req) => {
      try {
        await assertAccess(req, options, 'publisher')
        const postId = getRouteParam(req, 'postId')
        if (!postId) {
          throw new ValidationError('postId route parameter is required')
        }
        const body = await parseRequestBody(req)
        const minLeadSeconds = body.minLeadSeconds
        if (
          minLeadSeconds !== undefined &&
          (typeof minLeadSeconds !== 'number' ||
            !Number.isInteger(minLeadSeconds) ||
            minLeadSeconds < 0 ||
            minLeadSeconds > 86_400)
        ) {
          throw new ValidationError('minLeadSeconds must be an integer from 0 to 86400')
        }
        const userId =
          req.user && typeof (req.user as { id?: number | string }).id !== 'undefined'
            ? (req.user as { id: number | string }).id
            : undefined
        const cancelled = await cancelQueuedSocialPost({
          minLeadSeconds,
          payload: req.payload,
          postId,
          userId,
        })
        return jsonResponse({ ok: true, ...cancelled })
      } catch (error) {
        return errorResponse(req, error)
      }
    },
    method: 'post',
    path: `${options.api.basePath}/posts/:postId/cancel`,
  },
]

/**
 * Returns true when the error indicates the upstream post is already gone
 * through a typed HTTP/upstream status. This makes the
 * delete endpoint idempotent: calling DELETE on an already-deleted post
 * succeeds rather than surfacing a confusing upstream error.
 */
const isUpstreamNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }
  const err = error as Record<string, unknown>

  if (typeof err.statusCode === 'number' && err.statusCode === 404) {
    return true
  }
  return err.upstreamCode === 404 || err.upstreamCode === '404'
}
