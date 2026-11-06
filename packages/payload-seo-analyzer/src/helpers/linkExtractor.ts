/**
 * Shared link extraction utilities.
 * Used by index.ts (buildContext), sitemap-audit.ts, and linkGraph.ts
 * to extract internal links from Payload documents.
 *
 * Single source of truth — no more duplicate functions.
 */

import { extractLinksFromLexical } from '../helpers.js'
import { type ContentExtractorSource, extractDocBlocks } from './contentExtractor.js'
import { extractPayloadLink } from './payloadLink.js'

export { extractPayloadLink }

// ---------------------------------------------------------------------------
// Normalize a link URL to a comparable slug
// Strips accents (NFD) so slugs like "café" match "cafe".
// ---------------------------------------------------------------------------

export function normalizeToSlug(url: string): string | null {
  // Skip anchors, empty links, and external URLs
  if (
    !url ||
    url === '#' ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('mailto:') ||
    url.startsWith('tel:')
  ) {
    return null
  }

  // Remove anchor fragments
  let cleaned = url.split('#')[0]

  // Remove query strings
  cleaned = cleaned.split('?')[0]

  // Remove leading slashes
  cleaned = cleaned.replace(/^\/+/, '')

  // Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, '')

  // Empty string after cleaning = homepage
  if (!cleaned) return 'home'

  // Strip accents (e→e, a→a, etc.) to match Payload slugs
  return cleaned.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// ---------------------------------------------------------------------------
// Resolve a normalized link slug to its canonical document slug.
//
// Documents are keyed by their bare slug (e.g. a post slug `my-post`), but their
// PUBLIC URL is often prefixed by a collection route — e.g. posts are served at
// `/posts/my-post`, which normalizes to `posts/my-post`. Without resolution, every
// such link is wrongly flagged "broken" and its target wrongly flagged "orphan".
//
// Given the set of real doc slugs and the known route prefixes (target collection
// slugs + configured knownRoutes), strip a leading route segment when the remainder
// is a real slug. A genuinely missing target is returned unchanged (still broken).
// ---------------------------------------------------------------------------

export function resolveToDocSlug(
  slug: string,
  allSlugs: Set<string>,
  routePrefixes: Set<string>,
): string {
  if (allSlugs.has(slug)) return slug
  const idx = slug.indexOf('/')
  if (idx > 0) {
    const head = slug.slice(0, idx)
    const rest = slug.slice(idx + 1)
    if (routePrefixes.has(head) && allSlugs.has(rest)) return rest
  }
  return slug
}

// ---------------------------------------------------------------------------
// Extract all internal links from a Payload document
// Handles hero, layout blocks (the block walker, or the collection's `extractContent`) and post
// content (Lexical richText).
// ---------------------------------------------------------------------------

export function extractAllInternalLinks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  options: { collection?: string; extractors?: ContentExtractorSource } = {},
): Array<{ url: string; slug: string; text: string }> {
  const allLinks: Array<{ url: string; text: string }> = []

  // 1. Hero richText
  if (doc.hero?.richText) {
    allLinks.push(...extractLinksFromLexical(doc.hero.richText))
  }

  // 2. Hero CTA links (linkGroup)
  if (doc.hero?.links && Array.isArray(doc.hero.links)) {
    for (const item of doc.hero.links) {
      if (item && typeof item === 'object') {
        const linkItem = item as Record<string, unknown>
        const linkData = extractPayloadLink(linkItem.link)
        if (linkData) allLinks.push(linkData)
      }
    }
  }

  // 3. Layout blocks: the shared walker reads every block by shape (link / links fields,
  //    nested Columns content, rich text, plain-URL links), so no block type is special-cased.
  allLinks.push(...extractDocBlocks(doc, options).links)

  // 4. Post content (Lexical richText)
  if (doc.content && typeof doc.content === 'object' && !Array.isArray(doc.content)) {
    allLinks.push(...extractLinksFromLexical(doc.content))
  }

  // Filter to internal links only and normalize to slugs
  const internalLinks: Array<{ url: string; slug: string; text: string }> = []
  for (const link of allLinks) {
    const url = link.url.trim()
    // Internal links: start with / or don't start with http
    if (
      url.startsWith('/') ||
      (!url.startsWith('http') &&
        !url.startsWith('mailto:') &&
        !url.startsWith('tel:') &&
        url !== '#' &&
        url !== '')
    ) {
      const normalized = normalizeToSlug(url)
      if (normalized !== null) {
        internalLinks.push({ url, slug: normalized, text: link.text || '' })
      }
    }
  }

  return internalLinks
}
