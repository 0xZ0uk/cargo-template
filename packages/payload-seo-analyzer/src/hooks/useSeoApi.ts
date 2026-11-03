'use client'

import { useMemo } from 'react'
import { useConfig } from '@payloadcms/ui'
import { DEFAULT_ADMIN_ROUTE, buildPayloadApiUrl, buildSeoApiUrl } from '../helpers/seoApiUrl.js'

/**
 * Builds the URL of a plugin endpoint from Payload's `routes.api` and the
 * plugin's `endpointBasePath` (forwarded in `admin.custom.seoAnalyzer`).
 *
 *   const seoApi = useSeoApi()
 *   fetch(seoApi('/audit?limit=500'), { credentials: 'include' })
 *
 * The returned function is stable until the config changes, so it is safe in
 * dependency arrays. `useConfig()` is undefined outside the admin provider tree
 * (and in tests that mock it away): the defaults then apply.
 */
export function useSeoApi(): (path: string) => string {
  const config = useConfig()?.config as
    | { routes?: { api?: string }; admin?: { custom?: { seoAnalyzer?: { endpointBasePath?: string } } } }
    | undefined
  const apiRoute = config?.routes?.api
  const endpointBasePath = config?.admin?.custom?.seoAnalyzer?.endpointBasePath
  return useMemo(
    () => (path: string) => buildSeoApiUrl({ apiRoute, endpointBasePath }, path),
    [apiRoute, endpointBasePath],
  )
}

/**
 * Same for Payload's own REST routes (`/api/pages/1` honours a custom `routes.api`).
 *
 *   const payloadApi = usePayloadApi()
 *   fetch(payloadApi(`/${collection}/${id}`), { method: 'PATCH', ... })
 */
export function usePayloadApi(): (path: string) => string {
  const apiRoute = (useConfig()?.config as { routes?: { api?: string } } | undefined)?.routes?.api
  return useMemo(() => (path: string) => buildPayloadApiUrl(apiRoute, path), [apiRoute])
}

/** Payload's `routes.admin`, for `formatAdminURL({ adminRoute, path })`. */
export function useAdminRoute(): string {
  const adminRoute = (useConfig()?.config as { routes?: { admin?: string } } | undefined)?.routes?.admin
  return adminRoute ?? DEFAULT_ADMIN_ROUTE
}
