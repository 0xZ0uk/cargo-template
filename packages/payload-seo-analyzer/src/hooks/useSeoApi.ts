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

export interface SeoCollectionOption {
  slug: string
  /** Plural label when the client config carries a plain string, else the slug. */
  label: string
  /** Names of the title/slug fields the collection really has, for the document search. */
  searchFields: string[]
}

type ClientCollection = {
  slug: string
  labels?: { plural?: unknown }
  fields?: Array<{ name?: string }>
}

/**
 * The collections the plugin analyzes, for pickers. They come from
 * `admin.custom.seoAnalyzer.collections` (what the endpoints accept); without it the
 * admin's own collection list is offered and an endpoint refusal is shown as an error.
 */
export function useSeoCollections(): SeoCollectionOption[] {
  const config = useConfig()?.config as
    | { collections?: ClientCollection[]; admin?: { custom?: { seoAnalyzer?: { collections?: string[] } } } }
    | undefined
  const analyzed = config?.admin?.custom?.seoAnalyzer?.collections
  const all = config?.collections
  return useMemo(() => {
    const bySlug = new Map((all ?? []).map((c) => [c.slug, c]))
    const slugs = analyzed ?? (all ?? []).map((c) => c.slug)
    return slugs.map((slug) => {
      const def = bySlug.get(slug)
      const names = def?.fields?.map((f) => f.name)
      const searchFields = names ? ['title', 'slug'].filter((n) => names.includes(n)) : ['title', 'slug']
      const plural = def?.labels?.plural
      return { slug, label: typeof plural === 'string' ? plural : slug, searchFields }
    })
  }, [analyzed, all])
}
