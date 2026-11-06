/**
 * Content of a `layout` blocks array: the one walker behind `buildContext`, the rules that
 * look at blocks, `extractDocContent` and the sidebar (which feeds it form state reduced to
 * a document), so they all see the same headings, text, links and images.
 *
 * It reads blocks by shape, not by `blockType`, so a block it has never seen still counts:
 * - every Lexical value (`{ root: { children } }`), at any depth, as rich text;
 * - a block's own `title` as a section heading (`h1` in a hero or page header, `h2`
 *   otherwise, like the app's `SectionHeading`), except blocks whose title is not one;
 * - strings under the copy keys in `TEXT_KEYS` (eyebrow, description, question, quote…),
 *   at any depth, as body text. Other strings (urls, variants, icons) never count;
 * - `link` / `links` (Payload link fields) as links; populated uploads as images;
 * - `question` + `answer` items (or an FAQ `blockType`) as an FAQ.
 *
 * Uploads must be populated (`depth >= 1`) to count: in form state they are IDs.
 */
import {
  extractHeadingsFromLexical,
  extractImagesFromLexical,
  extractLinksFromLexical,
  extractTextFromLexical,
} from '../helpers.js'
import { extractPayloadLink } from './payloadLink.js'

export interface BlocksContent {
  /** Text parts for word count and keyword density. */
  text: string[]
  /** The same parts with a sentence boundary at the end of each, for readability. */
  readability: string[]
  headings: Array<{ tag: string; text: string }>
  links: Array<{ url: string; text: string }>
  images: { total: number; withAlt: number; altTexts: string[] }
  /** Populated upload documents (image filename, size and format checks). */
  media: Array<Record<string, unknown>>
  /** Every Lexical value found, in document order (lists, paragraphs, sections). */
  lexicalRoots: unknown[]
  hasFaq: boolean
  /** Question/answer pairs with both halves filled in (what a `FAQPage` is built from). */
  faqPairs: Array<{ question: string; answer: string }>
}

/** The minimal slice of an `AnalysisContext` the walker output is cached on. */
interface HasBlockContent {
  blockContent?: BlocksContent
}

/**
 * The block content of an analysis: `buildContext` walks `input.blocks` once and the rules
 * read it from the context. A context built by hand (tests, custom callers) falls back to a
 * walk.
 */
export function blockContentOf(input: { blocks?: unknown }, ctx: HasBlockContent): BlocksContent {
  return ctx.blockContent ?? extractBlocksContent(input.blocks)
}

/** Block types whose `title` is the page's `h1` (rendered with `SectionHeading as="h1"`). */
const H1_TITLE_BLOCKS = new Set(['hero', 'pageHeader'])
/** Block types whose `title` is shown, but not as a heading. */
const TEXT_TITLE_BLOCKS = new Set(['logos'])
/** Block types whose `title` is not shown at all (an iframe's accessible name). */
const HIDDEN_TITLE_BLOCKS = new Set(['embed'])

export const FAQ_BLOCK_TYPES = new Set(['faq', 'FAQ', 'faqBlock', 'faqs'])

/** Field names holding visible copy. Strings under any other key are ignored. */
const TEXT_KEYS = new Set([
  'eyebrow',
  'title',
  'subtitle',
  'description',
  'question',
  'quote',
  'body',
  'caption',
  'name',
  'role',
  'label',
  'feature',
  'footnote',
  'value',
  'price',
  'period',
  'badge',
  'author',
  'content',
  'text',
])

/** Nested objects that are not page copy (section settings, relations rendered elsewhere). */
const SKIP_KEYS = new Set(['section', 'reusableSection'])

/** Object nesting cap for the block walk (Lexical trees use `maxDepth`). */
const MAX_BLOCK_DEPTH = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isLexical(value: unknown): boolean {
  if (!isRecord(value)) return false
  const root = value.root
  return isRecord(root) && Array.isArray(root.children)
}

/** A populated upload document (not an ID). */
function isUpload(value: Record<string, unknown>): boolean {
  return (
    (typeof value.mimeType === 'string' || typeof value.filename === 'string') &&
    !!(value.url || value.filename)
  )
}

function withBoundary(text: string): string {
  return /[.!?…:;]$/.test(text) ? text : `${text}.`
}

export function extractBlocksContent(blocks: unknown, maxDepth = 10): BlocksContent {
  const out: BlocksContent = {
    text: [],
    readability: [],
    headings: [],
    links: [],
    images: { total: 0, withAlt: 0, altTexts: [] },
    media: [],
    lexicalRoots: [],
    hasFaq: false,
    faqPairs: [],
  }
  if (!Array.isArray(blocks)) return out

  const addText = (value: string) => {
    const t = value.trim()
    if (!t) return
    out.text.push(t)
    out.readability.push(withBoundary(t))
  }

  const addLexical = (root: unknown) => {
    out.lexicalRoots.push(root)
    const t = extractTextFromLexical(root, maxDepth)
    if (t.trim()) {
      out.text.push(t)
      out.readability.push(extractTextFromLexical(root, maxDepth, true))
    }
    out.headings.push(...extractHeadingsFromLexical(root, maxDepth))
    out.links.push(...extractLinksFromLexical(root, maxDepth))
    const imgs = extractImagesFromLexical(root, maxDepth)
    out.images.total += imgs.total
    out.images.withAlt += imgs.withAlt
    out.images.altTexts.push(...imgs.altTexts)
  }

  const addUpload = (media: Record<string, unknown>) => {
    // Videos and files are uploads too; only images take part in the image checks.
    if (typeof media.mimeType === 'string' && !media.mimeType.startsWith('image/')) return
    out.media.push(media)
    out.images.total++
    if (typeof media.alt === 'string' && media.alt.trim()) {
      out.images.withAlt++
      out.images.altTexts.push(media.alt.trim())
    }
  }

  const addLink = (link: unknown) => {
    const data = extractPayloadLink(link)
    if (data) out.links.push(data)
  }

  /** Both halves of a Q/A item, as text (an answer may be a Lexical tree). */
  const addFaqPair = (question: unknown, answer: unknown) => {
    const q = typeof question === 'string' ? question.trim() : ''
    const a =
      typeof answer === 'string'
        ? answer.trim()
        : isRecord(answer)
          ? extractTextFromLexical(answer, maxDepth).trim()
          : ''
    if (q && a) out.faqPairs.push({ question: q, answer: a })
  }

  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_BLOCK_DEPTH) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (!isRecord(value)) return
    if (isLexical(value)) return addLexical(value)
    if (isUpload(value)) return addUpload(value)
    if (typeof value.question === 'string' && value.answer) {
      out.hasFaq = true
      addFaqPair(value.question, value.answer)
    }
    visitFields(value, depth)
  }

  const visitFields = (obj: Record<string, unknown>, depth: number, skip?: string) => {
    for (const [key, child] of Object.entries(obj)) {
      if (key === skip || SKIP_KEYS.has(key)) continue
      if (key === 'link') {
        if (obj.enableLink === false) continue
        if (typeof child === 'string') {
          // Plain-URL link fields (upstream services / portfolio items).
          if (child) {
            const label = obj.title ?? obj.name
            out.links.push({ url: child, text: typeof label === 'string' ? label : '' })
          }
        } else addLink(child)
        continue
      }
      if (key === 'links' && Array.isArray(child)) {
        for (const item of child) if (isRecord(item)) addLink(item.link)
        continue
      }
      if (key === 'ctaLink') {
        if (typeof child === 'string' && child) {
          const label = obj.ctaLabel
          out.links.push({ url: child, text: typeof label === 'string' ? label : '' })
        }
        continue
      }
      if (typeof child === 'string') {
        if (TEXT_KEYS.has(key)) addText(child)
        continue
      }
      visit(child, depth + 1)
    }
  }

  for (const block of blocks) {
    if (!isRecord(block)) continue
    const blockType = typeof block.blockType === 'string' ? block.blockType : ''
    if (FAQ_BLOCK_TYPES.has(blockType)) out.hasFaq = true

    const title = typeof block.title === 'string' ? block.title.trim() : ''
    if (title && !HIDDEN_TITLE_BLOCKS.has(blockType)) {
      if (!TEXT_TITLE_BLOCKS.has(blockType)) {
        out.headings.push({ tag: H1_TITLE_BLOCKS.has(blockType) ? 'h1' : 'h2', text: title })
      }
      addText(title)
    }
    if (typeof block.question === 'string' && block.answer) {
      out.hasFaq = true
      addFaqPair(block.question, block.answer)
    }
    if (FAQ_BLOCK_TYPES.has(blockType)) {
      // An FAQ block's items may name the question `title` instead of `question`.
      for (const key of ['items', 'questions', 'faqs']) {
        const items = block[key]
        if (!Array.isArray(items)) continue
        for (const item of items) {
          if (isRecord(item) && typeof item.question !== 'string') addFaqPair(item.title, item.answer)
        }
      }
    }
    visitFields(block, 0, 'title')
  }

  return out
}
