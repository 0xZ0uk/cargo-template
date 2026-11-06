import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeoHealthHandler } from '../endpoints/health.js'

function makeReq() {
  return {
    user: { id: 1, collection: 'users', role: 'admin' },
    url: 'http://localhost/api/seo-plugin/health',
    payload: {
      config: { admin: { user: 'users' }, collections: [] },
      collections: {},
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      find: vi.fn(async () => ({ docs: [] })),
      create: vi.fn(async () => ({})),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const pageSpeedKey = async () => {
  const res = await createSeoHealthHandler('/api/seo-plugin', { siteUrl: 'https://site.example' })(makeReq())
  const body = (await res.json()) as { config?: { pageSpeedKey: boolean }; error?: string }
  expect(body.error).toBeUndefined()
  return body.config!.pageSpeedKey
}

afterEach(() => vi.unstubAllEnvs())

describe('health — PageSpeed key', () => {
  it('reports PAGESPEED_API_KEY as configured', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', 'k-123')
    expect(await pageSpeedKey()).toBe(true)
  })

  it('does not read the old GOOGLE_PAGESPEED_API_KEY alias', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '')
    vi.stubEnv('GOOGLE_PAGESPEED_API_KEY', 'legacy')
    expect(await pageSpeedKey()).toBe(false)
  })
})
