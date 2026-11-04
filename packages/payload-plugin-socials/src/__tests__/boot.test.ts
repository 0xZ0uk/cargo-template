import type { Config, Payload } from 'payload'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import payloadPluginSocials, {
  normalizePluginOptions,
  queueSocialPostSweep,
  runQueuedSocialsJobs,
  SOCIAL_POST_SWEEP_TASK_SLUG,
} from '../index.js'

const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

/**
 * Real Payload boot against an in-memory sqlite database with schema push.
 * This builds EVERY plugin table (including the four per-platform `scopes`
 * arrays on the connections global), so a duplicate dbName or an over-long
 * identifier fails the boot rather than a host's production migration.
 */
let payload: Payload

const pluginOptions = {
  authorize: () => Promise.resolve(true),
  encryptionKey: HEX_KEY,
  platforms: { pinterest: { enabled: false } },
  sources: { product: () => Promise.reject(new Error('stub')) },
}

// Upstream also boots against Postgres and MongoDB; Cargo runs on D1 (SQLite) only.
const createTestDatabase = (): Config['db'] =>
  sqliteAdapter({ client: { url: ':memory:' }, push: true })

beforeAll(async () => {
  const config = await buildConfig({
    collections: [{ slug: 'products', fields: [{ name: 'title', type: 'text' }] }],
    db: createTestDatabase(),
    editor: lexicalEditor(),
    plugins: [
      payloadPluginSocials(pluginOptions),
    ],
    secret: 'test-secret',
  })
  payload = await getPayload({ config })
}, 60_000)

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
})

describe('Payload boot with the plugin', () => {
  it('registers the plugin-owned collections', () => {
    expect(payload.collections['social-posts']).toBeDefined()
    expect(payload.collections['social-templates']).toBeDefined()
  })

  // Payload 4 versions collections and globals unless they opt out. Versions of the
  // connections global would keep superseded token envelopes; social-posts rows are
  // rewritten on every status change.
  it('opts the plugin collections and global out of Payload 4 default versioning', () => {
    expect(payload.collections['social-posts'].config.versions).toBeFalsy()
    expect(payload.collections['social-templates'].config.versions).toBeFalsy()
    const global = payload.config.globals.find((g) => g.slug === 'socials-connections')
    expect(global).toBeDefined()
    expect(global?.versions).toBeFalsy()
  })

  it('round-trips per-platform scopes on the connections global', async () => {
    await payload.updateGlobal({
      slug: 'socials-connections' as never,
      data: {
        instagram: { state: { connected: true, scopes: [{ value: 'instagram_basic' }] } },
        pinterest: { state: { connected: true, scopes: [{ value: 'pins:write' }] } },
      } as never,
      overrideAccess: true,
    })
    const global = (await payload.findGlobal({
      slug: 'socials-connections' as never,
      overrideAccess: true,
    })) as unknown as {
      instagram?: { state?: { scopes?: Array<{ value: string }> } }
      pinterest?: { state?: { scopes?: Array<{ value: string }> } }
    }
    expect(global.pinterest?.state?.scopes?.[0]?.value).toBe('pins:write')
    expect(global.instagram?.state?.scopes?.[0]?.value).toBe('instagram_basic')
  })

  it('creates a social-templates row', async () => {
    const doc = await payload.create({
      collection: 'social-templates' as never,
      data: { name: 'Spring Promo', templates: { pinterestTitle: '{{title}}' } } as never,
      overrideAccess: true,
    })
    expect((doc as { id: number | string }).id).toBeDefined()
  })

  // Payload 4's Local API defaults to overrideAccess: false, and jobs.access.* require
  // a logged-in user. Sweeps and drains run from cron / the internal API with none.
  it('queues and drains a sweep job without a user', async () => {
    const jobId = await queueSocialPostSweep({ payload })
    const findJob = () =>
      payload.find({
        collection: 'payload-jobs',
        overrideAccess: true,
        where: { id: { equals: jobId } },
      })
    const queued = await findJob()
    expect(queued.docs[0]?.taskSlug).toBe(SOCIAL_POST_SWEEP_TASK_SLUG)
    await runQueuedSocialsJobs(payload, normalizePluginOptions(pluginOptions))
    // Payload deletes a job once it completes; a failed one stays with hasError.
    expect((await findJob()).docs).toHaveLength(0)
  })
})
