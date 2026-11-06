import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { highlightKeyphrases, truncateAtWord } from '../helpers/serpPreviewText.js'

const html = (nodes: React.ReactNode[]) =>
  renderToStaticMarkup(React.createElement(React.Fragment, null, ...nodes))

describe('truncateAtWord', () => {
  it('leaves text under the limit alone', () => {
    expect(truncateAtWord('short text', 20)).toBe('short text')
  })

  it('leaves text exactly at the limit alone', () => {
    expect(truncateAtWord('one two three', 13)).toBe('one two three')
  })

  it('cuts over the limit at the last whitespace that fits, then appends " …"', () => {
    expect(truncateAtWord('one two three four', 14)).toBe('one two three …')
    expect(truncateAtWord('one two three four', 10)).toBe('one two …')
  })

  it('keeps a last word that ends exactly at the budget', () => {
    expect(truncateAtWord('one two three', 7)).toBe('one two …')
  })

  it('hard-cuts when there is no whitespace within the budget', () => {
    expect(truncateAtWord('supercalifragilistic is long', 5)).toBe('super …')
    expect(truncateAtWord('supercalifragilistic', 5)).toBe('super …')
  })

  it('drops trailing whitespace before the ellipsis', () => {
    expect(truncateAtWord('one two   three', 9)).toBe('one two …')
  })
})

describe('highlightKeyphrases', () => {
  it('returns the text untouched without terms or without a match', () => {
    expect(highlightKeyphrases('Coffee basics', [])).toEqual(['Coffee basics'])
    expect(highlightKeyphrases('Coffee basics', ['  '])).toEqual(['Coffee basics'])
    expect(highlightKeyphrases('Coffee basics', ['tea'])).toEqual(['Coffee basics'])
    expect(highlightKeyphrases('', ['tea'])).toEqual([])
  })

  it('ignores case and keeps the original casing', () => {
    expect(html(highlightKeyphrases('Best COFFEE beans', ['coffee']))).toBe(
      'Best <strong>COFFEE</strong> beans',
    )
  })

  it('treats regex characters in the keyphrase literally', () => {
    expect(html(highlightKeyphrases('Learn C++ (fast) in 5 days. Really?', ['c++', '(fast)', '.']))).toBe(
      'Learn <strong>C++</strong> <strong>(fast)</strong> in 5 days<strong>.</strong> Really?',
    )
    expect(() => highlightKeyphrases('text', ['[', '\\', '*'])).not.toThrow()
  })

  it('prefers the longest of overlapping terms', () => {
    expect(html(highlightKeyphrases('Cold brew coffee guide', ['brew', 'cold brew coffee']))).toBe(
      '<strong>Cold brew coffee</strong> guide',
    )
  })

  it('matches accents the way normalizeForComparison does', () => {
    expect(html(highlightKeyphrases('Un café à Paris', ['cafe']))).toBe('Un <strong>café</strong> à Paris')
    expect(html(highlightKeyphrases('Un cafe', ['café']))).toBe('Un <strong>cafe</strong>')
    // Decomposed input (e + combining acute) bolds as one unit and keeps its glyphs.
    expect(html(highlightKeyphrases('café noir', ['cafe']))).toBe(
      '<strong>café</strong> noir',
    )
  })

  it('bolds every occurrence and strips the quotes of an exact-match keyphrase', () => {
    expect(html(highlightKeyphrases('tea or tea', ['"tea"']))).toBe(
      '<strong>tea</strong> or <strong>tea</strong>',
    )
  })

  it('never injects markup from the text', () => {
    expect(html(highlightKeyphrases('<img src=x onerror=alert(1)> coffee', ['coffee']))).toBe(
      '&lt;img src=x onerror=alert(1)&gt; <strong>coffee</strong>',
    )
  })
})
