import { describe, expect, it } from 'vitest'

import {
  buildRedirectIndex,
  matchRedirect,
  normalizeRedirectPath,
  safeRedirectTarget,
} from '@/utilities/redirects'

describe('normalizeRedirectPath', () => {
  it.each([
    ['/About', '/about'],
    ['/about/', '/about'],
    ['/about///', '/about'],
    ['about', '/about'],
    ['/', '/'],
    ['/blog/Old-Post/', '/blog/old-post'],
    ['/caf%C3%A9', '/café'],
    ['/a%2Fb', '/a%2fb'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRedirectPath(input)).toBe(expected)
  })

  it('keeps a malformed escape sequence as typed', () => {
    expect(normalizeRedirectPath('/100%')).toBe('/100%')
  })

  it.each(['', '  ', '//evil.com', 'https://evil.com/x', '/a\\b', '/a b', '/a\tb', null, 4])(
    'rejects %j',
    (input) => {
      expect(normalizeRedirectPath(input)).toBeNull()
    },
  )
})

describe('safeRedirectTarget', () => {
  it('allows relative paths and adds the leading slash', () => {
    expect(safeRedirectTarget('/new')).toBe('/new')
    expect(safeRedirectTarget('new')).toBe('/new')
    expect(safeRedirectTarget('/new?a=1#top')).toBe('/new?a=1#top')
  })

  it('allows absolute http(s) URLs', () => {
    expect(safeRedirectTarget('https://example.com/x')).toBe('https://example.com/x')
    expect(safeRedirectTarget('http://example.com')).toBe('http://example.com/')
  })

  it.each([
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://example.com',
    '/a\nb',
    '',
    'https://',
  ])('rejects %j', (input) => {
    expect(safeRedirectTarget(input)).toBeNull()
  })
})

describe('matchRedirect', () => {
  const index = buildRedirectIndex([
    { from: '/Old-Page', to: '/new-page', type: '301' },
    { from: '/blog/legacy/', to: '/news', type: '302' },
    { from: '/with-query', to: '/target?ref=a', type: '301' },
    { from: '/external', to: 'https://example.com/landing', type: '301' },
    { from: '/self', to: '/SELF/', type: '301' },
    { from: '/bad-target', to: '//evil.com', type: '301' },
    { from: '//bad-source', to: '/ok', type: '301' },
    { from: '/dupe', to: '/first', type: '301' },
    { from: '/dupe', to: '/second', type: '301' },
    { from: '/no-type', to: '/x' },
  ])

  it('matches case-insensitively and ignores trailing slashes', () => {
    expect(matchRedirect(index, '/old-page')).toEqual({ href: '/new-page', statusCode: 301 })
    expect(matchRedirect(index, '/OLD-PAGE/')).toEqual({ href: '/new-page', statusCode: 301 })
  })

  it('matches multi-segment paths and honours the record type', () => {
    expect(matchRedirect(index, '/blog/legacy')).toEqual({ href: '/news', statusCode: 302 })
  })

  it('defaults to 301', () => {
    expect(matchRedirect(index, '/no-type')?.statusCode).toBe(301)
  })

  it('returns null for unknown paths', () => {
    expect(matchRedirect(index, '/nope')).toBeNull()
    expect(matchRedirect(index, '/')).toBeNull()
  })

  it('preserves the query string', () => {
    expect(matchRedirect(index, '/old-page', '?utm_source=x&b=2')?.href).toBe(
      '/new-page?utm_source=x&b=2',
    )
    expect(matchRedirect(index, '/old-page', 'a=1')?.href).toBe('/new-page?a=1')
    expect(matchRedirect(index, '/old-page', '?')?.href).toBe('/new-page')
  })

  it('lets the target keep the parameters it sets itself', () => {
    expect(matchRedirect(index, '/with-query', '?ref=b&utm=1')?.href).toBe('/target?ref=a&utm=1')
  })

  it('redirects to an explicit absolute URL, keeping the query string', () => {
    expect(matchRedirect(index, '/external', '?a=1')).toEqual({
      href: 'https://example.com/landing?a=1',
      statusCode: 301,
    })
  })

  it('never produces an off-origin redirect from a relative target', () => {
    expect(matchRedirect(index, '/bad-target')).toBeNull()
    expect(matchRedirect(index, '/bad-source')).toBeNull()
  })

  it('ignores a redirect to itself', () => {
    expect(matchRedirect(index, '/self')).toBeNull()
  })

  it('uses the first record when sources collide', () => {
    expect(matchRedirect(index, '/dupe')?.href).toBe('/first')
  })

  it('decodes the request path before comparing', () => {
    const accents = buildRedirectIndex([{ from: '/café', to: '/coffee' }])

    expect(matchRedirect(accents, '/caf%C3%A9')?.href).toBe('/coffee')
  })
})
