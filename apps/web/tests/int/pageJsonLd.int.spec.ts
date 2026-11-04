import { describe, expect, it } from 'vitest'

import { pageHead } from '@/utilities/pageHead'
import { buildPageJsonLd } from '@/utilities/pageJsonLd'

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const UNSAFE_IN_SCRIPT = new RegExp(`[<>&${LINE_SEPARATOR}${String.fromCharCode(0x2029)}]`)

const parse = (nodes: string[]) => nodes.map((node) => JSON.parse(node) as Record<string, unknown>)

describe('buildPageJsonLd', () => {
  it('emits WebPage and BreadcrumbList for a regular page', async () => {
    const nodes = parse(
      await buildPageJsonLd(
        {
          meta: { description: 'About us', title: 'About | Cargo' },
          slug: 'about',
          title: 'About',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        'https://example.com/',
      ),
    )

    expect(nodes.map((node) => node['@type'])).toEqual(['WebPage', 'BreadcrumbList'])
    expect(nodes[0]).toMatchObject({
      '@context': 'https://schema.org',
      dateModified: '2026-01-02T00:00:00.000Z',
      description: 'About us',
      name: 'About | Cargo',
      url: 'https://example.com/about',
    })
    expect(nodes[1]?.itemListElement).toEqual([
      { '@type': 'ListItem', item: 'https://example.com/', name: 'Home', position: 1 },
      { '@type': 'ListItem', item: 'https://example.com/about', name: 'About', position: 2 },
    ])
  })

  it('emits WebSite, Organization and WebPage on the home page, without a breadcrumb', async () => {
    const nodes = parse(
      await buildPageJsonLd({ slug: 'home', title: 'Home' }, 'https://example.com'),
    )

    expect(nodes.map((node) => node['@type'])).toEqual(['WebSite', 'Organization', 'WebPage'])
    expect(nodes[0]?.url).toBe('https://example.com/')
    expect(nodes[1]).toMatchObject({ name: 'Cargo Template', url: 'https://example.com' })
    expect(nodes[2]).toMatchObject({ url: 'https://example.com/' })
    // Empty values are dropped rather than emitted as "".
    expect(nodes[1]).not.toHaveProperty('description')
    expect(nodes[2]).not.toHaveProperty('description')
  })

  it('escapes </script> and friends so editor text cannot close the script element', async () => {
    const evil = `</script><script>alert(1)</script> & <!-- ${LINE_SEPARATOR}`
    const serialized = await buildPageJsonLd(
      { meta: { description: evil }, slug: 'x', title: evil },
      'https://example.com',
    )

    for (const node of serialized) {
      expect(node).not.toMatch(UNSAFE_IN_SCRIPT)
    }

    // The escapes are plain JSON: parsing gives the original text back.
    expect(parse(serialized)[0]?.description).toBe(evil)
  })

  it('percent-encodes the slug in URLs', async () => {
    const [webPage] = parse(
      await buildPageJsonLd({ slug: 'a b', title: 'A B' }, 'https://example.com'),
    )

    expect(webPage?.url).toBe('https://example.com/a%20b')
  })

  it('makes media URLs absolute', async () => {
    const [webPage] = parse(
      await buildPageJsonLd(
        { meta: { image: { url: '/media/x.png' } as never }, slug: 'x', title: 'X' },
        'https://example.com',
      ),
    )

    expect(webPage?.image).toBe('https://example.com/media/x.png')
  })
})

describe('pageHead', () => {
  it('turns the serialized nodes into ld+json scripts', () => {
    const head = pageHead({
      draft: false,
      livePreview: false,
      jsonLd: ['{"a":1}', '{"b":2}'],
      origin: 'https://example.com',
      page: { layout: [], slug: 'about', title: 'About', hero: { type: 'none' } } as never,
    })

    expect(head).toHaveProperty('scripts', [
      { children: '{"a":1}', type: 'application/ld+json' },
      { children: '{"b":2}', type: 'application/ld+json' },
    ])
  })
})
