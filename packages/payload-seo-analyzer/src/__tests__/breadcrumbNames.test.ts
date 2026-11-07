import { describe, expect, it, vi } from 'vitest'

import { createBreadcrumbHandler } from '../endpoints/breadcrumb.js'
import type { SeoConfig } from '../types.js'

const docs: Record<string, Record<string, unknown>> = {
  guides: { slug: 'guides', title: 'Guides', meta: { title: 'Guides | Shipment' } },
  'guides/coffee': { slug: 'guides/coffee', title: 'Coffee brewing basics', meta: { title: 'Coffee brewing basics | Shipment' } },
  'guides/tea': { slug: 'guides/tea', meta: { title: 'Tea | Shipment' } },
  'guides/mate': { slug: 'guides/mate', meta: { title: 'Mate | Settings Name' } },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(slug: string, settings: Record<string, unknown> | null = null): any {
  return {
    url: `https://shipment.example/api/seo-plugin/breadcrumb?collection=pages&slug=${slug}`,
    user: { id: 1, collection: 'users' },
    payload: {
      config: { admin: { user: 'users' } },
      logger: { error: vi.fn() },
      find: vi.fn(async ({ collection, where }: { collection: string; where?: { slug: { equals: string } } }) => {
        if (collection === 'seo-settings') return { docs: settings ? [settings] : [] }
        const doc = where ? docs[where.slug.equals] : undefined
        return { docs: doc ? [doc] : [] }
      }),
    },
  }
}

const names = async (handler: ReturnType<typeof createBreadcrumbHandler>, r: unknown) => {
  const body = await (await handler(r as never)).json()
  return {
    items: body.items.map((i: { name: string }) => i.name),
    jsonLd: body.jsonLd.itemListElement.map((i: { name: string }) => i.name),
  }
}

describe('GET /breadcrumb names', () => {
  const config = { siteName: 'Shipment' } as SeoConfig

  it("uses each page's own title, not the meta title with its suffix", async () => {
    const handler = createBreadcrumbHandler(['pages'], config)
    const out = await names(handler, req('guides/coffee'))
    expect(out.items).toEqual(['Home', 'Guides', 'Coffee brewing basics'])
    expect(out.jsonLd).toEqual(out.items)
  })

  it('strips the site name from meta.title when a page has no title', async () => {
    const handler = createBreadcrumbHandler(['pages'], config)
    expect((await names(handler, req('guides/tea'))).items).toEqual(['Home', 'Guides', 'Tea'])
  })

  it('prefers the site name from the SEO settings over the plugin option', async () => {
    const handler = createBreadcrumbHandler(['pages'], config)
    expect((await names(handler, req('guides/mate', { siteName: 'Settings Name' }))).items).toEqual(['Home', 'Guides', 'Mate'])
    expect((await names(handler, req('guides/mate'))).items).toEqual(['Home', 'Guides', 'Mate | Settings Name'])
  })

  it('falls back to the humanized segment for a missing page', async () => {
    const handler = createBreadcrumbHandler(['pages'], config)
    expect((await names(handler, req('guides/hot-chocolate'))).items).toEqual(['Home', 'Guides', 'Hot chocolate'])
  })
})
