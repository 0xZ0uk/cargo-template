import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkLinks, SubrequestBudget } from '../helpers/linkChecker.js'
import type { HostResolver } from '../helpers/ssrfGuard.js'

const PUBLIC: HostResolver = async () => ['93.184.216.34']

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/** A fetch stub that records calls and the peak number of requests in flight. */
function fakeFetch(handler: Handler, delayMs = 0) {
  const calls: Array<{ url: string; method: string }> = []
  let inFlight = 0
  let peak = 0
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, method: String(init.method) })
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      return await handler(url, init)
    } finally {
      inFlight--
    }
  }) as unknown as typeof fetch
  return { fn, calls, peak: () => peak }
}

const ok = () => new Response(null, { status: 200 })
const urls = (n: number, host = 'example.com') => Array.from({ length: n }, (_, i) => `https://${host}/p${i}`)

afterEach(() => vi.useRealTimers())

describe('concurrency', () => {
  it('never has more than `concurrency` requests in flight', async () => {
    const f = fakeFetch(ok, 5)
    const run = await checkLinks(urls(30), { fetchImpl: f.fn, resolver: PUBLIC, concurrency: 4 })
    expect(run.results.size).toBe(30)
    expect(f.peak()).toBeLessThanOrEqual(4)
    expect(f.peak()).toBeGreaterThan(1)
  })

  it('is clamped to 6, the Workers open-connection limit', async () => {
    const f = fakeFetch(ok, 5)
    await checkLinks(urls(40), { fetchImpl: f.fn, resolver: PUBLIC, concurrency: 50 })
    expect(f.peak()).toBeLessThanOrEqual(6)
  })

  it('defaults to 5', async () => {
    const f = fakeFetch(ok, 5)
    await checkLinks(urls(40), { fetchImpl: f.fn, resolver: PUBLIC })
    expect(f.peak()).toBeLessThanOrEqual(5)
  })
})

describe('subrequest budget', () => {
  it('SubrequestBudget refuses to cross its limit', () => {
    const b = new SubrequestBudget(3)
    b.take(2)
    expect(() => b.take(2)).toThrow()
    expect(b.used).toBe(2)
    b.take(1)
    expect(b.remaining).toBe(0)
  })

  it('counts fetches and DNS lookups, then skips the rest instead of failing them', async () => {
    const f = fakeFetch(ok)
    // Each distinct host costs 2 (lookup) + 1 (HEAD) = 3. Budget 10 → 3 links, the 4th is skipped.
    const list = [1, 2, 3, 4, 5, 6].map((i) => `https://h${i}.example/`)
    const run = await checkLinks(list, { fetchImpl: f.fn, resolver: PUBLIC, concurrency: 1, maxSubrequests: 10, lookupCost: 2 })
    expect([...run.results.keys()]).toEqual(list.slice(0, 3))
    expect(run.skipped).toEqual(list.slice(3))
    expect(run.stoppedBy).toBe('budget')
    expect(run.subrequests).toBeLessThanOrEqual(10)
    expect(f.calls).toHaveLength(3)
  })

  it('never spends more than the budget, whatever the concurrency', async () => {
    const f = fakeFetch(ok, 2)
    const list = Array.from({ length: 60 }, (_, i) => `https://h${i}.example/`)
    const run = await checkLinks(list, { fetchImpl: f.fn, resolver: PUBLIC, concurrency: 6, maxSubrequests: 50, lookupCost: 2 })
    expect(run.subrequests).toBeLessThanOrEqual(50)
    expect(f.calls.length + 2 * list.length).toBeGreaterThan(0)
    expect(run.results.size + run.skipped.length).toBe(60)
    expect(run.skipped.length).toBeGreaterThan(0)
  })

  it('an unchecked link is never reported as broken', async () => {
    const f = fakeFetch(ok)
    const run = await checkLinks(urls(5, 'a.example'), { fetchImpl: f.fn, resolver: PUBLIC, concurrency: 1, maxSubrequests: 1, lookupCost: 2 })
    expect(run.results.size).toBe(0)
    expect(run.skipped).toHaveLength(5)
    expect(f.calls).toHaveLength(0)
  })

  it('counts every redirect hop and GET fallback', async () => {
    const f = fakeFetch((url, init) => {
      if (url.endsWith('/start')) return new Response(null, { status: 301, headers: { location: 'https://example.com/mid' } })
      if (url.endsWith('/mid')) return new Response(null, { status: 302, headers: { location: '/end' } })
      return init.method === 'HEAD' ? new Response(null, { status: 405 }) : ok()
    })
    const run = await checkLinks(['https://example.com/start'], { fetchImpl: f.fn, resolver: PUBLIC, lookupCost: 2 })
    // 1 lookup (host memoized across hops) = 2, HEAD start, HEAD mid, HEAD end (405), then GET start, mid, end.
    expect(f.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'HEAD /start',
      'HEAD /mid',
      'HEAD /end',
      'GET /start',
      'GET /mid',
      'GET /end',
    ])
    expect(run.subrequests).toBe(2 + 6)
    expect(run.results.get('https://example.com/start')).toMatchObject({ status: 200, ok: true })
  })
})

describe('dedupe by host', () => {
  it('resolves a host once for many URLs', async () => {
    const f = fakeFetch(ok)
    const resolver = vi.fn(PUBLIC)
    const run = await checkLinks(urls(25), { fetchImpl: f.fn, resolver, lookupCost: 2 })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(run.subrequests).toBe(2 + 25)
  })
})

describe('HEAD then GET', () => {
  it.each([400, 403, 404, 405, 501])('retries a HEAD %i as GET and trusts the GET', async (status) => {
    const f = fakeFetch((_u, init) => (init.method === 'HEAD' ? new Response(null, { status }) : ok()))
    const run = await checkLinks(['https://example.com/x'], { fetchImpl: f.fn, resolver: PUBLIC })
    expect(f.calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
    expect(run.results.get('https://example.com/x')).toMatchObject({ status: 200, ok: true })
  })

  it('a real 404 stays broken after the GET agrees', async () => {
    const f = fakeFetch(() => new Response(null, { status: 404 }))
    const run = await checkLinks(['https://example.com/gone'], { fetchImpl: f.fn, resolver: PUBLIC })
    expect(run.results.get('https://example.com/gone')).toMatchObject({ status: 404, ok: false })
    expect(run.results.get('https://example.com/gone')?.error).toBeUndefined()
  })

  it('does not retry a good HEAD', async () => {
    const f = fakeFetch(ok)
    await checkLinks(['https://example.com/x'], { fetchImpl: f.fn, resolver: PUBLIC })
    expect(f.calls.map((c) => c.method)).toEqual(['HEAD'])
  })

  it('retries a HEAD that errors, but not one that times out', async () => {
    const reset = fakeFetch((_u, init) => {
      if (init.method === 'HEAD') throw new TypeError('connection reset')
      return ok()
    })
    const a = await checkLinks(['https://example.com/x'], { fetchImpl: reset.fn, resolver: PUBLIC })
    expect(reset.calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
    expect(a.results.get('https://example.com/x')).toMatchObject({ ok: true })

    const hang = vi.fn((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }),
    ) as unknown as typeof fetch
    const b = await checkLinks(['https://example.com/slow'], { fetchImpl: hang, resolver: PUBLIC, requestTimeoutMs: 20 })
    expect(hang).toHaveBeenCalledTimes(1)
    expect(b.results.get('https://example.com/slow')).toMatchObject({ ok: false, error: 'timeout', status: 0 })
  })

  it('caps one link at linkTimeoutMs across hops', async () => {
    const f = fakeFetch((url) => new Response(null, { status: 301, headers: { location: `${url}x` } }), 30)
    const t0 = Date.now()
    const run = await checkLinks(['https://example.com/a'], {
      fetchImpl: f.fn,
      resolver: PUBLIC,
      linkTimeoutMs: 70,
      requestTimeoutMs: 1000,
      maxRedirects: 50,
    })
    expect(Date.now() - t0).toBeLessThan(400)
    expect(run.results.get('https://example.com/a')?.error).toBe('timeout')
  })

  it('cancels GET bodies so connections free up', async () => {
    const cancel = vi.fn(async () => undefined)
    const body = { cancel } as unknown as ReadableStream
    const f = fakeFetch((_u, init) => (init.method === 'HEAD' ? new Response(null, { status: 405 }) : Object.defineProperty(ok(), 'body', { value: body })))
    await checkLinks(['https://example.com/x'], { fetchImpl: f.fn, resolver: PUBLIC })
    expect(cancel).toHaveBeenCalled()
  })
})

describe('redirects and the guard', () => {
  it('blocks a redirect onto a private address without fetching it', async () => {
    const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
    const run = await checkLinks(['https://example.com/r'], { fetchImpl: f.fn, resolver: PUBLIC })
    expect(run.results.get('https://example.com/r')).toMatchObject({ ok: false, status: 0, error: 'blocked-private-ip' })
    expect(f.calls.map((c) => c.url)).toEqual(['https://example.com/r'])
  })

  it('blocks a redirect to a host that resolves privately', async () => {
    const resolver: HostResolver = async (h) => (h === 'internal.example' ? ['10.0.0.9'] : ['93.184.216.34'])
    const f = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://internal.example/' } }))
    const run = await checkLinks(['https://example.com/r'], { fetchImpl: f.fn, resolver })
    expect(run.results.get('https://example.com/r')?.error).toBe('blocked-private-ip')
    expect(f.calls).toHaveLength(1)
  })

  it('never fetches a private link', async () => {
    const f = fakeFetch(ok)
    const run = await checkLinks(['http://localhost/a', 'http://10.0.0.1/', 'http://[::1]/', 'https://rebind.example/'], {
      fetchImpl: f.fn,
      resolver: async (h) => (h === 'rebind.example' ? ['192.168.0.2'] : ['93.184.216.34']),
    })
    expect([...run.results.values()].map((r) => r.error)).toEqual(Array(4).fill('blocked-private-ip'))
    expect(f.calls).toHaveLength(0)
  })

  it('reports an unknown host as dns (a dead link) and a failing lookup as dns, not as private', async () => {
    const f = fakeFetch(ok)
    const run = await checkLinks(['https://gone.example/', 'https://flaky.example/'], {
      fetchImpl: f.fn,
      resolver: async (h) => {
        throw Object.assign(new Error('x'), { code: h === 'gone.example' ? 'ENOTFOUND' : 'ESERVFAIL' })
      },
    })
    expect(run.results.get('https://gone.example/')).toMatchObject({ ok: false, error: 'dns' })
    expect(run.results.get('https://flaky.example/')).toMatchObject({ ok: false, error: 'dns' })
    expect(f.calls).toHaveLength(0)
  })

  it('stops at too many redirects', async () => {
    const f = fakeFetch((url) => new Response(null, { status: 301, headers: { location: `${url}x` } }))
    const run = await checkLinks(['https://example.com/a'], { fetchImpl: f.fn, resolver: PUBLIC, maxRedirects: 3 })
    expect(run.results.get('https://example.com/a')).toMatchObject({ ok: false, error: 'too-many-redirects' })
    // HEAD chain only: the 301 isn't a HEAD-unreliable status
    expect(f.calls).toHaveLength(4)
  })
})

describe('deadline', () => {
  it('starts no new link past the deadline and returns the rest as skipped', async () => {
    const f = fakeFetch(ok, 20)
    const run = await checkLinks(urls(20), {
      fetchImpl: f.fn,
      resolver: PUBLIC,
      concurrency: 2,
      deadline: Date.now() + 50,
    })
    expect(run.stoppedBy).toBe('deadline')
    expect(run.results.size).toBeGreaterThan(0)
    expect(run.skipped.length).toBeGreaterThan(0)
    expect(run.results.size + run.skipped.length).toBe(20)
  })
})
