import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createUrlGuard,
  inspectHost,
  inspectUrl,
  isUrlBlocked,
  resolveAndCheckPrivate,
  type HostResolver,
} from '../helpers/ssrfGuard.js'

const answer = (...addresses: string[]): HostResolver => vi.fn(async () => addresses)
const failWith = (code: string, message = code): HostResolver =>
  vi.fn(async () => {
    throw Object.assign(new Error(message), { code })
  })

describe('inspectHost: resolved addresses', () => {
  it('allows a host whose addresses are all public', async () => {
    expect(await inspectHost('example.com', { resolver: answer('93.184.216.34', '2606:2800:220:1::1') })).toEqual({ blocked: false })
  })

  it.each([
    ['loopback', '127.0.0.1'],
    ['10/8', '10.1.2.3'],
    ['172.16/12', '172.20.0.1'],
    ['192.168/16', '192.168.1.1'],
    ['link-local / metadata', '169.254.169.254'],
    ['CGNAT', '100.64.0.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unique-local', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
    ['IPv4-mapped (hex form)', '::ffff:7f00:1'],
    ['NAT64 of metadata', '64:ff9b::a9fe:a9fe'],
  ])('blocks a host that resolves to %s', async (_label, ip) => {
    expect(await inspectHost('rebind.example', { resolver: answer(ip) })).toEqual({ blocked: true, reason: 'private-address' })
  })

  it('blocks when ANY address is private (one public, one internal)', async () => {
    expect(await inspectHost('mixed.example', { resolver: answer('93.184.216.34', '10.0.0.5') })).toEqual({
      blocked: true,
      reason: 'private-address',
    })
  })

  it('ignores CNAME targets in the answer (workerd returns them) and vets the IPs', async () => {
    expect(await inspectHost('www.wikipedia.org', { resolver: answer('dyna.wikimedia.org.', '185.15.58.224') })).toEqual({ blocked: false })
    expect(await inspectHost('evil.example', { resolver: answer('internal.corp.', '10.0.0.1') })).toEqual({
      blocked: true,
      reason: 'private-address',
    })
  })

  it('blocks an answer with only CNAME names (no IP to vet)', async () => {
    expect(await inspectHost('www.github.com', { resolver: answer('github.com.') })).toEqual({ blocked: true, reason: 'dns-no-address' })
  })

  it('blocks an empty answer', async () => {
    expect(await inspectHost('empty.example', { resolver: answer() })).toEqual({ blocked: true, reason: 'dns-no-address' })
  })
})

describe('inspectHost: failures fail closed with a reason', () => {
  it('NXDOMAIN / ENOTFOUND → dns-not-found', async () => {
    expect(await inspectHost('gone.example', { resolver: failWith('ENOTFOUND') })).toEqual({ blocked: true, reason: 'dns-not-found' })
  })

  it('other errors → dns-error', async () => {
    expect(await inspectHost('x.example', { resolver: failWith('ESERVFAIL') })).toEqual({ blocked: true, reason: 'dns-error' })
    expect(await inspectHost('x.example', { resolver: failWith('ERR_METHOD_NOT_IMPLEMENTED', 'Not implemented') })).toEqual({
      blocked: true,
      reason: 'dns-error',
    })
  })

  it('a lookup that never answers → dns-timeout', async () => {
    const hang: HostResolver = () => new Promise(() => undefined)
    expect(await inspectHost('slow.example', { resolver: hang, timeoutMs: 20 })).toEqual({ blocked: true, reason: 'dns-timeout' })
  })

  it('a resolver returning garbage fails closed', async () => {
    const garbage = (async () => undefined) as unknown as HostResolver
    expect((await inspectHost('x.example', { resolver: garbage })).blocked).toBe(true)
  })

  it('the boolean helpers block on failure', async () => {
    expect(await resolveAndCheckPrivate('gone.example', { resolver: failWith('ENOTFOUND') })).toBe(true)
    expect(await isUrlBlocked('https://gone.example/', { resolver: failWith('ENOTFOUND') })).toBe(true)
  })
})

describe('inspectHost: literals need no lookup', () => {
  it('vets IP literals without calling the resolver', async () => {
    const resolver = answer('10.0.0.1')
    expect(await inspectHost('93.184.216.34', { resolver })).toEqual({ blocked: false })
    expect(await inspectHost('[2606:2800:220:1::1]', { resolver })).toEqual({ blocked: false })
    expect(await inspectHost('127.0.0.1', { resolver })).toEqual({ blocked: true, reason: 'private-address' })
    expect(await inspectHost('[::ffff:7f00:1]', { resolver })).toEqual({ blocked: true, reason: 'private-address' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('counts each lookup through onLookup, and stops when it throws', async () => {
    const onLookup = vi.fn()
    const resolver = answer('93.184.216.34')
    await inspectHost('a.example', { resolver, onLookup })
    expect(onLookup).toHaveBeenCalledTimes(1)
    await inspectHost('93.184.216.34', { resolver, onLookup })
    expect(onLookup).toHaveBeenCalledTimes(1) // literals don't cost a lookup

    const stop = () => {
      throw new Error('budget')
    }
    await expect(inspectHost('b.example', { resolver, onLookup: stop })).rejects.toThrow('budget')
    expect(resolver).toHaveBeenCalledTimes(1) // the second lookup never ran
  })
})

describe('inspectUrl: URL forms', () => {
  const resolver = answer('93.184.216.34')

  it.each([
    'http://2130706433/', // decimal 127.0.0.1 → URL normalizes it
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/latest/meta-data/',
    'http://localhost/',
    'http://localhost./', // root-label dot
    'http://foo.localhost/',
    'http://0/',
    'http://[::]/',
  ])('blocks %s without needing DNS', async (url) => {
    expect(await inspectUrl(url, { resolver })).toEqual({ blocked: true, reason: 'private-address' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it.each(['ftp://example.com/', 'file:///etc/passwd', 'https://example.com:8443/', 'http://example.com:22/', 'not a url'])(
    'rejects %s (scheme, port or syntax)',
    async (url) => {
      expect(await inspectUrl(url, { resolver })).toEqual({ blocked: true, reason: 'invalid-url' })
    },
  )

  it('lets a public https URL through', async () => {
    expect(await inspectUrl('https://example.com/a?b=1', { resolver })).toEqual({ blocked: false })
    expect(resolver).toHaveBeenCalledWith('example.com')
  })
})

describe('createUrlGuard', () => {
  it('resolves each hostname once per guard, however many URLs use it', async () => {
    const resolver = answer('93.184.216.34')
    const guard = createUrlGuard({ resolver })
    for (const p of ['/a', '/b', '/c']) await guard.inspectUrl(`https://example.com${p}`)
    await guard.inspectUrl('http://EXAMPLE.com./d')
    await guard.inspectUrl('https://other.example/')
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(guard.lookups).toBe(2)
  })

  it('keeps URL-level rules per URL (the port) while sharing the host verdict', async () => {
    const guard = createUrlGuard({ resolver: answer('93.184.216.34') })
    expect((await guard.inspectUrl('https://example.com/')).blocked).toBe(false)
    expect((await guard.inspectUrl('https://example.com:8443/')).blocked).toBe(true)
  })

  it('remembers a blocked verdict too', async () => {
    const resolver = answer('10.0.0.1')
    const guard = createUrlGuard({ resolver })
    expect((await guard.inspectUrl('https://rebind.example/a')).reason).toBe('private-address')
    expect((await guard.inspectUrl('https://rebind.example/b')).reason).toBe('private-address')
    expect(resolver).toHaveBeenCalledTimes(1)
  })
})

describe('defaultHostResolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.doUnmock('node:dns')
  })

  /** Re-import the guard with a fake `node:dns` and a chosen runtime. */
  async function load(runtime: 'node' | 'workers', dns: Record<string, unknown>) {
    vi.resetModules()
    vi.doMock('node:dns', () => ({ promises: dns, default: { promises: dns } }))
    vi.stubGlobal('navigator', { userAgent: runtime === 'workers' ? 'Cloudflare-Workers' : 'Node.js/24' })
    return (await import('../helpers/ssrfGuard.js')).defaultHostResolver
  }

  const notFound = () => Object.assign(new Error('queryAaaa ENOTFOUND x'), { code: 'ENOTFOUND' })

  it('uses dns.lookup({ all: true }) on Node', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
    const resolve4 = vi.fn()
    const resolver = await load('node', { lookup, resolve4, resolve6: vi.fn() })
    expect(await resolver('example.com')).toEqual(['93.184.216.34'])
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true })
    expect(resolve4).not.toHaveBeenCalled()
  })

  it('uses resolve4 + resolve6 on Workers (lookup is documented as not implemented there)', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('Not implemented')
    })
    const resolver = await load('workers', {
      lookup,
      resolve4: vi.fn(async () => ['93.184.216.34']),
      resolve6: vi.fn(async () => ['2606:2800:220:1::1']),
    })
    expect(await resolver('example.com')).toEqual(['93.184.216.34', '2606:2800:220:1::1'])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('on Workers, a missing AAAA record is fine', async () => {
    const resolver = await load('workers', {
      resolve4: vi.fn(async () => ['93.184.216.34']),
      resolve6: vi.fn(async () => {
        throw notFound()
      }),
    })
    expect(await resolver('example.com')).toEqual(['93.184.216.34'])
  })

  it('on Workers, no records at all is ENOTFOUND', async () => {
    const resolver = await load('workers', {
      resolve4: vi.fn(async () => {
        throw notFound()
      }),
      resolve6: vi.fn(async () => {
        throw notFound()
      }),
    })
    await expect(resolver('gone.example')).rejects.toMatchObject({ code: 'ENOTFOUND' })
  })

  it('on Workers, a failing AAAA lookup fails the whole lookup even when A answered', async () => {
    const resolver = await load('workers', {
      resolve4: vi.fn(async () => ['93.184.216.34']),
      resolve6: vi.fn(async () => {
        throw Object.assign(new Error('queryAAAA EBADRESP x'), { code: 'EBADRESP' })
      }),
    })
    await expect(resolver('x.example')).rejects.toMatchObject({ code: 'EBADRESP' })
  })
})
