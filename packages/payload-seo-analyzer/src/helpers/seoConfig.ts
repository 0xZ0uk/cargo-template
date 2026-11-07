/**
 * The effective analyzer config: the plugin's `SeoConfig` with the saved `/admin/seo-config`
 * settings layered on top. One merge for both sides: `loadMergedConfig` applies it on the
 * server (`/validate`, the audit, `/sidebar-content`), `useSeoConfig` in the admin (the length
 * counters, the previews, and the sidebar until `/sidebar-content` answers with the server's).
 *
 * Client-safe: no Payload imports.
 */
import type { RuleGroup, SeoConfig } from '../types.js'
import { mergeThresholds } from './thresholds.js'

/** The saved settings the merge reads (the `seo-settings` document, or `/settings`' `settings`). */
export interface SavedSeoSettings {
  disabledRules?: unknown
  siteName?: unknown
  thresholds?: unknown
}

/**
 * Layers saved settings over the plugin config: saved `disabledRules` add to the plugin's,
 * a saved `siteName` replaces it, saved thresholds win per value (numbers only).
 */
export function mergeSavedSettings(config: SeoConfig | undefined, saved: SavedSeoSettings | null | undefined): SeoConfig {
  let merged: SeoConfig = { ...config }
  if (!saved || typeof saved !== 'object') return merged

  if (Array.isArray(saved.disabledRules) && saved.disabledRules.length > 0) {
    const combined = [...new Set([...(merged.disabledRules ?? []), ...saved.disabledRules])]
    merged = { ...merged, disabledRules: combined as RuleGroup[] }
  }
  if (typeof saved.siteName === 'string' && saved.siteName) {
    merged = { ...merged, siteName: saved.siteName }
  }
  const thresholds = mergeThresholds(
    merged.thresholds,
    saved.thresholds && typeof saved.thresholds === 'object' ? (saved.thresholds as Record<string, unknown>) : null,
  )
  if (thresholds) merged = { ...merged, thresholds }
  return merged
}

/**
 * The part of a config that can travel to the browser as JSON: functions (`excludeDocs`) and
 * regular expressions (`localSeoPattern`) are dropped, everything else is kept, so an option
 * added to `SeoConfig` later reaches the sidebar without a list to update. The analyzer reads
 * neither of the dropped kinds from a plugin option (`localSeoPattern` is not one).
 */
export function clientSeoConfig(config: SeoConfig | undefined): SeoConfig {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || typeof value === 'function' || value instanceof RegExp) continue
    out[key] = value
  }
  return out as SeoConfig
}
