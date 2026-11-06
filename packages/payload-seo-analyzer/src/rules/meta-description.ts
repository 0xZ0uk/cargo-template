/**
 * SEO Rules — Meta description checks (weight: 3, category: critical)
 */
import type { SeoCheck, SeoInput, AnalysisContext } from '../types.js'
import { normalizeForComparison, keywordMatchesText } from '../helpers.js'
import { getActionVerbs } from '../constants.js'
import { getTranslations } from '../i18n.js'
import { resolveThresholds } from '../helpers/thresholds.js'

export function checkMetaDescription(input: SeoInput, ctx: AnalysisContext): SeoCheck[] {
  const checks: SeoCheck[] = []
  const r = getTranslations().rules.metaDescription
  const desc = input.metaDescription || ''
  const descLen = desc.length
  const kw = ctx.normalizedKeyword
  const { metaDescLengthMin, metaDescLengthMax } = resolveThresholds(ctx.config.thresholds)

  // 6. Meta description present
  if (!desc) {
    checks.push({
      id: 'meta-desc-missing',
      label: r.missingLabel,
      status: 'fail',
      message: r.missingMessage,
      category: 'critical',
      weight: 3,
      group: 'meta-description',
      tip: r.missingTip(metaDescLengthMin, metaDescLengthMax),
    })
    return checks
  }

  // 7. Length metaDescLengthMin-metaDescLengthMax characters
  if (descLen < metaDescLengthMin) {
    checks.push({
      id: 'meta-desc-length',
      label: r.lengthLabel,
      status: 'warning',
      message: r.lengthShort(descLen, metaDescLengthMin, metaDescLengthMax),
      category: 'critical',
      weight: 3,
      group: 'meta-description',
      tip: r.lengthShortTip(metaDescLengthMin),
    })
  } else if (descLen > metaDescLengthMax) {
    checks.push({
      id: 'meta-desc-length',
      label: r.lengthLabel,
      status: 'warning',
      message: r.lengthLong(descLen, metaDescLengthMax),
      category: 'critical',
      weight: 3,
      group: 'meta-description',
      tip: r.lengthLongTip(metaDescLengthMax),
    })
  } else {
    checks.push({
      id: 'meta-desc-length',
      label: r.lengthLabel,
      status: 'pass',
      message: r.lengthPass(descLen),
      category: 'critical',
      weight: 3,
      group: 'meta-description',
    })
  }

  // 8. Focus keyword present in description (smart matching)
  if (kw) {
    const descNorm = normalizeForComparison(desc)
    const descContainsKw = keywordMatchesText(kw, descNorm)
    checks.push({
      id: 'meta-desc-keyword',
      label: r.keywordLabel,
      status: descContainsKw ? 'pass' : 'warning',
      message: descContainsKw
        ? r.keywordPass(input.focusKeyword || kw)
        : r.keywordFail(input.focusKeyword || kw),
      category: 'critical',
      weight: 3,
      group: 'meta-description',
    })
  }

  // 9. Contains an action verb or alternative CTA pattern
  const actionVerbs = getActionVerbs()
  const descLower = desc.toLowerCase()
  const hasActionVerb = actionVerbs.some((verb) => descLower.includes(verb))
  const hasNumericCta =
    /\b\d+\s+(?:reasons?|steps?|tips?|tricks?|mistakes?|benefits?|keys?|points?|ways?|methods?|techniques?|tools?|secrets?)\b/i.test(desc)
  const hasInterrogativeCta = /\b(?:how|why|when|what|which|where|who)\b/i.test(desc)
  const hasAction = hasActionVerb || hasNumericCta || hasInterrogativeCta

  checks.push({
    id: 'meta-desc-cta',
    label: r.ctaLabel,
    status: hasAction ? 'pass' : 'warning',
    message: hasAction ? r.ctaPass : r.ctaFail,
    category: 'important',
    weight: 2,
    group: 'meta-description',
    ...(!hasAction && { tip: r.ctaTip }),
  })

  return checks
}
