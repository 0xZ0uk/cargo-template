import { afterEach, describe, expect, it, vi } from 'vitest'

import { workersManifestCache, type AbVariant } from '@/plugins/abTesting'

const variants: AbVariant[] = [
  { bucket: 'about--abc123', rewritePath: '/about--abc123', passPercentage: 30 },
]

/** A stand-in for `caches.default`: stores response bodies and headers by URL. */
function fakeCache() {
  const store = new Map<string, { body: string; headers: Headers }>()
  const cache = {
    match: vi.fn(async (url: string) => {
      const hit = store.get(url)
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined
    }),
    put: vi.fn(async (url: string, res: Response) => {
      store.set(url, { body: await res.text(), headers: res.headers })
    }),
    delete: vi.fn(async (url: string) => store.delete(url)),
  }
  return { cache, store }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workersManifestCache', () => {
  it('uses the Cache API under synthetic URLs, with the TTL as max-age', async () => {
    const { cache, store } = fakeCache()
    vi.stubGlobal('caches', { default: cache })
    const c = workersManifestCache<AbVariant>()

    expect(await c.get('/about')).toBeUndefined()
    await c.set('/about', variants, 30)
    const url = `https://ab-manifest.internal/${encodeURIComponent('/about')}`
    expect([...store.keys()]).toEqual([url])
    expect(store.get(url)!.headers.get('Cache-Control')).toBe('max-age=30')
    expect(await c.get('/about')).toEqual(variants)

    // A page without an experiment is cached as `null`, distinct from a miss.
    await c.set('/', null, 30)
    expect(await c.get('/')).toBeNull()

    await c.delete('/about')
    expect(await c.get('/about')).toBeUndefined()
  })

  it('falls back to memory where there is no Cache API (Node, vitest)', async () => {
    vi.stubGlobal('caches', undefined)
    const c = workersManifestCache<AbVariant>()
    expect(await c.get('/about')).toBeUndefined()
    await c.set('/about', variants, 30)
    expect(await c.get('/about')).toEqual(variants)
    await c.delete('/about')
    expect(await c.get('/about')).toBeUndefined()
  })
})
