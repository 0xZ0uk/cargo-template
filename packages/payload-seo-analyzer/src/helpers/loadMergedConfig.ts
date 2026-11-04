/**
 * Shared helper: loads SEO settings from DB and merges with plugin config.
 * Used by the analysis endpoints (validate, audit, AI) and the score-history hook.
 */

import type { SeoConfig } from '../types.js'

export interface MergedConfigResult {
  config: SeoConfig
  ignoredSlugs: string[]
}

/**
 * Load SeoSettings from DB and merge with plugin config.
 * Returns the merged config and a list of ignored slugs (from settings).
 */
export async function loadMergedConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  pluginConfig?: SeoConfig,
): Promise<MergedConfigResult> {
  let ignoredSlugs: string[] = []
  let mergedConfig: SeoConfig = { ...pluginConfig }

  try {
    const settingsResult = await payload.find({
      collection: 'seo-settings',
      limit: 1,
      overrideAccess: true,
    })
    const settings = settingsResult.docs?.[0]
    if (settings) {
      // Merge ignored slugs
      if (Array.isArray(settings.ignoredSlugs)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ignoredSlugs = settings.ignoredSlugs.map((s: any) => s.slug || s).filter(Boolean)
      }

      // Merge disabled rules
      if (Array.isArray(settings.disabledRules) && settings.disabledRules.length > 0) {
        const existing = mergedConfig.disabledRules || []
        const combined = [...new Set([...existing, ...settings.disabledRules])]
        mergedConfig = { ...mergedConfig, disabledRules: combined as SeoConfig['disabledRules'] }
      }

      // Merge site name
      if (settings.siteName) {
        mergedConfig = { ...mergedConfig, siteName: settings.siteName }
      }

      // Merge thresholds
      if (settings.thresholds && typeof settings.thresholds === 'object') {
        const thresholds: Record<string, number> = {}
        for (const [key, val] of Object.entries(settings.thresholds)) {
          if (val != null && typeof val === 'number') {
            thresholds[key] = val
          }
        }
        if (Object.keys(thresholds).length > 0) {
          mergedConfig = {
            ...mergedConfig,
            thresholds: { ...(mergedConfig.thresholds || {}), ...thresholds },
          }
        }
      }
    }
  } catch {
    // SeoSettings collection might not exist yet — use plugin config as-is
  }

  return { config: mergedConfig, ignoredSlugs }
}
