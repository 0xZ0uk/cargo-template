'use client'

import { useConfig } from '@payloadcms/ui'
import type { SeoFeatures } from '../types.js'
import { getDashboardT, type DashboardTranslations } from '../dashboard-i18n.js'

/** What the plugin forwards to the browser in `admin.custom` (see plugin.ts). */
interface SeoAdminCustom {
  seoAnalyzer?: {
    features?: Partial<Record<keyof SeoFeatures, boolean>>
  }
}

// No default context: `useConfig()` is undefined outside the admin provider
// tree, and the error boundary that reads it must never throw.
function useSeoAdminCustom(): SeoAdminCustom['seoAnalyzer'] {
  return (useConfig()?.config?.admin?.custom as SeoAdminCustom | undefined)?.seoAnalyzer
}

/**
 * Whether a plugin feature is on, from the flags forwarded in `admin.custom`.
 * `undefined` when the flags are unavailable (component mounted outside the
 * plugin's config): callers then fall back to probing the endpoint.
 */
export function useSeoFeature(name: keyof SeoFeatures): boolean | undefined {
  return useSeoAdminCustom()?.features?.[name]
}

/** The dashboard's strings (English). */
export function useDashboardT(): DashboardTranslations {
  return getDashboardT()
}
