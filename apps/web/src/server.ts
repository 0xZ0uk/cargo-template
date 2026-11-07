import { assistantConversation } from '@shipment/payload-plugin-assistant/do'
import { runSeoJobs } from '@shipment/payload-seo-analyzer'
import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

import { assistantConversationDependencies } from './plugins/assistant'

// The admin assistant's Durable Objects (one per conversation, one per user's conversation list):
// a Worker must export every Durable Object class it binds (`durable_objects` in wrangler.jsonc).
// Workerd-only; the `./do` entry never reaches the Payload config or the admin bundle.
export { AssistantConversationIndex } from '@shipment/payload-plugin-assistant/do'

/**
 * The conversation object, with the app's turn dependencies (the audit log, #68): turns run here
 * on Workers, so what they need beyond the JSON the endpoint sends comes from one factory over
 * `env` (src/plugins/assistant.ts), the same one the plugin's `audit` option reads.
 */
export const AssistantConversation = assistantConversation<Cloudflare.Env>(
  assistantConversationDependencies,
)
export type AssistantConversation = InstanceType<typeof AssistantConversation>

// Worker entry. TanStack Start uses `src/server.ts` as its server entry when it exists, so
// this replaces the default one: same `fetch`, plus a `scheduled` handler for the Cron
// Trigger in `wrangler.jsonc`.
const entry = createServerEntry({ fetch: createStartHandler(defaultStreamHandler) })

/**
 * Cron Trigger: queues the due scheduled Payload jobs and runs them. Today that's the SEO
 * analyzer's queue (continuing a dashboard audit that paused between steps) and the Socials
 * plugin's (scheduled posts), plus the purge of old finished social posts and of A/B runs
 * that ended more than 90 days ago. Each run gets its
 * own CPU budget, and each step its own try/catch so one failing doesn't hide the other.
 */
async function runScheduledJobs(cron: string): Promise<void> {
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('@payload-config')).default })
  try {
    const { queued, ran } = await runSeoJobs(payload)
    if (queued || ran) payload.logger.info(`[cron ${cron}] seo jobs: queued ${queued}, ran ${ran}`)
  } catch (error) {
    payload.logger.error({ err: error, msg: `[cron ${cron}] seo jobs failed` })
  }

  try {
    // Ended A/B runs whose events Analytics Engine no longer keeps (90 days).
    const { pruneEndedExperimentRuns } = await import('@shipment/payload-plugin-ab')
    const pruned = await pruneEndedExperimentRuns(payload)
    if (pruned) payload.logger.info(`[cron ${cron}] ab: pruned ${pruned} ended runs`)
  } catch (error) {
    payload.logger.error({ err: error, msg: `[cron ${cron}] ab prune failed` })
  }

  try {
    const { socialsOptions } = await import('./plugins/socials')
    // Disabled (no SOCIALS_ENCRYPTION_KEY): its tasks are inert and nothing queues them, so there is nothing to run.
    if (!socialsOptions.disabled) {
      const { normalizePluginOptions, runQueuedSocialsJobs, sweepDueSocialPosts } =
        await import('@shipment/payload-plugin-socials')
      const { pruneSocialPosts } = await import('./plugins/socialsRetention')
      const options = normalizePluginOptions(socialsOptions)
      // Queue the posts that came due, then run the queue.
      const { queued } = await sweepDueSocialPosts(payload, options)
      await runQueuedSocialsJobs(payload, options)
      const pruned = await pruneSocialPosts(payload)
      if (queued || pruned) {
        payload.logger.info(`[cron ${cron}] socials: queued ${queued}, pruned ${pruned} old posts`)
      }
    }
  } catch (error) {
    payload.logger.error({ err: error, msg: `[cron ${cron}] socials failed` })
  }
}

export default {
  ...entry,
  scheduled(controller: ScheduledController, _env: unknown, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledJobs(controller.cron))
  },
}
