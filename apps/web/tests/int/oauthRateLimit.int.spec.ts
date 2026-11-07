import type { PayloadRequest } from 'payload'

import { describe, expect, it, vi } from 'vitest'

import { oauthRateLimit } from '@/plugins/oauthRateLimit'

const req = (ip?: string) =>
  ({ headers: new Headers(ip ? { 'cf-connecting-ip': ip } : {}) }) as unknown as PayloadRequest

describe('oauthRateLimit', () => {
  it('limits client registration per IP through the binding', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const rateLimit = oauthRateLimit({ limit } as unknown as RateLimit)!
    expect(await rateLimit({ endpoint: 'register', req: req('203.0.113.7') })).toBe(false)
    expect(limit).toHaveBeenCalledWith({ key: 'oauth-register:203.0.113.7' })
  })

  it("doesn't limit the token endpoint (AI clients refresh from shared servers)", async () => {
    const limit = vi.fn(async () => ({ success: false }))
    expect(
      await oauthRateLimit({ limit } as unknown as RateLimit)!({
        endpoint: 'token',
        req: req('203.0.113.7'),
      }),
    ).toBe(true)
    expect(limit).not.toHaveBeenCalled()
  })

  it('lets everything through without the binding', async () => {
    expect(await oauthRateLimit(undefined)!({ endpoint: 'register', req: req() })).toBe(true)
  })
})
