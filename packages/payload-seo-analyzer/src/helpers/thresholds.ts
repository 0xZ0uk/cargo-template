/**
 * Resolves the analyzer's overridable thresholds: a custom value (plugin `thresholds`
 * option, or the `/admin/seo-config` settings merged over it) wins, the constant from
 * `constants.ts` is the default. Rules read their limits here only, so they cannot drift
 * from the settings. Client-safe: no Payload imports (the sidebar bundles it too).
 */
import type { SeoThresholds } from '../types.js'
import {
  TITLE_LENGTH_MIN,
  TITLE_LENGTH_MAX,
  META_DESC_LENGTH_MIN,
  META_DESC_LENGTH_MAX,
  MIN_WORDS_GENERIC,
  MIN_WORDS_POST,
  KEYWORD_DENSITY_MIN,
  KEYWORD_DENSITY_MAX,
  KEYWORD_DENSITY_WARN,
  FLESCH_SCORE_PASS,
  FLESCH_SCORE_WARN,
  SLUG_MAX_LENGTH,
} from '../constants.js'

export interface ResolvedThresholds extends Required<SeoThresholds> {
  /** Keyword density (%) above which the check warns; derived from the max. */
  keywordDensityWarn: number
  /** Flesch score below which the check fails (between this and the pass score it warns). */
  fleschScoreWarn: number
}

/** A usable override: a finite number (the settings form can store null / NaN). */
function pick(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Each threshold from `overrides`, falling back to its constant.
 *
 * The two intermediate boundaries (keyword density "warn", Flesch "warn") have no setting
 * of their own: they keep the default's proportion to the setting they belong to, so the
 * band between warn and fail moves with it. Without an override they are the constants.
 *
 * `keywordDensityMin` is returned for completeness but no rule reads it: a density floor
 * is deprecated (it pushes toward keyword stuffing), see `KEYWORD_DENSITY_MIN`.
 */
export function resolveThresholds(overrides?: SeoThresholds | null): ResolvedThresholds {
  const o = overrides ?? {}
  const keywordDensityMax = pick(o.keywordDensityMax, KEYWORD_DENSITY_MAX)
  const fleschScorePass = pick(o.fleschScorePass, FLESCH_SCORE_PASS)
  return {
    titleLengthMin: pick(o.titleLengthMin, TITLE_LENGTH_MIN),
    titleLengthMax: pick(o.titleLengthMax, TITLE_LENGTH_MAX),
    metaDescLengthMin: pick(o.metaDescLengthMin, META_DESC_LENGTH_MIN),
    metaDescLengthMax: pick(o.metaDescLengthMax, META_DESC_LENGTH_MAX),
    minWordsGeneric: pick(o.minWordsGeneric, MIN_WORDS_GENERIC),
    minWordsPost: pick(o.minWordsPost, MIN_WORDS_POST),
    keywordDensityMin: pick(o.keywordDensityMin, KEYWORD_DENSITY_MIN),
    keywordDensityMax,
    keywordDensityWarn:
      keywordDensityMax === KEYWORD_DENSITY_MAX
        ? KEYWORD_DENSITY_WARN
        : (keywordDensityMax * KEYWORD_DENSITY_WARN) / KEYWORD_DENSITY_MAX,
    fleschScorePass,
    fleschScoreWarn:
      fleschScorePass === FLESCH_SCORE_PASS
        ? FLESCH_SCORE_WARN
        : (fleschScorePass * FLESCH_SCORE_WARN) / FLESCH_SCORE_PASS,
    slugMaxLength: pick(o.slugMaxLength, SLUG_MAX_LENGTH),
  }
}

/**
 * Layers saved settings over the plugin option: numbers only (the settings form saves
 * null for an empty field), a saved value wins. Returns `undefined` when neither has any.
 */
export function mergeThresholds(
  base: SeoThresholds | undefined,
  saved: Record<string, unknown> | null | undefined,
): SeoThresholds | undefined {
  const fromSettings: Record<string, number> = {}
  if (saved && typeof saved === 'object') {
    for (const [key, val] of Object.entries(saved)) {
      if (typeof val === 'number' && Number.isFinite(val)) fromSettings[key] = val
    }
  }
  if (Object.keys(fromSettings).length === 0) return base
  return { ...(base ?? {}), ...fromSettings }
}
