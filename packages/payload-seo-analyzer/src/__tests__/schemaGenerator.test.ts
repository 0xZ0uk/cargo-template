import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSchemaGeneratorHandler } from '../endpoints/schemaGenerator.js'
import { buildJsonLd } from '../helpers/buildSchema.js'
import type { SeoConfig } from '../types.js'

const page = { id: 2, slug: 'coffee-brewing-basics', title: 'Coffee brewing basics', meta: { title: 'Coffee brewing basics' } }
const docs: Record<string, Record<string, unknown>> = {
  '2': page,
  '3': { id: 3, slug: 'home', title: 'Home', meta: { title: 'Home | Shipment' } },
  '4': { id: 4, slug: 'untitled', meta: { title: 'Untitled | Shipment' } },
  '5': { id: 5, slug: 'xss', title: 'Hi </script><script>alert(1)</script>' },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(url: string, user: Record<string, unknown> | null = { id: 1, collection: 'users' }): any {
  return {
    url,
    user,
    payload: {
      config: { admin: { user: 'users' } },
      logger: { error: vi.fn() },
      find: vi.fn(async () => ({ docs: [] })),
      findByID: vi.fn(async ({ id }: { id: string }) => {
        const doc = docs[id]
        if (!doc) throw new Error('not found')
        return doc
      }),
    },
  }
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() })

describe('GET /schema-generator', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("uses the request's origin when no site URL is configured, never localhost", async () => {
    vi.stubEnv('SITE_URL', '')
    const handler = createSchemaGeneratorHandler(['pages'], {} as SeoConfig)
    const { status, body } = await json(
      await handler(req('https://shipment.example/api/seo-plugin/schema-generator?collection=pages&id=2')),
    )
    expect(status).toBe(200)
    expect(body.jsonLd.url).toBe('https://shipment.example/coffee-brewing-basics')
    expect(JSON.stringify(body)).not.toContain('localhost')
  })

  it('prefers the configured site URL and applies the collection routes', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], {
      siteUrl: 'https://www.site.test/',
      collectionRoutes: { pages: 'guides' },
    } as SeoConfig)
    const { body } = await json(
      await handler(req('https://shipment.example/api/seo-plugin/schema-generator?collection=pages&id=2&type=Article')),
    )
    expect(body.jsonLd.mainEntityOfPage['@id']).toBe('https://www.site.test/guides/coffee-brewing-basics')
  })

  it('generates a WebPage for the home page and for a generic page, not an Article', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], { siteUrl: 'https://s.test' } as SeoConfig)
    const base = 'https://shipment.example/api/seo-plugin/schema-generator?collection=pages'
    for (const id of ['2', '3']) {
      const { body } = await json(await handler(req(`${base}&id=${id}`)))
      expect(body.type).toBe('WebPage')
      expect(body.jsonLd['@type']).toBe('WebPage')
      expect(body.warnings).toEqual([])
    }
  })

  it('falls back from a FAQPage with no Q&A, with a warning', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], {} as SeoConfig)
    const { status, body } = await json(
      await handler(req('https://shipment.example/api/seo-plugin/schema-generator?collection=pages&id=2&type=FAQPage')),
    )
    expect(status).toBe(200)
    expect(body.type).toBe('WebPage')
    expect(body.jsonLd).not.toHaveProperty('mainEntity')
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toMatch(/question and answer/)
  })

  it('strips the site name from meta.title when the document has no title', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], { siteName: 'Shipment' } as SeoConfig)
    const { body } = await json(
      await handler(req('https://shipment.example/api/seo-plugin/schema-generator?collection=pages&id=4')),
    )
    expect(body.jsonLd.name).toBe('Untitled')
  })

  it('rejects anonymous callers, other collections, unknown types and missing docs', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], {} as SeoConfig)
    const base = 'https://shipment.example/api/seo-plugin/schema-generator'
    expect((await handler(req(`${base}?collection=pages&id=2`, null))).status).toBe(401)
    expect((await handler(req(`${base}?collection=users&id=1`))).status).toBe(403)
    expect((await handler(req(`${base}?collection=pages&id=2&type=Nope`))).status).toBe(400)
    expect((await handler(req(`${base}?collection=pages&id=9`))).status).toBe(404)
  })
})

describe('buildJsonLd BreadcrumbList', () => {
  const trail = (doc: Record<string, unknown>, opts: Record<string, unknown> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (buildJsonLd(doc, { siteUrl: 'https://s.test', type: 'BreadcrumbList', ...opts }).jsonLd as any).itemListElement.map(
      (i: { name: string; item: string }) => [i.name, i.item],
    )

  it('is just the home item for the home page, not a second item at /home', () => {
    expect(trail({ slug: 'home', title: 'Home' })).toEqual([['Home', 'https://s.test']])
  })

  it("follows the document's public path, route prefix included", () => {
    expect(trail({ slug: 'my-post', title: 'My post' }, { collection: 'posts' })).toEqual([
      ['Home', 'https://s.test'],
      ['posts', 'https://s.test/posts'],
      ['My post', 'https://s.test/posts/my-post'],
    ])
    expect(trail({ slug: 'coffee', title: 'Coffee' }, { collection: 'pages', collectionRoutes: { pages: '' } })).toEqual([
      ['Home', 'https://s.test'],
      ['Coffee', 'https://s.test/coffee'],
    ])
  })

  it("escapes the pasteable html so a title can't close the script tag", async () => {
    const handler = createSchemaGeneratorHandler(['pages'], { siteUrl: 'https://s.test' } as SeoConfig)
    const { body } = await json(
      await handler(req('https://shipment.example/api/seo-plugin/schema-generator?collection=pages&id=5')),
    )
    expect(body.html).not.toContain('</script><script>')
    expect(body.html).toContain('\\u003c/script\\u003e')
    expect(body.html.match(/<\/script>/g)).toHaveLength(1)
  })
})
