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

type HealthBody = { ok?: boolean; config?: { pageSpeedKey: boolean }; warnings?: string[]; error?: string }

const health = async (): Promise<HealthBody> => {
  const res = await createSeoHealthHandler('/api/seo-plugin', { siteUrl: 'https://site.example' })(makeReq())
  const body = (await res.json()) as HealthBody
  expect(body.error).toBeUndefined()
  return body
}

const pageSpeedKey = async () => (await health()).config!.pageSpeedKey
const pageSpeedWarning = (body: HealthBody) => body.warnings!.some((w) => w.startsWith('PAGESPEED_API_KEY'))

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

  it('warns (and is not ok) without a key, since Core Web Vitals then usually gets a 429', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', '')
    const body = await health()
    expect(pageSpeedWarning(body)).toBe(true)
    expect(body.ok).toBe(false)
  })

  it('does not warn about PageSpeed with a key', async () => {
    vi.stubEnv('PAGESPEED_API_KEY', 'k-123')
    expect(pageSpeedWarning(await health())).toBe(false)
  })
})
