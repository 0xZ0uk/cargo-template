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

export const AB_EXPERIMENTS_SLUG = "ab-experiments";

export const PLUGIN_NAME = "payload-plugin-ab";

export const AB_DIMENSION_PARAMS = {
  experiment: "fr_ab_experiment",
  variant: "fr_ab_variant",
  visitorId: "fr_ab_visitor_id",
} as const;
