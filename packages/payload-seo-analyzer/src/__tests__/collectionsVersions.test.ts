import { describe, expect, it } from 'vitest'
import { createSeoGscAuthCollection } from '../collections/SeoGscAuth.js'
import { createSeoLogsCollection } from '../collections/SeoLogs.js'
import { createSeoPerformanceCollection } from '../collections/SeoPerformance.js'
import { createSeoRankHistoryCollection } from '../collections/SeoRankHistory.js'
import { createSeoRedirectsCollection } from '../collections/SeoRedirects.js'
import { createSeoScoreHistoryCollection } from '../collections/SeoScoreHistory.js'
import { createSeoSettingsCollection } from '../collections/SeoSettings.js'

// Payload 4 defaults `versions` to true. Left implicit, the plugin's collections would get
// version tables (and fail to sanitize where `timestamps: false`).
describe('plugin collections opt out of Payload 4 default versioning', () => {
  it.each([
    ['seo-gsc-auth', createSeoGscAuthCollection()],
    ['seo-logs', createSeoLogsCollection()],
    ['seo-performance', createSeoPerformanceCollection()],
    ['seo-rank-history', createSeoRankHistoryCollection()],
    ['seo-redirects', createSeoRedirectsCollection()],
    ['seo-score-history', createSeoScoreHistoryCollection()],
    ['seo-settings', createSeoSettingsCollection()],
  ])('%s', (_slug, collection) => {
    expect(collection.versions).toBe(false)
  })
})
