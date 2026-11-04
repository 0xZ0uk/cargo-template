/**
 * SSRF guard — shared address/URL vetting for every URL the SERVER follows
 * (external-link checker, redirect hops…).
 *
 * The previous implementation matched IPv4 with a dotted-quad regex and IPv6 with
 * a couple of `startsWith` tests. That let `http://[::ffff:169.254.169.254]/`
 * through: `new URL()` normalizes the hostname to `[::ffff:a9fe:a9fe]`, which is
 * neither dotted-quad nor `fc`/`fd`/`fe80`/`::1`, and `dns.lookup()` echoes the
 * literal back unchanged — so both the hostname pass AND the DNS-rebinding pass
 * returned "public". Cloud metadata (169.254.169.254) and every loopback port were
 * reachable that way.
 *
 * This module parses addresses properly instead: IPv6 is expanded to its 8 groups
 * and any embedded IPv4 (`::ffff:*` mapped, `::*` compatible, 6to4, NAT64) is
 * re-checked with the IPv4 rules.
 */
import { promises as dns } from 'node:dns'

/** Ports the checker is allowed to reach — anything else is internal-service scanning. */
const ALLOWED_PORTS = new Set(['', '80', '443'])

/** True for reserved / non-routable IPv4 space. */
function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 0) return true                                   // 0.0.0.0/8 "this network"
  if (a === 10) return true                                  // 10.0.0.0/8
  if (a === 127) return true                                 // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true          // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true                    // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true           // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true           // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true                    // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true        // 198.18.0.0/15 benchmarking
  if (a >= 224) return true                                  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false
}

function parseIPv4(ip: string): [number, number, number, number] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1, 5).map(Number) as [number, number, number, number]
  if (parts.some((n) => n > 255)) return null
  return parts
}

/**
 * Expand an IPv6 literal to its 8 16-bit groups.
 * Handles `::` compression, a trailing dotted-quad, and a `%zone` suffix.
 */
function parseIPv6(input: string): number[] | null {
  let ip = input.toLowerCase().split('%')[0]
  if (!ip.includes(':')) return null

  // Trailing dotted-quad form (::ffff:127.0.0.1) → convert the quad to two groups.
  const lastColon = ip.lastIndexOf(':')
  const tail = ip.slice(lastColon + 1)
  const quad = parseIPv4(tail)
  if (quad) {
    const hi = ((quad[0] << 8) | quad[1]).toString(16)
    const lo = ((quad[2] << 8) | quad[3]).toString(16)
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`
  } else if (/\d+\.\d+/.test(tail)) {
    return null // malformed embedded IPv4
  }

  const doubleColon = ip.indexOf('::')
  let head: string[]
  let rear: string[]
  if (doubleColon >= 0) {
    if (ip.indexOf('::', doubleColon + 1) !== -1) return null // more than one `::`
    head = ip.slice(0, doubleColon).split(':').filter((s) => s !== '')
    rear = ip.slice(doubleColon + 2).split(':').filter((s) => s !== '')
    if (head.length + rear.length > 7) return null
  } else {
    head = ip.split(':')
    rear = []
    if (head.length !== 8) return null
  }

  const groups = [
    ...head,
    ...Array(8 - head.length - rear.length).fill('0'),
    ...rear,
  ]
  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out.push(parseInt(g, 16))
  }
  return out.length === 8 ? out : null
}

/** IPv4 embedded in an IPv6 address (mapped / compatible / 6to4 / NAT64), if any. */
function embeddedIPv4(g: number[]): [number, number, number, number] | null {
  const zeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated "compatible")
  if (zeroPrefix && (g[5] === 0xffff || g[5] === 0)) {
    return [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]
  }
  // 2002:a.b.c.d::/16 — 6to4
  if (g[0] === 0x2002) {
    return [(g[1] >> 8) & 0xff, g[1] & 0xff, (g[2] >> 8) & 0xff, g[2] & 0xff]
  }
  // 64:ff9b::/96 — NAT64 well-known prefix
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]
  }
  return null
}

/** True if the address (IPv4 or IPv6 literal) is loopback / private / link-local / reserved. */
export function isPrivateIP(rawIp: string): boolean {
  if (typeof rawIp !== 'string' || !rawIp) return true
  const ip = rawIp.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase()

  const v4 = parseIPv4(ip)
  if (v4) return isPrivateIPv4(v4[0], v4[1], v4[2], v4[3])

  const g = parseIPv6(ip)
  if (!g) {
    // Neither a valid IPv4 nor IPv6 literal → not an address we can vet here.
    // (Hostnames are resolved separately; a bare hostname reaches this function
    // only through DNS results, which are always literals.)
    return false
  }

  // Any embedded IPv4 is re-checked with the IPv4 rules — this is the hole that
  // `http://[::ffff:169.254.169.254]/` walked through.
  const mapped = embeddedIPv4(g)
  if (mapped) return isPrivateIPv4(mapped[0], mapped[1], mapped[2], mapped[3])

  if (g.every((x) => x === 0)) return true                               // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true     // ::1 loopback
  if ((g[0] & 0xfe00) === 0xfc00) return true                            // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true                            // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true                            // ff00::/8 multicast
  return false
}

/** Strip the root-label dot (`localhost.` is the same host as `localhost`). */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '')
}

/** Hostname-level checks: localhost aliases, raw IP literals, non-web ports. */
export function isPrivateUrl(urlString: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return true // unparseable → block as a precaution
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  // Port allowlist: without it the checker doubles as an internal port scanner.
  if (!ALLOWED_PORTS.has(parsed.port)) return true

  const hostname = normalizeHostname(parsed.hostname)
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '' || hostname === '0') return true

  const rawIp = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  return isPrivateIP(rawIp)
}

// ---------------------------------------------------------------------------
// DNS resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a hostname to the strings its DNS answers contain. Entries that aren't IP
 * literals (workerd also returns CNAME targets, e.g. `dyna.wikimedia.org.`) are ignored
 * by the guard, so a resolver may return its raw answer.
 */
export type HostResolver = (hostname: string) => Promise<string[]>

/** Why a URL was refused. DNS reasons are all fail-closed. */
export type BlockReason =
  | 'invalid-url' //       unparseable, not http(s), or a port other than 80/443
  | 'private-address' //   a literal or any resolved address is loopback/private/link-local/reserved
  | 'dns-not-found' //     the name doesn't exist (NXDOMAIN / no address records)
  | 'dns-timeout' //       the lookup didn't answer in time
  | 'dns-error' //         the lookup failed some other way (SERVFAIL, bad response, unsupported)
  | 'dns-no-address' //    the lookup answered but gave no usable IP address

export interface GuardVerdict {
  blocked: boolean
  reason?: BlockReason
}

export interface GuardOptions {
  /** Defaults to `defaultHostResolver`. */
  resolver?: HostResolver
  /** Give up on a lookup after this long (default 4s). */
  timeoutMs?: number
  /**
   * Called right before each DNS lookup, so a caller can count it against the Workers
   * subrequest budget. If it throws, the error propagates (the lookup is not run).
   */
  onLookup?: () => void
}

const DEFAULT_DNS_TIMEOUT_MS = 4000

/** True on Cloudflare Workers (workerd sets this user agent). */
export function isWorkersRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}

/** DNS lookups the default resolver makes per hostname (A + AAAA on Workers, one `lookup` on Node). */
export function dnsLookupCost(): number {
  return isWorkersRuntime() ? 2 : 1
}

function errCode(e: unknown): string {
  return typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : ''
}

const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN'])

/**
 * The default resolver.
 *
 * - Node (and anything else): `dns.lookup(host, { all: true })`, i.e. getaddrinfo, the same
 *   resolution `fetch` uses, so there is no gap between what we vet and what we connect to.
 * - Workers: `dns.resolve4` + `dns.resolve6`. workerd implements `node:dns` over DNS-over-HTTPS
 *   (1.1.1.1). Cloudflare's docs list `lookup` as "not implemented" even though it works in
 *   workerd 1.20261023, so the documented functions are used instead. Each call is a
 *   subrequest (two per host: see `dnsLookupCost`). Either family failing for any reason
 *   other than "no such record" fails the whole lookup (closed): a flaky AAAA must not hide
 *   a private IPv6 address.
 */
export const defaultHostResolver: HostResolver = async (hostname) => {
  if (!isWorkersRuntime()) {
    const answers = await dns.lookup(hostname, { all: true })
    return answers.map((a) => a.address)
  }
  const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)])
  const failure = [v4, v6].find(
    (r): r is PromiseRejectedResult => r.status === 'rejected' && !NOT_FOUND_CODES.has(errCode(r.reason)),
  )
  if (failure) throw failure.reason
  const addresses = [v4, v6].flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  if (!addresses.length) {
    const notFound = Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })
    throw notFound
  }
  return addresses
}

function isIPLiteral(s: string): boolean {
  return parseIPv4(s) !== null || parseIPv6(s) !== null
}

class LookupTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LookupTimeout('dns lookup timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * DNS-rebinding protection: resolve the hostname and block if ANY returned address is
 * private. Checking only the first answer left a trivial bypass — a name with one public
 * and one internal A record. Every failure blocks, with the reason.
 */
export async function inspectHost(hostname: string, opts: GuardOptions = {}): Promise<GuardVerdict> {
  const host = normalizeHostname(hostname).replace(/^\[/, '').replace(/\]$/, '')
  if (!host) return { blocked: true, reason: 'invalid-url' }
  // Literals need no lookup (and workerd's `resolve4` rejects them).
  if (isIPLiteral(host)) return isPrivateIP(host) ? { blocked: true, reason: 'private-address' } : { blocked: false }

  const resolver = opts.resolver ?? defaultHostResolver
  opts.onLookup?.()
  let answers: string[]
  try {
    answers = await withTimeout(resolver(host), opts.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS)
  } catch (e) {
    if (e instanceof LookupTimeout) return { blocked: true, reason: 'dns-timeout' }
    return { blocked: true, reason: NOT_FOUND_CODES.has(errCode(e)) ? 'dns-not-found' : 'dns-error' }
  }
  const ips = Array.isArray(answers) ? answers.filter((a) => typeof a === 'string' && isIPLiteral(a)) : []
  if (!ips.length) return { blocked: true, reason: 'dns-no-address' }
  return ips.some((ip) => isPrivateIP(ip)) ? { blocked: true, reason: 'private-address' } : { blocked: false }
}

/** Hostname/port policy + DNS-resolved addresses, with the reason when blocked. */
export async function inspectUrl(url: string, opts: GuardOptions = {}): Promise<GuardVerdict> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { blocked: true, reason: 'invalid-url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { blocked: true, reason: 'invalid-url' }
  if (!ALLOWED_PORTS.has(parsed.port)) return { blocked: true, reason: 'invalid-url' }
  if (isPrivateUrl(url)) return { blocked: true, reason: 'private-address' }
  return inspectHost(parsed.hostname, opts)
}

/**
 * Guard that remembers its verdict per hostname, so a scan resolves each host once
 * (links to the same site, redirect hops back to it) instead of once per URL.
 */
export interface UrlGuard {
  inspectUrl(url: string): Promise<GuardVerdict>
  /** Hosts resolved so far. */
  readonly lookups: number
}

export function createUrlGuard(opts: GuardOptions = {}): UrlGuard {
  const verdicts = new Map<string, Promise<GuardVerdict>>()
  let lookups = 0
  const counted: GuardOptions = {
    ...opts,
    onLookup: () => {
      opts.onLookup?.()
      lookups++
    },
  }
  return {
    get lookups() {
      return lookups
    },
    async inspectUrl(url) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { blocked: true, reason: 'invalid-url' }
      }
      // The URL-level rules are cheap and depend on the port, so only the DNS part is memoized.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { blocked: true, reason: 'invalid-url' }
      if (!ALLOWED_PORTS.has(parsed.port)) return { blocked: true, reason: 'invalid-url' }
      if (isPrivateUrl(url)) return { blocked: true, reason: 'private-address' }
      const key = normalizeHostname(parsed.hostname)
      let verdict = verdicts.get(key)
      if (!verdict) {
        verdict = inspectHost(parsed.hostname, counted)
        verdicts.set(key, verdict)
      }
      return verdict
    },
  }
}

export async function resolveAndCheckPrivate(hostname: string, opts?: GuardOptions): Promise<boolean> {
  return (await inspectHost(hostname, opts)).blocked
}

/** Full gate: hostname/port policy + DNS-resolved addresses. */
export async function isUrlBlocked(url: string, opts?: GuardOptions): Promise<boolean> {
  return (await inspectUrl(url, opts)).blocked
}
