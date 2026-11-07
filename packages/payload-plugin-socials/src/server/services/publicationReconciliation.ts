import type { Payload, PayloadRequest } from 'payload'

import { queueSocialPostPublish } from '../../plugin/jobQueue.js'
import { logAsyncOperationFailure } from '../utilities/logger.js'

/**
 * Queue the publish job that checks a post the platform still holds (the
 * publish task reconciles a `scheduled` or `publishing` row with an
 * `externalId`; it never publishes it). Call it after the row's `nextRetryAt`
 * is set to `checkAt`: a queue failure is only logged, because the row is
 * already due and the sweep (`sweepDueSocialPosts`, the `socialPostSweep`
 * task) queues the check once `checkAt` passes.
 */
export const queueReconciliationCheck = async (args: {
  checkAt: string
  payload: Payload
  postId: number | string
  req?: PayloadRequest
}): Promise<number | string | undefined> => {
  try {
    return await queueSocialPostPublish({
      payload: args.payload,
      postId: args.postId,
      req: args.req,
      scheduledAt: args.checkAt,
    })
  } catch (error) {
    logAsyncOperationFailure(args.payload, 'socials.publication.reconciliation.queue', error)
    return undefined
  }
}
