import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache } from '../cache.js'
import { runSeoJobs, SEO_JOBS_QUEUE, SEO_TASK_SLUGS } from '../jobs.js'
import { seoAnalyzerPlugin } from '../plugin.js'

vi.mock('../rankTracker.js', async (orig) => ({
  ...(await orig<typeof import('../rankTracker.js')>()),
  startRankTracker: vi.fn(),
}))
vi.mock('../retentionScheduler.js', async (orig) => ({
  ...(await orig<typeof import('../retentionScheduler.js')>()),
  startRetentionPurge: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseConfig(): any {
  return {
    collections: [
      { slug: 'pages', fields: [] },
      { slug: 'media', fields: [], upload: true },
      { slug: 'users', fields: [], auth: true },
    ],
    globals: [],
    endpoints: [],
    admin: {},
    jobs: { deleteJobOnComplete: true, tasks: [{ slug: 'hostTask', handler: vi.fn() }] },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const taskSlugs = (out: any): string[] => (out.jobs?.tasks ?? []).map((t: any) => t.slug)

afterEach(() => {
  vi.clearAllMocks()
})

describe('jobs option', () => {
  it('registers nothing without the option', () => {
    const out = seoAnalyzerPlugin({ collections: ['pages'] })(baseConfig())
    expect(taskSlugs(out)).toEqual(['hostTask'])
  })

  it('registers the retention purge whenever a time-series feature is on (it is mandatory)', () => {
    const out = seoAnalyzerPlugin({
      collections: ['pages'],
      jobs: true,
      features: { scoreHistory: false, performance: false, seoLogs: true },
    })(baseConfig())
    expect(taskSlugs(out)).toEqual(['hostTask', SEO_TASK_SLUGS.auditContinue, SEO_TASK_SLUGS.retentionPurge])
  })

  it('registers one scheduled task per enabled background feature, next to the host tasks', () => {
    const out = seoAnalyzerPlugin({
      collections: ['pages'],
      jobs: true,
      features: { gscApi: true, alerts: true },
      retentionDays: { 'seo-logs': 30 },
    })(baseConfig())
    expect(taskSlugs(out)).toEqual([
      'hostTask',
      SEO_TASK_SLUGS.auditContinue,
      SEO_TASK_SLUGS.rankSnapshot,
      SEO_TASK_SLUGS.alertsDigest,
      SEO_TASK_SLUGS.retentionPurge,
    ])
    expect(out.jobs.deleteJobOnComplete).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byslug = Object.fromEntries(out.jobs.tasks.map((t: any) => [t.slug, t]))
    expect(byslug[SEO_TASK_SLUGS.auditContinue].schedule).toEqual([{ cron: '*/5 * * * *', queue: SEO_JOBS_QUEUE }])
    expect(byslug[SEO_TASK_SLUGS.retentionPurge].schedule).toEqual([{ cron: '0 4 * * *', queue: SEO_JOBS_QUEUE }])
    expect(byslug[SEO_TASK_SLUGS.auditContinue].retries).toBe(0)
  })

  it('follows the feature flags and the queue / cron options', () => {
    const out = seoAnalyzerPlugin({
      collections: ['pages'],
      jobs: { queue: 'nightly', auditCron: '*/10 * * * *' },
      features: { scoreHistory: false, performance: false, seoLogs: false },
    })(baseConfig())
    expect(taskSlugs(out)).toEqual(['hostTask', SEO_TASK_SLUGS.auditContinue])
    expect(out.jobs.tasks[1].schedule).toEqual([{ cron: '*/10 * * * *', queue: 'nightly' }])
  })

  it('skips the interval schedulers on init when jobs run them', async () => {
    const { startRankTracker } = await import('../rankTracker.js')
    const { startRetentionPurge } = await import('../retentionScheduler.js')
    const payload = { logger: { warn: vi.fn(), info: vi.fn() } }

    const withJobs = seoAnalyzerPlugin({ collections: ['pages'], jobs: true, features: { warmCache: false, gscApi: true } })(baseConfig())
    await withJobs.onInit(payload)
    expect(startRankTracker).not.toHaveBeenCalled()
    expect(startRetentionPurge).not.toHaveBeenCalled()

    const without = seoAnalyzerPlugin({ collections: ['pages'], features: { warmCache: false, gscApi: true } })(baseConfig())
    await without.onInit(payload)
    expect(startRankTracker).toHaveBeenCalled()
    expect(startRetentionPurge).toHaveBeenCalled()
  })
})

describe('runSeoJobs', () => {
  it('queues due schedules on the queue, then runs it without access checks', async () => {
    const payload = {
      jobs: {
        handleSchedules: vi.fn(async () => ({ queued: [{}], skipped: [], errored: [] })),
        run: vi.fn(async () => ({ jobStatus: { a: {}, b: {} } })),
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await runSeoJobs(payload as any)).toEqual({ queued: 1, ran: 2 })
    expect(payload.jobs.handleSchedules).toHaveBeenCalledWith({ queue: 'seo' })
    expect(payload.jobs.run).toHaveBeenCalledWith({ queue: 'seo', limit: 10, overrideAccess: true })
  })
})

describe('chunked build markers (in-memory cache)', () => {
  it('reports a paused build as building, resumes it, and clears it when done', async () => {
    const cache = new SeoSharedCache({ memory: new SeoCache() })
    expect(await cache.tryStartBuildStep('audit')).toEqual({ claimed: true, resumed: false })
    expect((await cache.tryStartBuildStep('audit')).claimed).toBe(false)
    await cache.writeProgress('audit', { cursor: 1 })
    await cache.pauseBuild('audit', 50)
    expect(await cache.buildStatus('audit')).toMatchObject({ building: true, paused: true, processed: 50 })

    expect(await cache.tryStartBuildStep('audit')).toEqual({ claimed: true, resumed: true })
    expect(await cache.readProgress('audit')).toEqual({ cursor: 1 })
    await cache.clearProgress('audit')
    await cache.finishBuild('audit')
    expect(await cache.buildStatus('audit')).toMatchObject({ building: false, paused: false })
    expect(await cache.readProgress('audit')).toBeNull()
  })

  it('abandons a pause older than pendingStaleMs', async () => {
    const cache = new SeoSharedCache({ memory: new SeoCache(), pendingStaleMs: 1 })
    await cache.tryStartBuildStep('audit')
    await cache.pauseBuild('audit', 10)
    await new Promise((r) => setTimeout(r, 5))
    expect((await cache.buildStatus('audit')).building).toBe(false)
    expect(await cache.tryStartBuildStep('audit')).toEqual({ claimed: true, resumed: false })
  })
})
