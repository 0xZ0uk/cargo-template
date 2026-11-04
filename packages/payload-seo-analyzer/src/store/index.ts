import type { Payload } from 'payload'
import { createPayloadSeoDataStore } from './payloadStore.js'
import type { AlertWebhookFormat } from '../alertWebhook.js'
import type { NotFoundProbeFilterOption } from '../helpers/probePaths.js'
import type { SeoDataStore, SeoDataset } from './types.js'

export * from './types.js'
export { createPayloadSeoDataStore } from './payloadStore.js'
export { createSqlSeoDataStore, migrateSeoStore } from './sqlStore.js'
export type { SeoSqlDatabase, SeoSqlStatement } from './sqlStore.js'
export { SEO_STORE_MIGRATIONS } from './sqlSchema.js'

/** Gives the store for a Payload instance: the host's `dataStore`, else the collections. */
export type SeoDataStoreResolver = (payload: Payload) => SeoDataStore

export function seoDataStoreResolver(dataStore?: SeoDataStore): SeoDataStoreResolver {
  return dataStore ? () => dataStore : (payload) => createPayloadSeoDataStore(payload)
}

/** Default for handlers built without a resolver (tests, direct consumers): the collections. */
export const payloadStoreResolver: SeoDataStoreResolver = (payload) => createPayloadSeoDataStore(payload)

/**
 * What the plugin leaves in `config.custom.seoAnalyzer.store` (server-only config), so code
 * that only has a `payload` (deep audit helpers, the host's 404 recorder) finds the store.
 */
export interface SeoStoreRuntime {
  resolveStore: SeoDataStoreResolver
  /** Datasets whose feature is on. */
  enabled: readonly SeoDataset[]
  /** `retentionMaxRows` as configured (the 404 log's cap is read from it). */
  maxRows?: Partial<Record<SeoDataset, number>>
  /** `notFoundProbeFilter` as configured: which scanner-probe paths the 404 log drops. */
  notFoundProbeFilter?: NotFoundProbeFilterOption
  /** `alertWebhookFormat` as configured (the `SEO_ALERT_WEBHOOK_FORMAT` env var wins over it). */
  alertWebhookFormat?: AlertWebhookFormat
}

export function seoStoreRuntime(payload: Payload): SeoStoreRuntime | undefined {
  const custom = payload?.config?.custom as { seoAnalyzer?: { store?: SeoStoreRuntime } } | undefined
  return custom?.seoAnalyzer?.store
}

/** The store the plugin was configured with; the Payload collections when unknown. */
export function getSeoDataStore(payload: Payload): SeoDataStore {
  return seoStoreRuntime(payload)?.resolveStore(payload) ?? createPayloadSeoDataStore(payload)
}

/**
 * Whether a dataset's feature is on. Without plugin runtime info (a handler used on its
 * own), assume yes: the caller's read is best effort and tolerates a missing collection.
 */
export function seoDatasetEnabled(payload: Payload, dataset: SeoDataset): boolean {
  const runtime = seoStoreRuntime(payload)
  return runtime ? runtime.enabled.includes(dataset) : true
}
