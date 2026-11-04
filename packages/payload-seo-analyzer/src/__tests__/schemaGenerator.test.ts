import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSchemaGeneratorHandler } from '../endpoints/schemaGenerator.js'
import { buildJsonLd } from '../helpers/buildSchema.js'
import type { SeoConfig } from '../types.js'

const page = { id: 2, slug: 'coffee-brewing-basics', title: 'Coffee brewing basics', meta: { title: 'Coffee brewing basics' } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(url: string, user: Record<string, unknown> | null = { id: 1, collection: 'users' }): any {
  return {
    url,
    user,
    payload: {
      config: { admin: { user: 'users' } },
      logger: { error: vi.fn() },
      findByID: vi.fn(async ({ id }: { id: string }) => {
        if (id !== '2') throw new Error('not found')
        return page
      }),
    },
  }
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() })

describe('GET /schema-generator', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("uses the request's origin when no site URL is configured, never localhost", async () => {
    vi.stubEnv('SITE_URL', '')
    const handler = createSchemaGeneratorHandler(['pages'], { locale: 'en' } as SeoConfig)
    const { status, body } = await json(
      await handler(req('https://cargo.example/api/seo-plugin/schema-generator?collection=pages&id=2')),
    )
    expect(status).toBe(200)
    expect(body.jsonLd.mainEntityOfPage['@id']).toBe('https://cargo.example/coffee-brewing-basics')
    expect(JSON.stringify(body)).not.toContain('localhost')
  })

  it('prefers the configured site URL and applies the collection routes', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], {
      locale: 'en',
      siteUrl: 'https://www.site.test/',
      collectionRoutes: { pages: 'guides' },
    } as SeoConfig)
    const { body } = await json(
      await handler(req('https://cargo.example/api/seo-plugin/schema-generator?collection=pages&id=2&type=Article')),
    )
    expect(body.jsonLd.mainEntityOfPage['@id']).toBe('https://www.site.test/guides/coffee-brewing-basics')
  })

  it('rejects anonymous callers, other collections, unknown types and missing docs', async () => {
    const handler = createSchemaGeneratorHandler(['pages'], { locale: 'en' } as SeoConfig)
    const base = 'https://cargo.example/api/seo-plugin/schema-generator'
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
})
