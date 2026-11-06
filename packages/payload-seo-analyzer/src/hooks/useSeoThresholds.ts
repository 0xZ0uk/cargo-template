'use client'

import { useEffect, useMemo, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import type { SeoThresholds } from '../types.js'
import { mergeThresholds } from '../helpers/thresholds.js'
import { useSeoApi } from './useSeoApi.js'

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
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(seoApi('/settings'), { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { settings?: { thresholds?: Record<string, unknown> } } | null) => {
        if (!cancelled && data?.settings?.thresholds) setSaved(data.settings.thresholds)
      })
      .catch(() => {
        // Non-critical: the plugin option (or the defaults) apply.
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
