export const AB_VARIANT_OF_FIELD = "_abVariantOf";
export const AB_PASS_PERCENTAGE_FIELD = "_abPassPercentage";
export const AB_PENDING_PERCENTAGES_FIELD = "_abPendingPercentages";
export const DEFAULT_SLUG_FIELD = "slug";

export const AB_MAX_VARIANT_TOTAL = 99;

export const AB_PENDING_CONTEXT_KEY = "abPendingPercentages";
export const AB_CASCADE_CONTEXT_KEY = "abCascade";
/**
 * `req.context` marker set by the plugin's own writes (the duplicate endpoint) so the
 * field-level access on `_abVariantOf` / `_abPassPercentage` lets them through. REST, GraphQL
 * and MCP writes run without it and can't set either field.
 */
export const AB_WRITE_CONTEXT_KEY = "abPluginWrite";
/**
 * `req.context` marker set while the duplicate endpoint creates a draft variant: the copy
 * takes no traffic, so the manifest needs no recompute. Without it, the moment between the
 * copy (still published in the other locales) and its unpublish would start and end a run.
 */
export const AB_SKIP_RECOMPUTE_CONTEXT_KEY = "abSkipRecompute";

export const AB_EXPERIMENTS_SLUG = "ab-experiments";
/**
 * Days an ended run's `ab-experiments` row is kept (and listed in the Variants panel): the
 * Analytics Engine retention, after which its events, and so its results, are gone.
 */
export const AB_RUN_RETENTION_DAYS = 90;
/** Past runs listed per page and locale in the Variants panel, most recent first. */
export const AB_MAX_PAST_RUNS = 10;

export const PLUGIN_NAME = "payload-plugin-ab";

export const AB_DIMENSION_PARAMS = {
  experiment: "fr_ab_experiment",
  variant: "fr_ab_variant",
  visitorId: "fr_ab_visitor_id",
} as const;
