import { describe, expect, it } from 'vitest'

import type { Media, Page } from '@/payload-types'
import { imageFormatFromMime, pageSocialContext } from '@/utilities/socialsPageSource'

const media = (overrides: Partial<Media> & { id: number }): Media => ({
  alt: `Alt ${overrides.id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  mimeType: 'image/jpeg',
  updatedAt: '2026-01-01T00:00:00.000Z',
  url: `/api/media/file/image-${overrides.id}.jpg`,
  ...overrides,
})

const section = { background: 'default', spacing: 'md' } as const

const page = (overrides: Partial<Page> = {}): Page =>
  ({
    createdAt: '2026-01-01T00:00:00.000Z',
    id: 7,
    layout: [],
    slug: 'about',
    title: 'About',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as Page

describe('imageFormatFromMime', () => {
  it('maps the formats the platforms accept', () => {
    expect(imageFormatFromMime('image/jpeg')).toBe('jpeg')
    expect(imageFormatFromMime('image/jpg')).toBe('jpeg')
    expect(imageFormatFromMime('IMAGE/PNG')).toBe('png')
    expect(imageFormatFromMime('image/webp; charset=binary')).toBe('webp')
    expect(imageFormatFromMime('image/avif')).toBe('avif')
  })

  it('has no format for SVG, video or a missing type', () => {
    expect(imageFormatFromMime('image/svg+xml')).toBeUndefined()
    expect(imageFormatFromMime('video/mp4')).toBeUndefined()
    expect(imageFormatFromMime(null)).toBeUndefined()
    expect(imageFormatFromMime(undefined)).toBeUndefined()
  })
})

describe('pageSocialContext', () => {
  it('uses the SEO meta and the page URL', () => {
    const context = pageSocialContext(
      page({ meta: { description: ' About us ', title: 'About | Shipment' } }),
      'https://example.com/',
    )

    expect(context).toMatchObject({
      baseDescription: 'About us',
      baseTitle: 'About | Shipment',
      link: 'https://example.com/about',
      sourceId: '7',
      sourceKind: 'page',
    })
  })

  it('falls back to the page title, with no description', () => {
    const context = pageSocialContext(
      page({ meta: { description: '', title: null } }),
      'https://example.com',
    )

    expect(context.baseTitle).toBe('About')
    expect(context.baseDescription).toBe('')
    expect(pageSocialContext(page(), 'https://example.com').baseTitle).toBe('About')
  })

  it('links the home page to the root', () => {
    expect(pageSocialContext(page({ slug: 'home' }), 'https://example.com').link).toBe(
      'https://example.com/',
    )
  })

  it('collects the SEO image, then hero, media and gallery images, once each', () => {
    const main = media({ height: 800, id: 1, width: 1200 })
    const hero = media({ id: 2, mimeType: 'image/png' })
    const context = pageSocialContext(
      page({
        layout: [
          { blockType: 'hero', media: hero, section, title: 'Hi' },
          { blockType: 'richText', section } as Page['layout'][number],
          { blockType: 'mediaBlock', media: main, section },
          {
            blockType: 'gallery',
            items: [
              { media: media({ id: 3, mimeType: 'image/webp' }) },
              { media: null },
              { media: 4 },
            ],
            section,
          },
        ] as Page['layout'],
        meta: { image: main },
      }),
      'https://example.com',
    )

    expect(context.images).toEqual([
      {
        alt: 'Alt 1',
        format: 'jpeg',
        height: 800,
        role: 'main',
        url: 'https://example.com/api/media/file/image-1.jpg',
        width: 1200,
      },
      {
        alt: 'Alt 2',
        format: 'png',
        role: 'detail',
        url: 'https://example.com/api/media/file/image-2.jpg',
      },
      {
        alt: 'Alt 3',
        format: 'webp',
        role: 'detail',
        url: 'https://example.com/api/media/file/image-3.jpg',
      },
    ])
  })

  it('keeps absolute media URLs and skips videos, SVGs and unpopulated uploads', () => {
    const context = pageSocialContext(
      page({
        layout: [
          {
            blockType: 'mediaBlock',
            media: media({ id: 1, url: 'https://cdn.example.com/a.jpg' }),
            section,
          },
          { blockType: 'mediaBlock', media: media({ id: 2, mimeType: 'video/mp4' }), section },
          { blockType: 'mediaBlock', media: media({ id: 3, mimeType: 'image/svg+xml' }), section },
          { blockType: 'mediaBlock', media: media({ id: 4, url: null }), section },
          { blockType: 'mediaBlock', media: 5, section },
        ] as Page['layout'],
      }),
      'https://example.com',
    )

    expect(context.images.map((image) => image.url)).toEqual(['https://cdn.example.com/a.jpg'])
  })

  it('copes with a page with no layout or meta', () => {
    const context = pageSocialContext(page({ layout: undefined as never }), 'https://example.com')

    expect(context.images).toEqual([])
  })
})
