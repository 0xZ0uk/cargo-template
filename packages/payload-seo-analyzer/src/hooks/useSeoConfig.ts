'use client'

import { useEffect, useMemo, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import type { SeoConfig } from '../types.js'
import { mergeSavedSettings, type SavedSeoSettings } from '../helpers/seoConfig.js'
import { resolveThresholds, type ResolvedThresholds } from '../helpers/thresholds.js'
import { useSeoApi } from './useSeoApi.js'

type SavedSettings = SavedSeoSettings | null

/**
 * One `/settings` request shared by every consumer on the page (the sidebar, the field
 * counters, the previews), keyed by the endpoint URL. The entry expires after a short time
 * and `invalidateSeoConfig()` drops it on save, so an edited setting shows up without a
 * reload. A failed request is not kept: the next consumer retries.
 */
const SETTINGS_TTL_MS = 30_000
const settingsCache = new Map<string, { at: number; promise: Promise<SavedSettings> }>()

function fetchSavedSettings(url: string): Promise<SavedSettings> {
  const hit = settingsCache.get(url)
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.promise
  const promise = fetch(url, { credentials: 'include', cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { settings?: SavedSeoSettings } | null) => {
      const settings = data?.settings && typeof data.settings === 'object' ? data.settings : null
      // Nothing usable (error, empty): do not pin it, the next consumer tries again.
      if (!settings && settingsCache.get(url)?.promise === promise) settingsCache.delete(url)
      return settings
    })
    .catch(() => {
      // Non-critical: the plugin's config applies.
      if (settingsCache.get(url)?.promise === promise) settingsCache.delete(url)
      return null
    })
  settingsCache.set(url, { at: Date.now(), promise })
  return promise
}

/** Forget the shared `/settings` response (after the settings are saved, and in tests). */
export function invalidateSeoConfig(): void {
  settingsCache.clear()
}

/**
 * The effective analyzer config in the admin: the plugin's config (forwarded, JSON-safe, in
 * `admin.custom.seoAnalyzer.config`) with the saved `/admin/seo-config` settings merged by
 * `mergeSavedSettings`, the merge `loadMergedConfig` applies on the server. Until the settings
 * arrive (or when the request fails) the plugin's config alone applies. Returns a stable
 * reference between renders so it is safe in a dependency array.
 *
 * The sidebar uses it only until `/sidebar-content` answers with the server's config.
 */
export function useSeoConfig(): SeoConfig {
  const seoApi = useSeoApi()
  const pluginConfig = (
    useConfig()?.config?.admin?.custom as { seoAnalyzer?: { config?: SeoConfig } } | undefined
  )?.seoAnalyzer?.config
  const [saved, setSaved] = useState<SavedSettings>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSavedSettings(seoApi('/settings')).then((settings) => {
      if (!cancelled && settings) setSaved(settings)
    })
    return () => {
      cancelled = true
    }
  }, [seoApi])

  // Keyed on the serialised inputs: the config object may be a new reference every render.
  const pluginKey = JSON.stringify(pluginConfig ?? null)
  const savedKey = JSON.stringify(saved)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeSavedSettings(pluginConfig, saved), [pluginKey, savedKey])
}

/**
 * Every limit resolved (override or default), for the length counters, previews and tips,
 * so they agree with the rules (which read the same resolution as `ctx.limits`).
 */
export function useResolvedThresholds(): ResolvedThresholds {
  const config = useSeoConfig()
  return useMemo(() => resolveThresholds(config.thresholds), [config])
}
