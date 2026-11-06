export { abTestingPlugin } from "./plugin";
export type {
  AbBucketResult,
  AbConversionEvent,
  AbMeasurementConfig,
  AbMeasurementCookieConfig,
  AbResults,
  AbTestingPluginConfig,
  CollectionABConfig,
  StorageAdapter,
} from "./types/config";
export type { AbPastRun, AbResultsResponse } from "./endpoints/measurement";
export { DEFAULT_CONVERSION_COOKIE_PREFIX } from "./endpoints/measurement";
export type { AbPromoteFailure, AbPromoteResponse } from "./endpoints/promoteVariant";
export { DEFAULT_PROMOTE_SKIP_FIELDS } from "./utils/buildPromoteData";
export type { ManifestCache, ManifestCacheOptions, ManifestCacheValue } from "./cache/types";
export type { AbCookieConfig } from "./cookie/types";
export { resolveAbCookieNames } from "./cookie/utils/resolveAbCookieNames";
export type { ResolvedAbCookieNames } from "./cookie/utils/resolveAbCookieNames";
export { AB_EXPERIMENTS_SLUG, AB_DIMENSION_PARAMS, AB_RUN_RETENTION_DAYS } from "./constants";
export { pruneEndedExperimentRuns } from "./utils/experimentRuns";
