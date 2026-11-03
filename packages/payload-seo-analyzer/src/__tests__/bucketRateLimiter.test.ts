import { describe, expect, it, vi } from 'vitest'
import { SEO_RATE_LIMITS, createBucketRateLimiter } from '../rateLimiter.js'

describe('createBucketRateLimiter', () => {
  it('uses the in-memory limiter with the bucket limit when no host limiter is given', async () => {
    const limiter = createBucketRateLimiter('expensive')
    const results = []
    for (let i = 0; i < SEO_RATE_LIMITS.expensive.limit + 1; i++) results.push(await limiter.check('user:users:1'))
    expect(results.filter(Boolean)).toHaveLength(SEO_RATE_LIMITS.expensive.limit)
    expect(results.at(-1)).toBe(false)
    // Other callers have their own count.
    expect(await limiter.check('user:users:2')).toBe(true)
  })

  it("follows the host's answer", async () => {
    const host = vi.fn(async ({ key }: { key: string }) => key !== 'ip:blocked')
    const limiter = createBucketRateLimiter('audit-poll', host)
    expect(await limiter.check('ip:ok')).toBe(true)
    expect(await limiter.check('ip:blocked')).toBe(false)
    expect(host).toHaveBeenCalledWith({ bucket: 'audit-poll', key: 'ip:ok' })
  })

  it('falls back to the in-memory limiter when the host returns undefined or throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const host of [vi.fn(() => undefined), vi.fn(() => Promise.reject(new Error('binding down')))]) {
      const limiter = createBucketRateLimiter('expensive', host)
      const results = []
      for (let i = 0; i < SEO_RATE_LIMITS.expensive.limit + 1; i++) results.push(await limiter.check('k'))
      expect(results.at(-1)).toBe(false)
    }
    // The thrown error is reported once, not on every request.
    expect(console.warn).toHaveBeenCalledTimes(1)
  })
})
