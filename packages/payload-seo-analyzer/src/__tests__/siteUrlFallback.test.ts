import { afterEach, describe, expect, it } from 'vitest'
import { seoCache } from '../cache.js'
import { buildJsonLd } from '../helpers/buildSchema.js'
import { requestOrigin } from '../helpers/siteUrl.js'

// robots.txt and sitemap.xml are served at the site root. Without a configured site URL
// they used to print relative URLs (`Sitemap: /sitemap.xml`, `<loc>/about</loc>`), which
// crawlers reject. They now fall back to the request's origin.

function makePayload(docs: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    async find({ collection }: { collection: string }) {
      const list = docs[collection] ?? []
      return { docs: list, totalDocs: list.length, hasNextPage: false }
    },
  }
}

afterEach(() => {
  delete process.env.SITE_URL
  seoCache.invalidate()
})

describe('requestOrigin', () => {
  it('returns the origin of an absolute request URL', () => {
    expect(requestOrigin({ url: 'https://example.com/api/seo-plugin/robots.txt?x=1' })).toBe('https://example.com')
  })

  it('returns undefined without a parseable URL', () => {
    expect(requestOrigin({})).toBeUndefined()
    expect(requestOrigin({ url: '/relative' })).toBeUndefined()
  })
})

describe('robots.txt site URL', () => {
  it('falls back to the request origin for the Sitemap line', async () => {
    const { createRobotsHandler } = await import('../endpoints/robots.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = { url: 'https://shop.example/robots.txt', payload: makePayload() } as any
    const text = await (await createRobotsHandler(['pages'])(req)).text()
    expect(text).toContain('Sitemap: https://shop.example/sitemap.xml')
  })

  it('prefers the configured site URL over the request origin', async () => {
    const { createRobotsHandler } = await import('../endpoints/robots.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = { url: 'http://internal:8787/robots.txt', payload: makePayload() } as any
    const text = await (await createRobotsHandler(['pages'], { siteUrl: 'https://public.example/' })(req)).text()
    expect(text).toContain('Sitemap: https://public.example/sitemap.xml')
  })
})

describe('sitemap.xml site URL', () => {
  it('emits absolute <loc> values from the request origin and caches per origin', async () => {
    const { createSitemapHandler } = await import('../endpoints/sitemap.js')
    const handler = createSitemapHandler(['pages'])
    const payload = makePayload({ pages: [{ slug: 'home' }, { slug: 'about' }] })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await (await handler({ url: 'https://a.example/sitemap.xml', payload } as any)).text()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await (await handler({ url: 'https://b.example/sitemap.xml', payload } as any)).text()

    expect(a).toContain('<loc>https://a.example/about</loc>')
    expect(b).toContain('<loc>https://b.example/about</loc>')
    expect(b).not.toContain('a.example')
  })
})

describe('breadcrumb endpoint', () => {
  // Found on the first deployed Worker: it answered with `http://localhost:3000` URLs and
  // a French home label on an English site.
  const call = async (seoConfig?: { siteUrl?: string; locale?: 'fr' | 'en' }) => {
    const { createBreadcrumbHandler } = await import('../endpoints/breadcrumb.js')
    const req = {
      url: 'https://site.example/api/seo-plugin/breadcrumb?slug=about',
      user: { id: 1 },
      payload: makePayload({ pages: [{ slug: 'about', title: 'About' }] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    return (await createBreadcrumbHandler(['pages'], seoConfig)(req)).json()
  }

  it('falls back to the request origin and an English home label', async () => {
    const body = await call({ locale: 'en' })
    expect(body.items[0]).toEqual({ name: 'Home', url: 'https://site.example' })
    expect(body.items[1].url).toBe('https://site.example/about')
  })

  it('keeps Accueil for fr and prefers the configured site URL', async () => {
    const body = await call({ locale: 'fr', siteUrl: 'https://public.example/' })
    expect(body.items[0]).toEqual({ name: 'Accueil', url: 'https://public.example' })
  })
})

describe('buildJsonLd breadcrumb home label', () => {
  const doc = { slug: 'about', title: 'About' }
  const first = (opts: Parameters<typeof buildJsonLd>[1]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (buildJsonLd(doc, { siteUrl: 'https://x.example', type: 'BreadcrumbList', ...opts }).jsonLd as any).itemListElement[0].name

  it('defaults to Home, Accueil for fr, and honours an explicit label', () => {
    expect(first({})).toBe('Home')
    expect(first({ locale: 'fr' })).toBe('Accueil')
    expect(first({ homeLabel: 'Start' })).toBe('Start')
  })
})
