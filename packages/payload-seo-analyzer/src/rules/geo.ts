/**
 * SEO Rules — GEO / Generative Engine Optimization (SEO 2026).
 *
 * Signals that make content easy for generative engines (AI Overviews, ChatGPT,
 * Perplexity) to EXTRACT and CITE: a concise answer-first lead, question-style
 * headings, and extractable structures (lists, tables), well-chunked content.
 *
 * These are DIRECTIONAL hints, NOT ranking factors: every check is weight 0 (it does
 * not move the SEO score). They feed the separate AI-readiness indicator. Per the
 * analysis debate, we deliberately avoid hard numeric thresholds presented as targets.
 *
 * Translations are kept local to avoid bloating the central i18n file.
 */
import type { SeoCheck, SeoInput, AnalysisContext } from '../types.js'
import { extractListsFromLexical, countLongSections } from '../helpers.js'
import { extractBlocksContent } from '../helpers/blockContent.js'

const QUESTION_WORDS: readonly string[] = ['how', 'why', 'when', 'what', 'which', 'where', 'who', 'can', 'do', 'does', 'is', 'are', 'should']

/**
 * Definition-snippet detectors: a concise "<term> is/refers to …" sentence near the top
 * is the passage generative engines extract most readily. Kept deliberately specific
 * (copula + determiner, or explicit defining verbs) to avoid matching ordinary prose.
 */
const DEFINITION = /\b(is|are)\s+(a|an|the)\b|\b(refers\s+to|means|is\s+defined\s+as|consists\s+of|stands\s+for)\b/i

/** A paragraph longer than this (words, between two headings) reads as a wall of text. */
const CHUNK_WALL_THRESHOLD = 200
/** Minimum items for a numbered list to count as a HowTo procedure. */
const HOWTO_MIN_STEPS = 3
/** Minimum question-style headings to count as an FAQ block. */
const FAQ_MIN_QUESTIONS = 2

const STRINGS = {
  answerLabel: 'Answer-first lead',
  answerPass: 'Content opens with a concise lead — helps AI extraction.',
  answerFail: 'Content does not open with a concise answer — put a direct answer at the top of the page/section.',
  answerTip: 'BLUF (Bottom Line Up Front): answer the intent in 1-2 sentences before expanding.',
  questionsLabel: 'Question-style headings',
  questionsPass: (n: number) => `${n} heading(s) phrased as questions — ideal Q→A structure for AI.`,
  questionsFail: 'No question headings — phrase some H2/H3 as questions (AI engines cite question/answer pairs).',
  structureLabel: 'Extractable content (lists / tables)',
  structurePass: 'Lists or tables detected — units easily extracted and cited by AI.',
  structureFail: 'No list or table — structure enumerations and comparisons as lists/tables.',
  chunkLabel: 'Chunked content (scannable)',
  chunkPass: 'Content is well chunked into sections — helps passage extraction.',
  chunkFail: 'Content is barely chunked — add subheadings to create self-contained passages.',
  faqLabel: 'FAQ / HowTo structure (Q→A or steps)',
  faqPass: 'FAQ/Q→A or HowTo steps detected — formats quoted verbatim by ChatGPT/Perplexity.',
  faqFail: 'No FAQ or HowTo structure — group question/answer pairs or numbered steps.',
  faqTip: 'Add an FAQ section (≥2 questions) or a numbered HowTo procedure — AI engines extract them word for word.',
  defLabel: 'Extractable definition up top',
  defPass: 'Concise definition sentence up top — helps the AI extract a snippet.',
  defFail: 'No concise definition up top — add an "X is / refers to …" sentence near the start.',
  defTip: 'Give a one-sentence direct definition ("SEO is …") in the first lines: it is the passage AI cites most.',
  chunkDensLabel: 'Short self-contained paragraphs',
  chunkDensPass: 'Short, self-contained paragraphs — each passage extracts on its own.',
  chunkDensFail: 'Some passages are long walls of text — split them into short self-contained paragraphs.',
  chunkDensTip: 'Aim for self-contained paragraphs (one idea each): AI cites isolated passages, not walls of text.',
} as const

const GEO_SKIP_PAGE_TYPES = new Set(['legal', 'contact', 'form', 'home'])

function isQuestionHeading(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.endsWith('?')) return true
  return QUESTION_WORDS.some((w) => t.startsWith(w + ' ') || t.startsWith(w + '-'))
}

/** Gather Lexical roots from all input sources (hero, content, blocks, columns). */
function collectLexicalSources(input: SeoInput): unknown[] {
  const sources: unknown[] = []
  if (input.heroRichText) sources.push(input.heroRichText)
  if (input.content) sources.push(input.content)
  sources.push(...extractBlocksContent(input.blocks).lexicalRoots)
  return sources
}

/** Recursively check whether a Lexical tree contains a node of the given type. */
function containsLexicalType(node: unknown, type: string, depth = 0): boolean {
  if (depth > 50 || !node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === type) return true
  const root = (n.root as Record<string, unknown>) || n
  const children = (root.children as unknown[]) || (n.children as unknown[])
  if (Array.isArray(children)) {
    for (const c of children) {
      if (containsLexicalType(c, type, depth + 1)) return true
    }
  }
  return false
}

export function checkGeo(input: SeoInput, ctx: AnalysisContext): SeoCheck[] {
  const checks: SeoCheck[] = []

  if (GEO_SKIP_PAGE_TYPES.has(ctx.pageType) || ctx.wordCount < 150) return checks


  // 1. Answer-first lead — heuristic: the first sentence is concise (BLUF).
  const firstSentence = (ctx.sentences[0] || '').trim()
  const firstSentenceWords = firstSentence ? firstSentence.split(/\s+/).length : 0
  const answerFirst = firstSentenceWords > 0 && firstSentenceWords <= 30
  checks.push({
    id: 'geo-answer-first',
    label: STRINGS.answerLabel,
    status: answerFirst ? 'pass' : 'warning',
    message: answerFirst ? STRINGS.answerPass : STRINGS.answerFail,
    category: 'bonus',
    weight: 0,
    group: 'geo',
    ...(answerFirst ? {} : { tip: STRINGS.answerTip }),
  })

  // 2. Question-style headings (Q→A structure is highly citable)
  const questionHeadings = ctx.allHeadings.filter(
    (h) => h.tag !== 'h1' && isQuestionHeading(h.text),
  ).length
  checks.push({
    id: 'geo-question-headings',
    label: STRINGS.questionsLabel,
    status: questionHeadings > 0 ? 'pass' : 'warning',
    message: questionHeadings > 0 ? STRINGS.questionsPass(questionHeadings) : STRINGS.questionsFail,
    category: 'bonus',
    weight: 0,
    group: 'geo',
  })

  // 3. Extractable structures — lists or tables
  const sources = collectLexicalSources(input)
  const allLists = sources.flatMap((src) => extractListsFromLexical(src))
  const hasList = allLists.length > 0
  const hasTable = sources.some((src) => containsLexicalType(src, 'table'))
  const structured = hasList || hasTable
  checks.push({
    id: 'geo-extractable-structure',
    label: STRINGS.structureLabel,
    status: structured ? 'pass' : 'warning',
    message: structured ? STRINGS.structurePass : STRINGS.structureFail,
    category: 'bonus',
    weight: 0,
    group: 'geo',
  })

  // 4. Chunked content — roughly one subheading per ~300 words
  const subheadings = ctx.allHeadings.filter((h) => h.tag !== 'h1').length
  const expected = Math.max(1, Math.floor(ctx.wordCount / 300))
  const chunked = subheadings >= expected
  checks.push({
    id: 'geo-chunked',
    label: STRINGS.chunkLabel,
    status: chunked ? 'pass' : 'warning',
    message: chunked ? STRINGS.chunkPass : STRINGS.chunkFail,
    category: 'bonus',
    weight: 0,
    group: 'geo',
  })

  // 5. FAQ / HowTo structure — Q→A pairs (≥2 question headings) or a numbered
  //    procedure. AI engines (ChatGPT, Perplexity) lift these formats verbatim.
  const isFaq = questionHeadings >= FAQ_MIN_QUESTIONS
  const hasHowToSteps = allLists.some((l) => l.listType === 'number' && l.items >= HOWTO_MIN_STEPS)
  const faqOrHowTo = isFaq || hasHowToSteps
  checks.push({
    id: 'geo-faq-howto',
    label: STRINGS.faqLabel,
    status: faqOrHowTo ? 'pass' : 'warning',
    message: faqOrHowTo ? STRINGS.faqPass : STRINGS.faqFail,
    category: 'bonus',
    weight: 0,
    group: 'geo',
    ...(faqOrHowTo ? {} : { tip: STRINGS.faqTip }),
  })

  // 6. Definition snippet — a concise "X is / refers to …" sentence near the top is
  //    the passage generative engines most readily extract and cite.
  const hasDefinition = ctx.sentences.slice(0, 3).some((sentence) => {
    const sen = sentence.trim()
    const words = sen ? sen.split(/\s+/).length : 0
    return words > 0 && words <= 35 && DEFINITION.test(sen)
  })
  checks.push({
    id: 'geo-definition',
    label: STRINGS.defLabel,
    status: hasDefinition ? 'pass' : 'warning',
    message: hasDefinition ? STRINGS.defPass : STRINGS.defFail,
    category: 'bonus',
    weight: 0,
    group: 'geo',
    ...(hasDefinition ? {} : { tip: STRINGS.defTip }),
  })

  // 7. Extractable chunks — short, self-contained paragraphs (no walls of text).
  //    Only evaluated when there is paragraph-level structure to inspect.
  if (sources.length > 0) {
    const longSections = sources.reduce<number>(
      (sum, src) => sum + countLongSections(src, CHUNK_WALL_THRESHOLD),
      0,
    )
    const extractableChunks = longSections === 0
    checks.push({
      id: 'geo-extractable-chunks',
      label: STRINGS.chunkDensLabel,
      status: extractableChunks ? 'pass' : 'warning',
      message: extractableChunks ? STRINGS.chunkDensPass : STRINGS.chunkDensFail,
      category: 'bonus',
      weight: 0,
      group: 'geo',
      ...(extractableChunks ? {} : { tip: STRINGS.chunkDensTip }),
    })
  }

  return checks
}
