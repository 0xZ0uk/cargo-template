/**
 * Payload jobs for the plugin's background work (`jobs` plugin option).
 *
 * Serverless hosts (Cloudflare Workers) have no long-lived process, so the Node
 * `setInterval` schedulers can't run there. With `jobs` set, the plugin registers these
 * tasks with schedules on one queue instead, and the host runs that queue from a cron:
 * `runSeoJobs(payload)` in a Workers `scheduled` handler, or Payload's `jobs.autoRun` on a
 * long-lived server. The interval schedulers are then not started.
 *
 * Registering tasks adds Payload's `payload-jobs` collection (and `payload-jobs-stats`
 * global for schedules) to the schema, so the host needs a migration.
 */
import type { Payload, TaskConfig } from 'payload'
import type { SeoSharedCache } from './cache.js'
import { continuePausedAuditBuilds } from './endpoints/audit.js'
import { runAlertsDigest } from './alertsScheduler.js'
import { runRankSnapshotLogged } from './rankTracker.js'
import { resolveRetention, type RetentionConfig } from './retention.js'
import { runRetentionPurge, type RetentionRunOptions } from './retentionScheduler.js'
import type { SeoDataStoreResolver } from './store/index.js'
import type { SeoConfig } from './types.js'

/** Default queue of the plugin's scheduled tasks. */
export const SEO_JOBS_QUEUE = 'seo'

export interface SeoJobsOptions {
  /** Queue the tasks are scheduled on (default `'seo'`). */
  queue?: string
  /**
   * When to continue audit builds that paused between steps (default every 5 minutes).
   * Only does work while a build is paused. Match it to the host's cron.
   */
  auditCron?: string
  /** When to run the daily tasks: rank snapshot, alerts digest, retention purge (default 04:00). */
  dailyCron?: string
}

export interface ResolvedSeoJobsOptions {
  queue: string
  auditCron: string
  dailyCron: string
}

export function resolveSeoJobsOptions(jobs: boolean | SeoJobsOptions | undefined): ResolvedSeoJobsOptions | null {
  if (!jobs) return null
  const opts = jobs === true ? {} : jobs
  return {
    queue: opts.queue ?? SEO_JOBS_QUEUE,
    auditCron: opts.auditCron ?? '*/5 * * * *',
    dailyCron: opts.dailyCron ?? '0 4 * * *',
  }
}

/** Task slugs, for hosts that queue or inspect them. */
export const SEO_TASK_SLUGS = {
  auditContinue: 'seoAuditContinue',
  rankSnapshot: 'seoRankSnapshot',
  alertsDigest: 'seoAlertsDigest',
  retentionPurge: 'seoRetentionPurge',
} as const

export function seoJobTasks(args: {
  jobs: ResolvedSeoJobsOptions
  features: { dashboard: boolean; gscApi: boolean; alerts: boolean }
  collections: string[]
  globals: string[]
  seoConfig?: SeoConfig
  basePath: string
  gscSiteUrl?: string
  retentionDays?: RetentionConfig
  retention?: RetentionRunOptions
  resolveStore?: SeoDataStoreResolver
  cache: SeoSharedCache
}): TaskConfig[] {
  const { jobs, features } = args
  const tasks: TaskConfig[] = []
  // A missed run is retried by the next schedule, so failed jobs aren't retried (they'd
  // only pile up in `payload-jobs`).
  const audit = [{ cron: jobs.auditCron, queue: jobs.queue }]
  const daily = [{ cron: jobs.dailyCron, queue: jobs.queue }]

  if (features.dashboard) {
    tasks.push({
      slug: SEO_TASK_SLUGS.auditContinue,
      label: 'SEO: continue the dashboard audit',
      retries: 0,
      schedule: audit,
      handler: async ({ req }) => {
        const outcomes = await continuePausedAuditBuilds({
          payload: req.payload,
          collections: args.collections,
          globals: args.globals,
          seoConfig: args.seoConfig,
          cache: args.cache,
        })
        return { output: { steps: outcomes.length } }
      },
    })
  }
  if (features.gscApi) {
    tasks.push({
      slug: SEO_TASK_SLUGS.rankSnapshot,
      label: 'SEO: Search Console rank snapshot',
      retries: 0,
      schedule: daily,
      handler: async ({ req }) => {
        await runRankSnapshotLogged(req.payload, args.basePath, args.seoConfig, args.resolveStore)
        return { output: {} }
      },
    })
  }
  if (features.alerts) {
    tasks.push({
      slug: SEO_TASK_SLUGS.alertsDigest,
      label: 'SEO: alerts digest',
      retries: 0,
      schedule: daily,
      handler: async ({ req }) => {
        await runAlertsDigest(req.payload, args.gscSiteUrl, args.resolveStore)
        return { output: {} }
      },
    })
  }
  if (resolveRetention(args.retentionDays, args.retention).length > 0) {
    tasks.push({
      slug: SEO_TASK_SLUGS.retentionPurge,
      label: 'SEO: retention purge',
      retries: 0,
      schedule: daily,
      handler: async ({ req }) => {
        await runRetentionPurge(req.payload, args.retentionDays, args.retention)
        return { output: {} }
      },
    })
  }
  return tasks
}

/**
 * Queue the due scheduled tasks and run the queue. Call it from the host's cron (a Workers
 * `scheduled` handler). Runs without a user, so access checks are skipped.
 */
export async function runSeoJobs(
  payload: Payload,
  opts: { queue?: string; limit?: number } = {},
): Promise<{ queued: number; ran: number }> {
  const queue = opts.queue ?? SEO_JOBS_QUEUE
  const scheduled = await payload.jobs.handleSchedules({ queue })
  const result = await payload.jobs.run({ queue, limit: opts.limit ?? 10, overrideAccess: true })
  return {
    queued: scheduled.queued.length,
    ran: Object.keys((result as { jobStatus?: Record<string, unknown> }).jobStatus ?? {}).length,
  }
}
