/**
 * Unified document content extraction.
 * Extracts text, headings, links, and images from a Payload document.
 * Replaces duplicated extraction logic across audit, trackSeoScore,
 * keywordResearch, duplicateContent, aiRewrite, etc.
 */

import {
  extractTextFromLexical,
  extractLinksFromLexical,
  extractHeadingsFromLexical,
  extractImagesFromLexical,
} from '../helpers.js'
import { type ContentExtractorSource, extractDocBlocks } from './contentExtractor.js'

export interface ExtractedContent {
  text: string
  /**
   * Same content as `text` but with sentence boundaries at block ends (paragraphs,
   * list items, headings). Use for readability/Flesch so scannable list-heavy
   * content isn't merged into one giant pseudo-sentence. Use `text` for word count.
   */
  readabilityText: string
  headings: Array<{ tag: string; text: string }>
  links: Array<{ url: string; text: string }>
  images: Array<{ src: string; alt: string }>
}

/**
 * Extract all content from a Payload document (pages, posts, globals).
 * Handles: hero, layout blocks (any block, via `extractBlocksContent`: section
 * headings, item copy, links and every Lexical value), post `content`, and plain
 * text fields (title, meta.description, etc.).
 *
 * @param doc - A Payload document (any collection)
 * @param maxDepth - Maximum Lexical tree traversal depth (default: 10)
 * @param options - The document's collection and the `extractContent` extractors (the map,
 *   or `req.payload`): a collection with its own extractor replaces the `layout` walk.
 */
export function extractDocContent(
  doc: Record<string, unknown>,
  maxDepth = 10,
  options: { collection?: string; extractors?: ContentExtractorSource } = {},
): ExtractedContent {
  const textParts: string[] = []
  // Parallel parts WITH sentence boundaries at block ends — readability metrics only.
  const readabilityParts: string[] = []
  const headings: ExtractedContent['headings'] = []
  const links: ExtractedContent['links'] = []
  const images: ExtractedContent['images'] = []

  // --- Title & Meta ---
  if (typeof doc.title === 'string') {
    textParts.push(doc.title)
    readabilityParts.push(doc.title)
  }

  const meta = doc.meta as Record<string, unknown> | undefined
  if (meta) {
    if (typeof meta.title === 'string') {
      textParts.push(meta.title)
      readabilityParts.push(meta.title)
    }
    if (typeof meta.description === 'string') {
      textParts.push(meta.description)
      readabilityParts.push(meta.description)
    }
  }

  // --- Hero ---
  const hero = doc.hero as Record<string, unknown> | undefined
  if (hero?.richText) {
    textParts.push(extractTextFromLexical(hero.richText, maxDepth))
    readabilityParts.push(extractTextFromLexical(hero.richText, maxDepth, true))
    links.push(...extractLinksFromLexical(hero.richText, maxDepth))
    headings.push(...extractHeadingsFromLexical(hero.richText, maxDepth))
  }

  // --- Layout blocks (shared walker, or the collection's extractor: same as the analyzer) ---
  const blockContent = extractDocBlocks(doc, { ...options, maxDepth })
  textParts.push(...blockContent.text)
  readabilityParts.push(...blockContent.readability)
  links.push(...blockContent.links)
  headings.push(...blockContent.headings)

  // --- Post content (Lexical richText) ---
  if (doc.content && typeof doc.content === 'object' && !Array.isArray(doc.content)) {
    textParts.push(extractTextFromLexical(doc.content, maxDepth))
    readabilityParts.push(extractTextFromLexical(doc.content, maxDepth, true))
    links.push(...extractLinksFromLexical(doc.content, maxDepth))
    headings.push(...extractHeadingsFromLexical(doc.content, maxDepth))
  }

  // --- Extract images from all Lexical fields ---
  if (hero?.richText) {
    const heroImgs = extractImagesFromLexical(hero.richText, maxDepth)
    for (const alt of heroImgs.altTexts) {
      images.push({ src: '', alt })
    }
  }
  for (const alt of blockContent.images.altTexts) {
    images.push({ src: '', alt })
  }
  if (doc.content && typeof doc.content === 'object' && !Array.isArray(doc.content)) {
    const contentImgs = extractImagesFromLexical(doc.content, maxDepth)
    for (const alt of contentImgs.altTexts) {
      images.push({ src: '', alt })
    }
  }

  return {
    text: textParts.filter(Boolean).join(' ').trim(),
    readabilityText: readabilityParts.filter(Boolean).join(' ').trim(),
    headings,
    links,
    images,
  }
}
