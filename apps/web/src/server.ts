import { runSeoJobs } from '@cargo/payload-seo-analyzer'
import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

// Worker entry. TanStack Start uses `src/server.ts` as its server entry when it exists, so
// this replaces the default one: same `fetch`, plus a `scheduled` handler for the Cron
// Trigger in `wrangler.jsonc`.
const entry = createServerEntry({ fetch: createStartHandler(defaultStreamHandler) })

/**
 * Cron Trigger: queues the due scheduled Payload jobs and runs them. Today that's the SEO
 * analyzer's queue (continuing a dashboard audit that paused between steps) and the Socials
 * plugin's (scheduled posts), plus the purge of old finished social posts. Each run gets its
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
    const { socialsOptions } = await import('./plugins/socials')
    // Disabled (no SOCIALS_ENCRYPTION_KEY): its tasks are inert and nothing queues them, so there is nothing to run.
    if (!socialsOptions.disabled) {
      const { normalizePluginOptions, runQueuedSocialsJobs, sweepDueSocialPosts } =
        await import('@cargo/payload-plugin-socials')
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
