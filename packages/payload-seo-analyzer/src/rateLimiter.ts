/**
 * Simple in-memory rate limiter for SEO plugin endpoints.
 * Tracks requests per IP address using a sliding window approach.
 * No external dependencies — uses a plain Map with periodic cleanup.
 */

interface RateLimitEntry {
  timestamps: number[]
}

export interface RateLimiter {
  /** Check if the request should be allowed. Returns true if allowed, false if rate-limited. */
  check(ip: string): boolean
}

/**
 * Create a rate limiter that allows `maxRequests` within `windowMs` milliseconds.
 * Automatically cleans up stale entries every 60 seconds.
 *
 * @param maxRequests - Maximum number of requests per window
 * @param windowMs - Window duration in milliseconds
 */
export function createRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const store = new Map<string, RateLimitEntry>()

  // Expired entries are swept lazily from check() at most once a minute. A
  // setInterval here would run while the Payload config is being built, i.e. at
  // module scope, which Cloudflare Workers rejects ("Disallowed operation called
  // within global scope"), and it would keep Node processes awake.
  const sweepEveryMs = 60_000
  let lastSweep = Date.now()
  const sweep = (now: number) => {
    lastSweep = now
    for (const [ip, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
      if (entry.timestamps.length === 0) {
        store.delete(ip)
      }
    }
  }

  return {
    check(ip: string): boolean {
      const now = Date.now()
      if (now - lastSweep >= sweepEveryMs) sweep(now)
      let entry = store.get(ip)

      if (!entry) {
        entry = { timestamps: [] }
        store.set(ip, entry)
      }

      // Remove timestamps outside the current window
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

      if (entry.timestamps.length >= maxRequests) {
        return false // Rate limited
      }

      entry.timestamps.push(now)
      return true // Allowed
    },
  }
}

/**
 * Extract client IP from a Payload request.
 * Prefers Cloudflare's `cf-connecting-ip` (set by the edge, not spoofable by the
 * client), then x-forwarded-for, then x-real-ip.
 */
export function getClientIp(req: { headers: Headers }): string {
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp) {
    return cfIp.trim()
  }

  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
    return forwarded.split(',')[0].trim()
  }

  const realIp = req.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  return 'unknown'
}

/**
 * Bucket key for a rate limiter, shared by every limited path in the plugin.
 *
 * The authenticated user comes first because it is NOT spoofable, unlike
 * `X-Forwarded-For`: a caller who varies that header gets a fresh bucket on every
 * request and the limiter never fires. Ids are only unique WITHIN an auth
 * collection — `users#3` and `customers#3` are different people — so the key is
 * scoped by collection. Anonymous callers (public endpoints, host middleware
 * relaying a visitor) fall back to the best-effort client IP.
 */
export function rateLimitKey(req: {
  headers: Headers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user?: any
}): string {
  const user = req?.user as { id?: string | number; collection?: string } | undefined | null
  const id = user?.id
  if (id !== undefined && id !== null) {
    return `user:${user?.collection ?? 'unknown'}:${id}`
  }
  return `ip:${getClientIp(req)}`
}
