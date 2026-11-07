import type { Payload } from 'payload'

import type { NormalizedPluginOptions, PublishedRef } from '../../../types/index.js'

import { ValidationError } from '../../utilities/errors.js'
import { metaJson } from '../_meta/api.js'
import { fetchMetaInsightsWithFallback } from '../_meta/insights.js'
import { getPageAccessToken } from './pages.js'

export const FACEBOOK_POST_INSIGHT_METRICS = [
  'post_media_view',
  'post_total_media_view_unique',
  'post_clicks',
  'post_reactions_by_type_total',
] as const

type FacebookInsight = {
  description?: string
  id?: string
  name: string
  period?: string
  title?: string
  total_value?: { value?: unknown }
  values?: Array<{ end_time?: string; value?: unknown }>
}

type FacebookInsightsResponse = {
  data?: FacebookInsight[]
  paging?: Record<string, unknown>
}

/**
 * The Page a post belongs to: the publish record's `meta.pageId`, else the
 * row's `destinationId` (the Page id, added by `refFromPost`), else the Page
 * part of a `{pageId}_{postId}` externalId.
 */
export const resolveFacebookPageId = (publishedRef: PublishedRef): string => {
  for (const key of ['pageId', 'destinationId']) {
    const value = publishedRef.meta?.[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  const separator = publishedRef.externalId.indexOf('_')
  if (separator > 0) {
    return publishedRef.externalId.slice(0, separator)
  }
  throw new ValidationError(`Cannot resolve Facebook Page id for post "${publishedRef.externalId}"`)
}

const summarize = (data: FacebookInsight[]): Record<string, unknown> =>
  Object.fromEntries(
    data.map((metric) => {
      const values = metric.values ?? []
      const value = metric.total_value?.value ?? values.at(-1)?.value
      return [metric.name, value ?? null]
    }),
  )

export type FacebookPostInsightsSnapshot = {
  fetchedAt: string
  metrics: Record<string, unknown>
  pageId: string
  postId: string
  raw: FacebookInsightsResponse
  unavailableMetrics: string[]
}

export const getFacebookInsightsForRef = async (args: {
  metrics?: readonly string[]
  options: NormalizedPluginOptions
  payload: Payload
  publishedRef: PublishedRef
}): Promise<FacebookPostInsightsSnapshot> => {
  const pageId = resolveFacebookPageId(args.publishedRef)
  const pageAccessToken = await getPageAccessToken(args.payload, args.options, pageId)
  const { raw, unavailableMetrics } = await fetchMetaInsightsWithFallback<FacebookInsight>({
    fetch: (metrics) => {
      const params = new URLSearchParams({
        metric: metrics.join(','),
        period: 'lifetime',
      })
      return metaJson<FacebookInsightsResponse>(
        args.payload,
        args.options,
        'facebook',
        `/${encodeURIComponent(args.publishedRef.externalId)}/insights?${params.toString()}`,
        undefined,
        { accessToken: pageAccessToken },
      )
    },
    metrics: args.metrics ?? FACEBOOK_POST_INSIGHT_METRICS,
  })

  return {
    fetchedAt: new Date().toISOString(),
    metrics: summarize(raw.data ?? []),
    pageId,
    postId: args.publishedRef.externalId,
    raw,
    unavailableMetrics,
  }
}
