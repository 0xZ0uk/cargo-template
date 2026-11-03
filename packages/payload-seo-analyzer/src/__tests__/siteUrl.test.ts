import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveSiteUrl } from '../helpers/siteUrl.js'

describe('resolveSiteUrl', () => {
  const prev = process.env.SITE_URL
  beforeEach(() => {
    delete process.env.SITE_URL
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.SITE_URL
    else process.env.SITE_URL = prev
  })

  it('prefers the configured siteUrl, then SITE_URL, then the fallback, then empty', () => {
    process.env.SITE_URL = 'https://env.example'
    expect(resolveSiteUrl('https://config.example', 'http://fallback')).toBe('https://config.example')
    expect(resolveSiteUrl(undefined, 'http://fallback')).toBe('https://env.example')
    expect(resolveSiteUrl('', 'http://fallback')).toBe('https://env.example')
    delete process.env.SITE_URL
    expect(resolveSiteUrl(undefined, 'http://fallback')).toBe('http://fallback')
    expect(resolveSiteUrl()).toBe('')
  })

  it('strips trailing slashes and whitespace from every source', () => {
    expect(resolveSiteUrl('https://a.example///')).toBe('https://a.example')
    process.env.SITE_URL = ' https://b.example/ '
    expect(resolveSiteUrl()).toBe('https://b.example')
    delete process.env.SITE_URL
    expect(resolveSiteUrl(undefined, 'http://c.example/')).toBe('http://c.example')
  })

  it('ignores the Next.js variables', () => {
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://next.example'
    process.env.PAYLOAD_PUBLIC_SERVER_URL = 'https://legacy.example'
    try {
      expect(resolveSiteUrl()).toBe('')
    } finally {
      delete process.env.NEXT_PUBLIC_SERVER_URL
      delete process.env.PAYLOAD_PUBLIC_SERVER_URL
    }
  })
})
