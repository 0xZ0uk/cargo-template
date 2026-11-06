'use client'

import { useEffect, useMemo, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import type { SeoThresholds } from '../types.js'
import { mergeThresholds, resolveThresholds, type ResolvedThresholds } from '../helpers/thresholds.js'
import { useSeoApi } from './useSeoApi.js'

type SavedThresholds = Record<string, unknown> | null

/**
 * One `/settings` request shared by every consumer on the page (the sidebar, the field
 * counters, the previews), keyed by the endpoint URL. The entry expires after a short time
 * and `invalidateSeoThresholds()` drops it on save, so an edited range shows up without a
 * reload. A failed request is not kept: the next consumer retries.
 */
const SETTINGS_TTL_MS = 30_000
const settingsCache = new Map<string, { at: number; promise: Promise<SavedThresholds> }>()

function fetchSavedThresholds(url: string): Promise<SavedThresholds> {
  const hit = settingsCache.get(url)
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.promise
  const promise = fetch(url, { credentials: 'include', cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { settings?: { thresholds?: Record<string, unknown> } } | null) => {
      const thresholds = data?.settings?.thresholds ?? null
      // Nothing usable (error, empty): do not pin it, the next consumer tries again.
      if (!thresholds && settingsCache.get(url)?.promise === promise) settingsCache.delete(url)
      return thresholds
    })
    .catch(() => {
      // Non-critical: the plugin option (or the defaults) apply.
      if (settingsCache.get(url)?.promise === promise) settingsCache.delete(url)
      return null
    })
  settingsCache.set(url, { at: Date.now(), promise })
  return promise
}

/** Forget the shared `/settings` response (after the settings are saved, and in tests). */
export function invalidateSeoThresholds(): void {
  settingsCache.clear()
}

/**
 * The thresholds the sidebar scores with: the plugin `thresholds` option (forwarded in
 * `admin.custom.seoAnalyzer`) with the saved `/admin/seo-config` values on top, the same
 * precedence as `loadMergedConfig` on the server. Until the settings arrive (or when the
 * request fails) the plugin option alone applies. Returns a stable reference between
 * renders so it is safe in a dependency array.
 */
export function useSeoThresholds(): SeoThresholds | undefined {
  const seoApi = useSeoApi()
  const pluginThresholds = (
    useConfig()?.config?.admin?.custom as { seoAnalyzer?: { thresholds?: SeoThresholds } } | undefined
  )?.seoAnalyzer?.thresholds
  const [saved, setSaved] = useState<SavedThresholds>(null)

  useEffect(() => {
    let cancelled = false
    void fetchSavedThresholds(seoApi('/settings')).then((thresholds) => {
      if (!cancelled && thresholds) setSaved(thresholds)
    })
    return () => {
      cancelled = true
    }
  }, [seoApi])

  // Keyed on the serialised inputs: the config object may be a new reference every render.
  const pluginKey = JSON.stringify(pluginThresholds ?? null)
  const savedKey = JSON.stringify(saved)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => mergeThresholds(pluginThresholds, saved), [pluginKey, savedKey])
}

/**
 * Every limit resolved (override or default), for the length counters and their tones, so
 * they agree with the rules. Same sources as `useSeoThresholds`.
 */
export function useResolvedThresholds(): ResolvedThresholds {
  const thresholds = useSeoThresholds()
  return useMemo(() => resolveThresholds(thresholds), [thresholds])
}
