/**
 * Text helpers for the Google-result (SERP) preview: cut at a word boundary the way Google
 * does, and bold the focus keyphrase the way Google bolds the search terms.
 *
 * Approach after focusreactive/payload-plugins `truncate-description.ts` and
 * `highlight-keyphrase.tsx` (MIT, commit e40c7a0): written fresh for this package, adding the
 * accent-insensitive matching of `normalizeForComparison`. Nothing from the GPL-licensed
 * `@yoast/search-metadata-previews` is used.
 */
import React from 'react'

import { normalizeForComparison } from '../helpers.js'

const ELLIPSIS = ' …'

/**
 * Cut `text` to at most `maxChars` characters. Over the limit it cuts at the last whitespace
 * that fits and appends " …" (space + ellipsis); with no whitespace inside the budget it
 * hard-cuts at the limit. Text at or under the limit comes back unchanged.
 */
export function truncateAtWord(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text

  // Look one character past the budget: a whitespace right at `maxChars` means the last
  // word still fits whole.
  const head = text.slice(0, maxChars + 1)
  let cut = -1
  for (let i = head.length - 1; i > 0; i--) {
    if (/\s/.test(head[i])) {
      cut = i
      break
    }
  }
  const kept = (cut > 0 ? text.slice(0, cut) : text.slice(0, maxChars)).trimEnd()
  return kept + ELLIPSIS
}

const MARKS_RE = /[̀-ͯ]/g
const QUOTED_RE = /^["“”](.+)["“”]$/s

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Accent-free, lowercase copy of `text` (as `normalizeForComparison`), with, for each
 * character of the copy, the span of the original character it came from.
 */
function foldWithMap(text: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = ''
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0
  for (const ch of text) {
    const piece = ch.toLowerCase().normalize('NFD').replace(MARKS_RE, '')
    for (let i = 0; i < piece.length; i++) {
      starts.push(offset)
      ends.push(offset + ch.length)
    }
    folded += piece
    offset += ch.length
  }
  return { folded, starts, ends }
}

/** One case- and accent-insensitive regex for the terms, longest first; null when empty. */
function buildTermsRegex(terms: readonly string[]): RegExp | null {
  const folded = terms
    .map((term) => {
      const trimmed = term.trim()
      return normalizeForComparison(QUOTED_RE.exec(trimmed)?.[1] ?? trimmed)
    })
    .filter(Boolean)
  const unique = [...new Set(folded)].sort((a, b) => b.length - a.length)
  if (unique.length === 0) return null
  return new RegExp(unique.map(escapeRegExp).join('|'), 'g')
}

/**
 * Split `text` into plain strings and `<strong>` nodes for every match of the terms. Returns
 * React nodes: nothing is parsed as HTML. Matching ignores case and accents ("cafe" bolds
 * "café") but the original text is what's rendered.
 */
export function highlightKeyphrases(text: string, terms: readonly string[]): React.ReactNode[] {
  if (!text) return []
  const re = buildTermsRegex(terms)
  if (!re) return [text]

  const { folded, starts, ends } = foldWithMap(text)
  const nodes: React.ReactNode[] = []
  let last = 0
  for (const match of folded.matchAll(re)) {
    if (match[0].length === 0) continue
    const from = Math.max(starts[match.index], last)
    let to = ends[match.index + match[0].length - 1]
    // Combining marks fold away to nothing: keep the ones that follow the match with it.
    while (to < text.length && /[\u0300-\u036f]/.test(text[to])) to++
    if (to <= from) continue
    if (from > last) nodes.push(text.slice(last, from))
    nodes.push(React.createElement('strong', { key: `${from}-${to}` }, text.slice(from, to)))
    last = to
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length > 0 ? nodes : [text]
}
