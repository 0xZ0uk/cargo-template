/**
 * Outbound link checker: SSRF-guarded HEAD (then GET) requests with manual redirects,
 * bounded concurrency, and a subrequest budget.
 *
 * Why the limits (Cloudflare Workers, paid plan, per invocation — see PLAN.md, P2 item 13):
 * - Subrequests: 10,000 (50 on Free). Every `fetch()` counts, each redirect hop counts, so
 *   does each D1/R2 call, and so does each `node:dns` lookup (two per host on Workers: A and
 *   AAAA). `SubrequestBudget` counts them here and stops starting links once spent.
 * - Open connections: 6 can wait for response headers at once; more queue. The pool runs
 *   at most `concurrency` (default 5) links at once, each with one request or lookup in
 *   flight, so the rest of the request (D1, R2) is never starved.
 * - Wall time: an HTTP request has no hard limit while the client is connected, but
 *   proxies cut idle responses at ~100 s. `deadline` stops the pool from starting new links
 *   past a point in time; the caller returns what it has and the rest continues next call.
 *
 * A link that was never attempted (budget or deadline) is returned in `skipped`, never as
 * a failure.
 */
import { createUrlGuard, dnsLookupCost, type BlockReason, type HostResolver, type UrlGuard } from './ssrfGuard.js'

export interface LinkCheckResult {
  status: number
  ok: boolean
  /** `blocked-private-ip`, `dns`, `timeout`, `ssl`, `connection` or `too-many-redirects`. */
  error?: string
  checkedAt: number
}

export interface LinkCheckerOptions {
  /** Links checked at once (default 5; Workers allow 6 open connections). */
  concurrency?: number
  /** Timeout of one request (default 5 s). */
  requestTimeoutMs?: number
  /** Timeout of one link, all hops and the GET fallback included (default 12 s). */
  linkTimeoutMs?: number
  /** Redirect hops followed (default 5). */
  maxRedirects?: number
  /** Subrequests this run may spend, DNS lookups included (default 1000). */
  maxSubrequests?: number
  /** Epoch ms after which no new link is started. */
  deadline?: number
  userAgent?: string
  /** Injected in tests. */
  fetchImpl?: typeof fetch
  guard?: UrlGuard
  /** DNS resolver for the default guard (injected in tests). */
  resolver?: HostResolver
  /** Subrequests one DNS lookup costs (default: 2 on Workers, else 1). */
  lookupCost?: number
}

export interface LinkCheckRun {
  results: Map<string, LinkCheckResult>
  /** URLs not attempted because the budget or deadline ran out. */
  skipped: string[]
  /** Subrequests spent (fetches + DNS lookups). */
  subrequests: number
  stoppedBy: 'budget' | 'deadline' | null
}

class BudgetExhausted extends Error {}

/** Counts subrequests; `take` throws once the limit would be crossed. */
export class SubrequestBudget {
  private spent = 0
  constructor(readonly limit: number) {}
  get used(): number {
    return this.spent
  }
  get remaining(): number {
    return Math.max(0, this.limit - this.spent)
  }
  take(n = 1): void {
    if (this.spent + n > this.limit) throw new BudgetExhausted('subrequest budget exhausted')
    this.spent += n
  }
}

/** Statuses where a HEAD answer says little: many servers mishandle HEAD, so retry as GET. */
const HEAD_UNRELIABLE = new Set([400, 403, 404, 405, 406, 500, 501])

const DEFAULT_UA = 'SeoAnalyzer-LinkChecker/1.0'

function errorKind(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout'
    const m = err.message
    if (m.includes('ENOTFOUND') || m.includes('getaddrinfo')) return 'dns'
    if (/certificate|SSL|TLS|ERR_TLS/i.test(m)) return 'ssl'
  }
  return 'connection'
}

function blockedResult(reason: BlockReason): LinkCheckResult {
  const now = Date.now()
  // A name that doesn't exist is a dead link, not a blocked one. Everything else the guard
  // refused (private address, a lookup that failed or timed out) is reported as blocked.
  if (reason === 'dns-not-found') return { status: 0, ok: false, error: 'dns', checkedAt: now }
  if (reason === 'dns-timeout') return { status: 0, ok: false, error: 'timeout', checkedAt: now }
  if (reason === 'dns-error' || reason === 'dns-no-address') return { status: 0, ok: false, error: 'dns', checkedAt: now }
  return { status: 0, ok: false, error: 'blocked-private-ip', checkedAt: now }
}

/** Check every URL, at most `concurrency` at a time. Never throws. */
export async function checkLinks(urls: string[], options: LinkCheckerOptions = {}): Promise<LinkCheckRun> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 6))
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000
  const linkTimeoutMs = options.linkTimeoutMs ?? 12_000
  const maxRedirects = options.maxRedirects ?? 5
  const budget = new SubrequestBudget(options.maxSubrequests ?? 1000)
  const lookupCost = options.lookupCost ?? dnsLookupCost()
  const fetchImpl = options.fetchImpl ?? fetch
  const guard =
    options.guard ?? createUrlGuard({ resolver: options.resolver, onLookup: () => budget.take(lookupCost) })
  const userAgent = options.userAgent ?? DEFAULT_UA

  const results = new Map<string, LinkCheckResult>()
  const skipped: string[] = []
  let stoppedBy: LinkCheckRun['stoppedBy'] = null

  /** One request with its own timeout, clipped to the link's remaining time. */
  async function request(url: string, method: 'HEAD' | 'GET', linkEnd: number): Promise<Response> {
    budget.take(1)
    const ms = Math.min(requestTimeoutMs, linkEnd - Date.now())
    if (ms <= 0) throw Object.assign(new Error('link timeout'), { name: 'TimeoutError' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
      const res = await fetchImpl(url, {
        method,
        signal: controller.signal,
        // Manual redirects: every hop is re-vetted, so a public URL can't 3xx us onto an
        // internal/metadata address.
        redirect: 'manual',
        headers: { 'User-Agent': userAgent, Accept: '*/*' },
      })
      // Only headers matter. Drop the body so the connection frees up (it counts toward
      // the 6 simultaneous connections until then).
      if (method === 'GET') void res.body?.cancel().catch(() => undefined)
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  /** Follow redirects with one method. `blocked` carries the guard's reason. */
  async function walk(
    startUrl: string,
    method: 'HEAD' | 'GET',
    linkEnd: number,
  ): Promise<LinkCheckResult | { blocked: BlockReason }> {
    let current = startUrl
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const verdict = await guard.inspectUrl(current)
      if (verdict.blocked) return { blocked: verdict.reason ?? 'private-address' }
      const res = await request(current, method, linkEnd)
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location || hop === maxRedirects) {
          return { status: res.status, ok: false, error: 'too-many-redirects', checkedAt: Date.now() }
        }
        try {
          current = new URL(location, current).toString()
        } catch {
          return { status: res.status, ok: false, error: 'connection', checkedAt: Date.now() }
        }
        continue
      }
      return { status: res.status, ok: res.ok, checkedAt: Date.now() }
    }
    return { status: 0, ok: false, error: 'too-many-redirects', checkedAt: Date.now() }
  }

  /** Throws only `BudgetExhausted`; every other failure becomes a result. */
  async function checkOne(url: string): Promise<LinkCheckResult> {
    const linkEnd = Date.now() + linkTimeoutMs
    try {
      let out = await walk(url, 'HEAD', linkEnd)
      if ('blocked' in out) return blockedResult(out.blocked)
      if (!out.ok && out.status && HEAD_UNRELIABLE.has(out.status)) {
        const retry = await walk(url, 'GET', linkEnd)
        out = 'blocked' in retry ? out : retry
      }
      return out
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err
      // A HEAD that errors (not times out) is retried once as GET: some servers reset on HEAD.
      if (errorKind(err) === 'connection') {
        try {
          const retry = await walk(url, 'GET', linkEnd)
          if (!('blocked' in retry)) return retry
        } catch (err2) {
          if (err2 instanceof BudgetExhausted) throw err2
          return { status: 0, ok: false, error: errorKind(err2), checkedAt: Date.now() }
        }
      }
      return { status: 0, ok: false, error: errorKind(err), checkedAt: Date.now() }
    }
  }

  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next
      if (i >= urls.length) return
      if (stoppedBy) return
      if (options.deadline !== undefined && Date.now() >= options.deadline) {
        stoppedBy = 'deadline'
        return
      }
      next++
      const url = urls[i]
      try {
        results.set(url, await checkOne(url))
      } catch (err) {
        if (!(err instanceof BudgetExhausted)) throw err
        stoppedBy = 'budget'
        skipped.push(url)
        return
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()))
  for (let i = next; i < urls.length; i++) skipped.push(urls[i])
  return { results, skipped, subrequests: budget.used, stoppedBy }
}
