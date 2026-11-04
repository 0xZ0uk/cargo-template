import { describe, expect, it } from 'vitest'

import { newsLanguage } from '../endpoints/sitemapExtensions.js'

describe('newsLanguage', () => {
  it("uses Payload's default content locale", () => {
    expect(newsLanguage({ localization: { defaultLocale: 'de', locales: ['de', 'en'] } })).toBe('de')
    expect(newsLanguage({ localization: { defaultLocale: 'zh-CN' } })).toBe('zh-cn')
  })

  it('falls back to en without localization', () => {
    expect(newsLanguage({})).toBe('en')
    expect(newsLanguage({ localization: false })).toBe('en')
  })
})
