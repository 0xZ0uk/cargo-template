/**
 * SEO Rules — JSON-LD / Schema.org checks.
 *
 * SEO 2026 rewrite: the old check was "theatre" — it passed green whenever a page
 * had title + description + image, WITHOUT ever looking at schema requirements.
 * This version is page-type aware: it determines the schema type expected for the
 * page, then reports which REQUIRED fields are derivable from CMS data and which
 * still need manual confirmation. It also flags FAQPage as "no rich result" (2026)
 * without ever suggesting to remove valid markup.
 *
 * Honesty: structured data is often injected at render time (not stored in CMS),
 * so this is GUIDANCE (low weight), never a hard ranking penalty.
 */
import type { SeoCheck, SeoInput, AnalysisContext } from '../types.js'
import { getTranslations } from '../i18n.js'
import {
  SCHEMA_REQUIREMENTS,
  CMS_VERIFIABLE_SCHEMA_FIELDS,
  evaluateRequiredProperties,
  type SchemaTypeKey,
} from './schema-requirements.js'
import { blockContentOf } from '../helpers/blockContent.js'


/**
 * Local strings for the additive `schema-required-fields` completeness check.
 * Kept LOCAL (like rules/eeat.ts) to avoid bloating the central i18n file and to
 * keep this agent's edits confined to schema rule files.
 */
const SCHEMA_REQUIRED_STRINGS = {
  label: 'Google-required properties (completeness)',
  missing: (type: string, fields: string) =>
    `${type} schema: Google-required propert(ies) missing — ${fields}. Provide them for rich-result eligibility.`,
  remind: (type: string, fields: string) =>
    `${type} schema: derivable required fields are present. Confirm the CMS-unverifiable properties — ${fields}.`,
  complete: (type: string) =>
    `${type} schema: all Google-required properties are derivable from CMS data.`,
  tip: 'Fill the required properties (e.g. author, datePublished, image) — they gate rich-result eligibility and strongly help AI answer engines.',
} as const

/**
 * Determine the PRIMARY schema type expected for this page.
 * Returns null for page types where structured data is genuinely optional
 * (legal / contact / form) — avoids nagging editors with irrelevant schema.
 */
function detectExpectedSchemaType(input: SeoInput, ctx: AnalysisContext): SchemaTypeKey | null {
  if (input.isProduct) return 'Product'
  if (input.isPost || ctx.pageType === 'blog') return 'Article'
  if (ctx.pageType === 'local-seo') return 'LocalBusiness'
  if (ctx.pageType === 'agency') return 'Organization'
  if (ctx.pageType === 'legal' || ctx.pageType === 'contact' || ctx.pageType === 'form') return null
  // home / service / resource / generic → WebPage, matching what `buildJsonLd` generates
  return 'WebPage'
}

export function checkSchema(input: SeoInput, ctx: AnalysisContext): SeoCheck[] {
  const checks: SeoCheck[] = []
  const r = getTranslations().rules.schema

  // FAQPage markup is generatable: an FAQ block type, or Q/A items in any block.
  const faqPresent = blockContentOf(input, ctx).hasFaq

  // Which required schema fields are derivable from CMS data available to the analyzer.
  const present: Record<string, boolean> = {
    headline: !!(input.metaTitle || input.heroTitle) || ctx.allHeadings.some((h) => h.tag === 'h1'),
    name: !!(input.metaTitle || input.heroTitle),
    image: ctx.imageStats.total > 0 || !!input.metaImage,
    url: true,
    itemListElement: !!input.slug,
    mainEntity: faqPresent,
  }

  const expected = detectExpectedSchemaType(input, ctx)

  if (expected === null) {
    // Structured data optional for this page type — informational, non-scoring.
    checks.push({
      id: 'schema-coverage',
      label: r.coverageLabel,
      status: 'pass',
      message: r.coverageOptional,
      category: 'bonus',
      weight: 0,
      group: 'schema',
    })
  } else {
    const reqDef = SCHEMA_REQUIREMENTS[expected]

    // Required fields we KNOW are missing (verifiable from CMS + absent).
    const knownMissing = reqDef.required.filter(
      (f) => CMS_VERIFIABLE_SCHEMA_FIELDS.has(f) && !present[f],
    )
    // Required fields we cannot verify from CMS data (author, offers, address...).
    const unverifiable = reqDef.required.filter((f) => !CMS_VERIFIABLE_SCHEMA_FIELDS.has(f))

    if (knownMissing.length > 0) {
      // A page that should carry <type> schema is missing required, CMS-visible fields.
      // → never a false "green", but a low-weight warning (schema may be render-injected).
      checks.push({
        id: 'schema-coverage',
        label: r.coverageLabel,
        status: 'warning',
        message: r.coverageMissing(expected, knownMissing.join(', ')),
        category: 'bonus',
        weight: 1,
        group: 'schema',
        tip: r.coverageMissingTip,
      })
    } else if (unverifiable.length > 0) {
      // CMS-visible required fields are present; remind editor to confirm the rest.
      checks.push({
        id: 'schema-coverage',
        label: r.coverageLabel,
        status: 'pass',
        message: r.coverageRemind(expected, unverifiable.join(', ')),
        category: 'bonus',
        weight: 0,
        group: 'schema',
      })
    } else {
      checks.push({
        id: 'schema-coverage',
        label: r.coverageLabel,
        status: 'pass',
        message: r.coveragePass(expected),
        category: 'bonus',
        weight: 1,
        group: 'schema',
      })
    }
  }

  // Completeness check (SEO 2026): flag the Google-REQUIRED properties that are missing
  // for the detected type. Additive to `schema-coverage` and weight 0 (informational) —
  // schema is often render-injected, so this is honest guidance, never a ranking penalty.
  if (expected !== null) {
    // Richer presence map: add E-E-A-T / entity-grade fields derivable from SeoInput.
    const presentExt: Record<string, boolean> = {
      ...present,
      author: !!(input.author && input.author.trim()),
      datePublished: !!input.publishedAt,
    }
    const { missing, unverifiable } = evaluateRequiredProperties(expected, presentExt)

    if (missing.length > 0) {
      checks.push({
        id: 'schema-required-fields',
        label: SCHEMA_REQUIRED_STRINGS.label,
        status: 'warning',
        message: SCHEMA_REQUIRED_STRINGS.missing(expected, missing.join(', ')),
        category: 'bonus',
        weight: 0,
        group: 'schema',
        tip: SCHEMA_REQUIRED_STRINGS.tip,
      })
    } else {
      checks.push({
        id: 'schema-required-fields',
        label: SCHEMA_REQUIRED_STRINGS.label,
        status: 'pass',
        message:
          unverifiable.length > 0
            ? SCHEMA_REQUIRED_STRINGS.remind(expected, unverifiable.join(', '))
            : SCHEMA_REQUIRED_STRINGS.complete(expected),
        category: 'bonus',
        weight: 0,
        group: 'schema',
      })
    }
  }

  // FAQ / HowTo: valid markup, but no SERP rich result since 2026 — never recommend removal.
  if (faqPresent && !SCHEMA_REQUIREMENTS.FAQPage.richResult) {
    checks.push({
      id: 'schema-faq-no-rich-result',
      label: r.faqNoRichResultLabel,
      status: 'pass',
      message: r.faqNoRichResult,
      category: 'bonus',
      weight: 0,
      group: 'schema',
    })
  }

  return checks
}
