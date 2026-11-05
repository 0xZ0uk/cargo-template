/**
 * SEO Rules — Internal/external linking checks (weight: 2, category: important)
 */
import type { SeoCheck, SeoInput, AnalysisContext } from '../types.js'
import { getGenericAnchors } from '../constants.js'
import { getTranslations } from '../i18n.js'
import { analyzeKeyphrase, getContentWords } from '../helpers.js'
import { buildDocPath, DEFAULT_COLLECTION_ROUTES } from '../helpers/docUrl.js'

/** Lowercase path of a link without query, fragment or surrounding slashes. */
function linkPath(url: string): string {
  return url
    .trim()
    .replace(/[?#].*$/s, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

/**
 * Paths under which this page can be reached: its canonical URL, and its slug
 * under every configured collection route (the collection is not part of the input).
 */
function selfPaths(input: SeoInput, ctx: AnalysisContext): Set<string> {
  const paths = new Set<string>()
  if (input.canonicalUrl) {
    try {
      paths.add(linkPath(new URL(input.canonicalUrl, 'http://self.invalid').pathname))
    } catch {
      /* unparsable canonical: ignore */
    }
  }
  if (input.slug !== undefined) {
    const routes = ctx.config.collectionRoutes
    for (const collection of ['', ...Object.keys({ ...DEFAULT_COLLECTION_ROUTES, ...routes })]) {
      paths.add(linkPath(buildDocPath(input.slug, collection || undefined, routes)))
    }
  }
  return paths
}

export function checkLinking(input: SeoInput, ctx: AnalysisContext): SeoCheck[] {
  const checks: SeoCheck[] = []
  const r = getTranslations().rules.linking
  const { allLinks } = ctx

  // Separate internal from external links
  const internalLinks = allLinks.filter(
    (link) =>
      link.url.startsWith('/') || link.url.startsWith('#') || !link.url.startsWith('http'),
  )
  const externalLinks = allLinks.filter((link) => link.url.startsWith('http'))

  // 30. At least 1 internal link (>=3 = excellent)
  if (internalLinks.length === 0) {
    checks.push({
      id: 'linking-internal',
      label: r.internalLabel,
      status: 'warning',
      message: r.internalNone,
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  } else if (internalLinks.length < 3) {
    checks.push({
      id: 'linking-internal',
      label: r.internalLabel,
      status: 'pass',
      message: r.internalFew(internalLinks.length),
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  } else {
    checks.push({
      id: 'linking-internal',
      label: r.internalLabel,
      status: 'pass',
      message: r.internalGood(internalLinks.length),
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  }

  // 31. At least 1 external link (skip for contact/legal/form pages)
  const skipExternalCheck = ctx.pageType === 'contact' || ctx.pageType === 'legal' || ctx.pageType === 'form'
  if (skipExternalCheck) {
    checks.push({
      id: 'linking-external',
      label: r.externalLabel,
      status: 'pass',
      message: r.externalUtilityPass,
      category: 'bonus',
      weight: 1,
      group: 'linking',
    })
  } else if (externalLinks.length === 0) {
    checks.push({
      id: 'linking-external',
      label: r.externalLabel,
      status: 'warning',
      message: r.externalNone,
      category: 'bonus',
      weight: 1,
      group: 'linking',
    })
  } else {
    checks.push({
      id: 'linking-external',
      label: r.externalLabel,
      status: 'pass',
      message: r.externalPass(externalLinks.length),
      category: 'bonus',
      weight: 1,
      group: 'linking',
    })
  }

  // 32. No generic anchor texts
  const allGenericAnchors = getGenericAnchors()
  const genericAnchors = allLinks.filter((link) => {
    const text = link.text.toLowerCase().trim()
    return allGenericAnchors.includes(text)
  })

  if (genericAnchors.length > 0) {
    checks.push({
      id: 'linking-generic-anchors',
      label: r.genericAnchorsLabel,
      status: 'warning',
      message: r.genericAnchorsFail(genericAnchors.length),
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  } else if (allLinks.length > 0) {
    checks.push({
      id: 'linking-generic-anchors',
      label: r.genericAnchorsPassLabel,
      status: 'pass',
      message: r.genericAnchorsPass,
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  }

  // 33. No empty links (href="" or href="#")
  const emptyLinks = allLinks.filter((link) => {
    const url = link.url.trim()
    return url === '' || url === '#'
  })

  if (emptyLinks.length > 0) {
    checks.push({
      id: 'linking-empty',
      label: r.emptyLinksLabel,
      status: 'warning',
      message: r.emptyLinksFail(emptyLinks.length),
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  } else if (allLinks.length > 0) {
    checks.push({
      id: 'linking-empty',
      label: r.emptyLinksPassLabel,
      status: 'pass',
      message: r.emptyLinksPass,
      category: 'important',
      weight: 2,
      group: 'linking',
    })
  }

  // 34. Competing anchors: an internal link to ANOTHER page whose anchor text is
  // just the focus keyphrase (same content words, nothing else) makes that page
  // compete with this one for the phrase. Focus keyphrase only.
  if (ctx.normalizedKeyword) {
    const keyphraseWords = new Set(analyzeKeyphrase(ctx.normalizedKeyword).contentWords)
    if (keyphraseWords.size > 0) {
      const self = selfPaths(input, ctx)
      const competing = internalLinks.filter((link) => {
        const url = link.url.trim()
        if (url.startsWith('#') || self.has(linkPath(url))) return false
        const anchorWords = new Set(getContentWords(link.text))
        return (
          anchorWords.size === keyphraseWords.size &&
          [...keyphraseWords].every((w) => anchorWords.has(w))
        )
      })
      const keyphrase = (input.focusKeyword || ctx.normalizedKeyword).trim()

      if (competing.length > 0) {
        const urls = [...new Set(competing.map((link) => link.url.trim()))]
        const shown = urls.slice(0, 3).join(', ') + (urls.length > 3 ? `, +${urls.length - 3} more` : '')
        checks.push({
          id: 'linking-competing-anchors',
          label: r.competingLabel,
          status: 'fail',
          message: r.competingFail(keyphrase, shown),
          category: 'important',
          weight: 2,
          group: 'linking',
          tip: r.competingTip,
        })
      } else if (allLinks.length > 0) {
        checks.push({
          id: 'linking-competing-anchors',
          label: r.competingLabel,
          status: 'pass',
          message: r.competingPass(keyphrase),
          category: 'important',
          weight: 2,
          group: 'linking',
        })
      }
    }
  }

  return checks
}
