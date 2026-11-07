import type { Config, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import {
  _internal_jobSystemGlobals,
  _internal_resetJobSystemGlobals,
  buildConfig,
  getPayload,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import payloadPluginSocials from '../index.js'

/**
 * The `socialPostSweep` task in `scheduling.autoRun` mode (#132). With
 * `autoRun.cron` set, Payload's schedule queues this task, and it is the only
 * sweep that runs: it must pick up the same due posts as
 * `sweepDueSocialPosts`, including the follow-up checks of posts the platform
 * still holds, or those posts are never checked again.
 */

const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const QUEUE = 'socials'

let payload: Payload

beforeAll(async () => {
  const config = await buildConfig({
    collections: [{ slug: 'products', fields: [{ name: 'title', type: 'text' }] }],
    db: sqliteAdapter({ client: { url: ':memory:' }, push: true }) as Config['db'],
    editor: lexicalEditor(),
    jobs: { deleteJobOnComplete: false, tasks: [] },
    plugins: [
      payloadPluginSocials({
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
        scheduling: { autoRun: { cron: '* * * * *' } },
        sources: { product: () => Promise.reject(new Error('stub')) },
      }),
    ],
    secret: 'test-secret',
  })
  payload = await getPayload({ config })
}, 60_000)

afterAll(async () => {
  _internal_resetJobSystemGlobals()
  await (payload as unknown as undefined | { destroy?: () => Promise<void> })?.destroy?.()
})

let counter = 0

const createPost = async (data: Record<string, unknown>): Promise<number | string> => {
  counter++
  const doc = (await payload.create({
    collection: 'social-posts' as never,
    data: {
      idempotencyKey: `sweep-${counter}-`.padEnd(64, '0'),
      sourceHash: 'hash',
      sourceId: `src-${counter}`,
      sourceKind: 'product',
      ...data,
    } as never,
    overrideAccess: true,
  })) as unknown as { id: number | string }
  return doc.id
}

const minutesFromNow = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString()

describe('the sweep task in autoRun mode', () => {
  it('queues the follow-up check of a due Facebook scheduled post', async () => {
    const facebookDue = await createPost({
      externalId: '123_456',
      meta: { pageId: '123', scheduledSeconds: Math.floor(Date.now() / 1000) - 120 },
      nextRetryAt: minutesFromNow(-1),
      platform: 'facebook',
      scheduledAt: minutesFromNow(-2),
      status: 'scheduled',
    })
    const gbpDue = await createPost({
      externalId: 'accounts/1/locations/2/localPosts/3',
      nextRetryAt: minutesFromNow(-1),
      platform: 'gbp',
      status: 'publishing',
    })
    const queuedDue = await createPost({
      meta: { queuedInput: { boardId: 'board' } },
      platform: 'pinterest',
      scheduledAt: minutesFromNow(-1),
      status: 'queued',
    })
    const facebookLater = await createPost({
      externalId: '123_789',
      meta: { pageId: '123' },
      nextRetryAt: minutesFromNow(30),
      platform: 'facebook',
      scheduledAt: minutesFromNow(29),
      status: 'scheduled',
    })

    // What a Jobs worker does on its cron: queue scheduled tasks, then run them.
    await payload.jobs.handleSchedules({ queue: QUEUE })
    const sweepJobs = await payload.count({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: { taskSlug: { equals: 'socialPostSweep' } },
    })
    expect(sweepJobs.totalDocs).toBe(1)
    // The schedule queues the sweep for the next cron tick: move Payload's job clock past it.
    _internal_jobSystemGlobals.getCurrentDate = () => new Date(Date.now() + 61_000)
    await payload.jobs.run({
      overrideAccess: true,
      queue: QUEUE,
      where: { taskSlug: { equals: 'socialPostSweep' } },
    })

    const publishJobs = await payload.find({
      collection: 'payload-jobs',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      where: { taskSlug: { equals: 'socialPostPublish' } },
    })
    const postIds = publishJobs.docs.map((job) =>
      String((job.input as { postId?: number | string } | undefined)?.postId),
    )
    expect(postIds).toEqual(
      expect.arrayContaining([String(facebookDue), String(gbpDue), String(queuedDue)]),
    )
    expect(postIds).not.toContain(String(facebookLater))
  })
})
