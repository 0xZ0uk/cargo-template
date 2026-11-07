import type { Config, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { _internal_resetJobSystemGlobals, buildConfig, getPayload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * One check at a time for a post the platform holds (#148). A cron tick sweeps
 * and then drains, and Payload runs a drain's jobs concurrently. If the sweep
 * queued a check for a held post whose follow-up check is already queued for
 * the same time, both would run in that drain, both would record `pending`,
 * and both would queue another check: one more job and one more platform read
 * per tick, without limit (a Business Profile post in moderation has no
 * deadline). These run Payload's real job runner on an in-memory SQLite
 * database, with a fake adapter whose `reconcile` always answers `pending`.
 */

vi.mock('../server/platforms/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/platforms/registry.js')>()
  return { ...actual, getPlatformAdapter: vi.fn(actual.getPlatformAdapter) }
})

import type { PlatformAdapter, ReconcileVerdict } from '../types/index.js'

import payloadPluginSocials, {
  normalizePluginOptions,
  queueSocialPostPublish,
  runQueuedSocialsJobs,
  sweepDueSocialPosts,
} from '../index.js'
import { getPlatformAdapter } from '../server/platforms/registry.js'

const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

const pluginOptions = {
  authorize: () => Promise.resolve(true),
  encryptionKey: HEX_KEY,
  platforms: {
    pinterest: {
      clientId: 'id',
      clientSecret: 'secret',
      enabled: true,
      redirectUri: 'https://example.test/callback',
    },
  },
  sources: { product: () => Promise.reject(new Error('stub')) },
}
const normalizedOptions = normalizePluginOptions(pluginOptions)

let payload: Payload

beforeAll(async () => {
  const config = await buildConfig({
    collections: [{ slug: 'products', fields: [{ name: 'title', type: 'text' }] }],
    db: sqliteAdapter({ client: { url: ':memory:' }, push: true }) as Config['db'],
    editor: lexicalEditor(),
    jobs: { deleteJobOnComplete: false, tasks: [] },
    plugins: [payloadPluginSocials(pluginOptions)],
    secret: 'test-secret',
  })
  payload = await getPayload({ config })
}, 60_000)

afterAll(async () => {
  _internal_resetJobSystemGlobals()
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
})

afterEach(() => {
  vi.mocked(getPlatformAdapter).mockReset()
})

let counter = 0

const createHeldPost = async (): Promise<number | string> => {
  counter++
  const doc = (await payload.create({
    collection: 'social-posts' as never,
    data: {
      externalId: `accounts/1/locations/2/localPosts/${counter}`,
      idempotencyKey: `drain-${counter}-`.padEnd(64, '0'),
      nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
      platform: 'gbp',
      sourceHash: 'hash',
      sourceId: `src-${counter}`,
      sourceKind: 'product',
      status: 'publishing',
    } as never,
    overrideAccess: true,
  })) as unknown as { id: number | string }
  return doc.id
}

const fakeAdapter = (reconcile: () => Promise<ReconcileVerdict>) => {
  const spy = vi.fn(reconcile)
  vi.mocked(getPlatformAdapter).mockReturnValue({
    id: 'gbp',
    reconcile: spy,
  } as unknown as PlatformAdapter)
  return spy
}

type JobRow = {
  id: number | string
  input?: { postId?: number | string }
  log?: Array<{ output?: Record<string, unknown> }> | null
}

const publishJobs = async (
  postId: number | string,
  state: 'all' | 'waiting',
): Promise<JobRow[]> => {
  const result = await payload.find({
    collection: 'payload-jobs',
    depth: 0,
    limit: 100,
    overrideAccess: true,
    where: {
      and: [
        { taskSlug: { equals: 'socialPostPublish' } },
        ...(state === 'waiting'
          ? [{ completedAt: { exists: false } }, { hasError: { not_equals: true } }]
          : []),
      ],
    },
  })
  return (result.docs as unknown as JobRow[]).filter(
    (job) => String(job.input?.postId) === String(postId),
  )
}

/** Hold every other post's check (an earlier test's), so a drain runs only this test's jobs. */
const settleOtherChecks = async () => {
  await payload.update({
    collection: 'payload-jobs',
    data: { waitUntil: new Date(Date.now() + 3_600_000).toISOString() },
    overrideAccess: true,
    where: { completedAt: { exists: false } },
  })
}

/** What the Workers cron (`apps/web/src/server.ts`) and `/internal/jobs/sweep` do on each tick. */
const cronTick = async () => {
  const sweep = await sweepDueSocialPosts(payload, normalizedOptions)
  await runQueuedSocialsJobs(payload, normalizedOptions)
  return sweep
}

describe('checking a post the platform holds', () => {
  it('queues one check per tick when the sweep and the follow-up check meet in one drain', async () => {
    // `checkAt` in the past: the follow-up job and the row are both due on the next tick.
    const reconcile = fakeAdapter(() =>
      Promise.resolve({
        checkAt: new Date(Date.now() - 1_000).toISOString(),
        state: 'pending',
      }),
    )
    const postId = await createHeldPost()

    // First tick: only the sweep's job; its pending verdict queues the follow-up.
    await cronTick()
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(await publishJobs(postId, 'waiting')).toHaveLength(1)

    // Each later tick: the row is due and its follow-up job is due. The sweep
    // leaves the post to that job, so the drain checks it once.
    for (let tick = 2; tick <= 4; tick++) {
      const sweep = await cronTick()
      expect(await publishJobs(postId, 'waiting')).toHaveLength(1)
      expect(reconcile).toHaveBeenCalledTimes(tick)
      expect(sweep.skipped).toBe(1)
    }
  })

  it('records one verdict when two jobs check the same post at once', async () => {
    // Two checks queued without the row knowing (two sweeps in different
    // isolates): the second answer arrives after the first is recorded.
    let calls = 0
    const reconcile = fakeAdapter(async () => {
      calls++
      if (calls > 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return { state: 'pending' }
    })
    const postId = await createHeldPost()
    await settleOtherChecks()
    await queueSocialPostPublish({ payload, postId })
    await queueSocialPostPublish({ payload, postId })

    await runQueuedSocialsJobs(payload, normalizedOptions)

    expect(reconcile.mock.calls.length).toBeLessThanOrEqual(2)
    const all = await publishJobs(postId, 'all')
    const outputs = all.map((job) => job.log?.at(-1)?.output)
    expect(outputs.filter((output) => output?.reconciled === 'pending')).toHaveLength(1)
    expect(outputs.filter((output) => output?.reconcileSkipped)).toHaveLength(1)
    expect(await publishJobs(postId, 'waiting')).toHaveLength(1)

    const post = (await payload.findByID({
      id: postId as never,
      collection: 'social-posts' as never,
      depth: 0,
      overrideAccess: true,
    })) as unknown as { nextRetryAt?: string; queuedJobId?: string }
    const [waiting] = await publishJobs(postId, 'waiting')
    expect(post.queuedJobId).toBe(String(waiting?.id))
    expect(Date.parse(post.nextRetryAt ?? '')).toBeGreaterThan(Date.now())
  })
})
