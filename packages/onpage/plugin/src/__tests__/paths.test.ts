import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import { resolvePath } from '../paths.ts'
import { rejectCrossSite, readRef } from '../http.ts'

function req(
  opts: {
    preview?: (doc: Record<string, unknown>) => string | null
    doc?: Record<string, unknown> | null
    serverURL?: string
  } = {},
) {
  return {
    url: 'https://site.test/api/onpage/x',
    method: 'POST',
    headers: new Headers(),
    payload: {
      config: { serverURL: opts.serverURL ?? 'https://site.test' },
      collections: {
        pages: { config: { admin: { preview: opts.preview } } },
        codes: { config: {}, customIDType: 'text' },
      },
      db: { defaultIDType: 'number' },
      logger: { warn: vi.fn() },
      findByID: vi.fn(async () => (opts.doc === undefined ? { id: 1, slug: 'about' } : opts.doc)),
      findGlobal: vi.fn(async () => ({ tagline: 'x' })),
    },
  } as unknown as PayloadRequest
}
const page = { kind: 'collection', slug: 'pages', id: 1 } as const

describe('resolvePath', () => {
  it('uses the url option, then admin.preview, then /<slug>; globals default to /', async () => {
    expect(
      await resolvePath(req(), page, {
        kind: 'collection',
        slug: 'pages',
        options: { url: () => '/custom?x=1' },
      }),
    ).toBe('/custom?x=1')
    expect(
      await resolvePath(req({ preview: () => 'https://site.test/en/about' }), page, {
        kind: 'collection',
        slug: 'pages',
        options: {},
      }),
    ).toBe('/en/about')
    expect(await resolvePath(req(), page, { kind: 'collection', slug: 'pages', options: {} })).toBe(
      '/about',
    )
    expect(
      await resolvePath(
        req(),
        { kind: 'global', slug: 'header' },
        { kind: 'global', slug: 'header', options: {} },
      ),
    ).toBe('/')
  })
  it("uses a preview route's page path, never the route and its secret (website template)", async () => {
    const entry = { kind: 'collection', slug: 'pages', options: {} } as const
    const template = req({
      preview: (doc) =>
        `/next/preview?slug=${String(doc.slug)}&collection=pages&path=${encodeURIComponent(`/${String(doc.slug)}`)}&previewSecret=s3cret`,
    })
    expect(await resolvePath(template, page, entry)).toBe('/about')
    expect(template.payload.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('preview route (/next/preview)'),
    )
    // No page path to use: no page, rather than a link to the secret route.
    expect(
      await resolvePath(req({ preview: () => '/api/preview?token=abc' }), page, entry),
    ).toBeNull()
    expect(
      await resolvePath(
        req({ preview: () => '/next/preview?previewSecret=x&path=%2Fa%3Ftoken%3Dy' }),
        page,
        entry,
      ),
    ).toBeNull()
    // An explicit url option is checked the same way.
    expect(
      await resolvePath(req(), page, {
        ...entry,
        options: { url: () => '/next/preview?path=/x&secret=1' },
      }),
    ).toBe('/x')
  })
  it('refuses other origins, missing documents and unsafe paths', async () => {
    expect(
      await resolvePath(req({ preview: () => 'https://evil.test/x' }), page, {
        kind: 'collection',
        slug: 'pages',
        options: {},
      }),
    ).toBeNull()
    expect(
      await resolvePath(req({ doc: null }), page, {
        kind: 'collection',
        slug: 'pages',
        options: {},
      }),
    ).toBeNull()
    expect(
      await resolvePath(req(), page, {
        kind: 'collection',
        slug: 'pages',
        options: { url: () => null },
      }),
    ).toBeNull()
  })
})

describe('http helpers', () => {
  it('readRef parses collection and global refs', () => {
    const r = req()
    expect(readRef(r, { kind: 'global', slug: 'header' })).toEqual({
      kind: 'global',
      slug: 'header',
    })
    expect(readRef(r, { slug: 'pages', id: '12' })).toEqual({
      kind: 'collection',
      slug: 'pages',
      id: 12,
    })
    expect(readRef(r, { slug: 'pages', id: 'abc' })).toEqual({
      kind: 'collection',
      slug: 'pages',
      id: 'abc',
    })
    expect(readRef(r, { slug: 'pages' })).toBeNull()
    expect(readRef(r, {})).toBeNull()
  })
  it('readRef types ids the way the collection stores them', () => {
    const r = req()
    // A text-id collection keeps numeric-looking ids as text.
    expect(readRef(r, { slug: 'codes', id: '007' })).toEqual({
      kind: 'collection',
      slug: 'codes',
      id: '007',
    })
    expect(readRef(r, { slug: 'codes', id: '12' })).toEqual({
      kind: 'collection',
      slug: 'codes',
      id: '12',
    })
    // A number-id collection never coerces a non-canonical or unsafe id.
    expect(readRef(r, { slug: 'pages', id: '007' })).toEqual({
      kind: 'collection',
      slug: 'pages',
      id: '007',
    })
    expect(readRef(r, { slug: 'pages', id: '9007199254740993' })).toMatchObject({
      id: '9007199254740993',
    })
  })
  it('rejectCrossSite accepts same-origin POSTs only', () => {
    const r = req()
    expect(rejectCrossSite({ ...r, method: 'GET' })?.status).toBe(405)
    expect(
      rejectCrossSite({
        ...r,
        headers: new Headers({ origin: 'https://site.test' }),
      }),
    ).toBeNull()
    expect(
      rejectCrossSite({
        ...r,
        headers: new Headers({ origin: 'https://evil.test' }),
      })?.status,
    ).toBe(403)
    expect(
      rejectCrossSite({
        ...r,
        headers: new Headers({ 'sec-fetch-site': 'same-origin' }),
      }),
    ).toBeNull()
    expect(
      rejectCrossSite({
        ...r,
        headers: new Headers({ 'sec-fetch-site': 'cross-site' }),
      })?.status,
    ).toBe(403)
    expect(
      rejectCrossSite({
        ...r,
        headers: new Headers({ 'sec-fetch-site': 'none' }),
      })?.status,
    ).toBe(403)
    expect(rejectCrossSite({ ...r, headers: new Headers() })?.status).toBe(403)
  })
})
