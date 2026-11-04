import { describe, expect, it } from 'vitest'
import { getAt, pathnameOf, safeLinkUrl, safePath, samePath, setAt } from '../path.ts'
import {
  createModeCookie,
  isLivePreviewGrant,
  modeSealer,
  readModeCookie,
  SEAL_PURPOSE,
  seal,
  sha256,
  unseal,
} from '../seal.ts'

describe('safePath (open-redirect guard)', () => {
  it.each([
    ['/about', '/about'],
    ['/a/b?x=1#top', '/a/b?x=1#top'],
    ['/', '/'],
    ['/caf%C3%A9', '/caf%C3%A9'],
  ])('accepts %s', (input, out) => expect(safePath(input)).toBe(out))

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/\t/evil.com',
    '/%09/evil.com',
    '/\n/evil.com',
    '/%0a/evil.com',
    '/\r/evil.com',
    '/%5cevil.com',
    '/%5Cevil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'evil.com',
    '',
    null,
    42,
    `/${'a'.repeat(3000)}`,
  ])('rejects %j', (input) => expect(safePath(input)).toBeNull())

  it('compares pages ignoring query, hash and a trailing slash', () => {
    expect(pathnameOf('/a?x#y')).toBe('/a')
    expect(samePath('/a/', '/a?x=1')).toBe(true)
    expect(samePath('/', '/')).toBe(true)
    expect(samePath('/a', '/ab')).toBe(false)
    expect(samePath('/a///', '/a')).toBe(true)
    const hostile = `/${'/'.repeat(100_000)}x`
    const t0 = performance.now()
    samePath(hostile, '/x')
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

describe('seal / unseal', () => {
  const secret = 'test-secret'
  it('round-trips data', async () => {
    const t = await seal({ a: 1, path: '/x' }, secret, SEAL_PURPOSE.previewLink)
    expect(await unseal(t, secret, SEAL_PURPOSE.previewLink)).toEqual({ a: 1, path: '/x' })
  })
  it('is randomized (same input, different output)', async () => {
    const a = await seal({ a: 1 }, secret, SEAL_PURPOSE.previewLink)
    const b = await seal({ a: 1 }, secret, SEAL_PURPOSE.previewLink)
    expect(a).not.toBe(b)
  })
  it('rejects another secret, another purpose, tampering and junk', async () => {
    const t = await seal({ a: 1 }, secret, SEAL_PURPOSE.previewLink)
    expect(await unseal(t, 'other', SEAL_PURPOSE.previewLink)).toBeNull()
    expect(await unseal(t, secret, SEAL_PURPOSE.previewCookie)).toBeNull()
    const mid = Math.floor(t.length / 2)
    const tampered = t.slice(0, mid) + (t[mid] === 'A' ? 'B' : 'A') + t.slice(mid + 1)
    expect(await unseal(tampered, secret, SEAL_PURPOSE.previewLink)).toBeNull()
    for (const junk of ['', 'abc', '!!!', null, undefined, 'x'.repeat(9000)]) {
      expect(await unseal(junk as string, secret, SEAL_PURPOSE.previewLink)).toBeNull()
    }
  })
  it('refuses to seal without a secret', async () => {
    await expect(seal({}, '', SEAL_PURPOSE.previewLink)).rejects.toThrow(/secret/)
  })
  it('hashes with SHA-256', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('safeLinkUrl', () => {
  it.each([
    'https://x.test/a',
    'http://x.test',
    'mailto:a@b.c',
    'tel:+1555',
    '/page',
    '#top',
    '?q=1',
    './rel',
    '../up',
  ])('accepts %s', (u) => expect(safeLinkUrl(u)).toBe(u))
  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    '//evil.test',
    'java\tscript:x',
    'file:///etc/passwd',
    '',
  ])('rejects %j', (u) => expect(safeLinkUrl(u)).toBeNull())
})

describe('path safety', () => {
  it('refuses path segments that reach the prototype', () => {
    for (const path of [
      '__proto__.polluted',
      'a.constructor.prototype',
      ['__proto__', 'x'],
    ] as const) {
      expect(() => setAt({}, path as never, 1)).toThrow(/Unsupported path/)
      expect(() => getAt({}, path as never)).toThrow(/Unsupported path/)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('isLivePreviewGrant', () => {
  const now = 1_700_000_000_000
  const ok = { path: '/a', ref: 'c:pages:1', draft: 'secret', exp: now / 1000 + 60 }
  it('accepts a complete, unexpired grant', () => expect(isLivePreviewGrant(ok, now)).toBe(true))
  it.each([
    ['expired', { ...ok, exp: now / 1000 - 1 }],
    ['missing exp (NaN never expires)', { ...ok, exp: undefined }],
    ['non-finite exp', { ...ok, exp: Infinity }],
    ['missing draft', { ...ok, draft: '' }],
    ['missing path', { ...ok, path: undefined }],
    ['not an object', 'x'],
  ])('refuses %s', (_, g) => expect(isLivePreviewGrant(g, now)).toBe(false))
})

describe('secret rotation (keyring)', () => {
  it('seals with the first secret and unseals with any', async () => {
    const old = await seal({ a: 1 }, 'old', SEAL_PURPOSE.previewLink)
    const ring = ['new', 'old'] as const
    expect(await unseal(old, ring, SEAL_PURPOSE.previewLink)).toEqual({ a: 1 })
    const fresh = await seal({ b: 2 }, ring, SEAL_PURPOSE.previewLink)
    expect(await unseal(fresh, 'new', SEAL_PURPOSE.previewLink)).toEqual({ b: 2 })
    expect(await unseal(fresh, 'old', SEAL_PURPOSE.previewLink)).toBeNull()
    // Dropping the old secret retires what it sealed.
    expect(await unseal(old, ['new'], SEAL_PURPOSE.previewLink)).toBeNull()
  })
  it('refuses an empty keyring', async () => {
    await expect(seal({}, [], SEAL_PURPOSE.previewLink)).rejects.toThrow(/secret is required/)
    await expect(seal({}, [''], SEAL_PURPOSE.previewLink)).rejects.toThrow(/secret is required/)
    const t = await seal({}, 'x', SEAL_PURPOSE.previewLink)
    expect(await unseal(t, [], SEAL_PURPOSE.previewLink)).toBeNull()
  })
  it('mode cookies survive a rotation', async () => {
    const raw = await createModeCookie('edit', {
      sealMode: modeSealer('old'),
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect(await readModeCookie(raw, () => undefined, ['new', 'old'])).toEqual({
      mode: 'edit',
      bound: false,
    })
  })
})

describe('mode cookie', () => {
  const secret = 'test-secret'
  const sealMode = modeSealer(secret)
  const later = new Date(Date.now() + 3600_000)
  const jar = (cookies: Record<string, string>) => (name: string) => cookies[name]

  it('round-trips, bound to the auth cookie', async () => {
    const raw = await createModeCookie('edit', {
      sealMode,
      expiresAt: later,
      bindTo: 'auth',
      token: 'T',
    })
    expect(await readModeCookie(raw, jar({ auth: 'T' }), secret)).toEqual({
      mode: 'edit',
      bound: true,
    })
    expect(await readModeCookie(raw, jar({ auth: 'T2' }), secret)).toBeNull() // someone else
    expect(await readModeCookie(raw, jar({}), secret)).toBeNull() // signed out
    expect(await readModeCookie(raw, jar({ auth: 'T' }), null)).toEqual({
      mode: 'edit',
      bound: true,
    })
  })
  it('stays unbound without an auth cookie', async () => {
    const raw = await createModeCookie('view', { sealMode, expiresAt: later, bindTo: 'auth' })
    expect(await readModeCookie(raw, jar({}), secret)).toEqual({ mode: 'view', bound: false })
  })
  it('refuses forgeries with the secret', async () => {
    const hash = (await sha256('y')).slice(0, 32)
    const real = await createModeCookie('view', { sealMode, expiresAt: later })
    const seal_ = real.slice(real.lastIndexOf('.') + 1)
    const cases = [
      'edit',
      'view',
      `edit:x:${hash}`,
      `edit:x:${hash}.junk`,
      `edit.${seal_}`, // a real seal moved onto another plain part
      await createModeCookie('edit', { sealMode: modeSealer('other'), expiresAt: later }),
      await createModeCookie('edit', { sealMode, expiresAt: new Date(Date.now() - 1000) }),
    ]
    for (const raw of cases) expect(await readModeCookie(raw, jar({ x: 'y' }), secret)).toBeNull()
  })
  it('without the secret, checks shape and binding only', async () => {
    const hash = (await sha256('y')).slice(0, 32)
    expect(await readModeCookie('edit', jar({}), null)).toBeNull()
    expect(await readModeCookie('admin.x', jar({}), null)).toBeNull()
    expect(await readModeCookie(`edit:x:${hash}:z.s`, jar({ x: 'y' }), null)).toBeNull()
  })
})
