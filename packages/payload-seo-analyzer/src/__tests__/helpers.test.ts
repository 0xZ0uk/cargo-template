import { describe, it, expect } from 'vitest'
import {
  normalizeForComparison,
  slugifyKeyword,
  keywordMatchesText,
  countKeywordOccurrences,
  detectPageType,
  extractTextFromLexical,
  extractHeadingsFromLexical,
  calculateFlesch,
  countSyllablesEN,
  countWords,
  countSentences,
  detectPassiveVoice,
  hasTransitionWord,
  checkHeadingHierarchy,
  findHeadingSkips,
  countLongSections,
  isStopWordInCompoundExpression,
} from '../helpers'
import { getStopWords, getActionVerbs } from '../constants'

// ---------------------------------------------------------------------------
// normalizeForComparison
// ---------------------------------------------------------------------------

describe('normalizeForComparison', () => {
  it('strips accents', () => {
    expect(normalizeForComparison('Réalité augmentée')).toBe('realite augmentee')
  })

  it('lowercases and trims', () => {
    expect(normalizeForComparison('  Hello WORLD  ')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(normalizeForComparison('')).toBe('')
  })

  it('handles cedilla and other diacritics', () => {
    expect(normalizeForComparison('Garçon')).toBe('garcon')
    expect(normalizeForComparison('Noël')).toBe('noel')
  })
})

// ---------------------------------------------------------------------------
// slugifyKeyword
// ---------------------------------------------------------------------------

describe('slugifyKeyword', () => {
  it('converts spaces to hyphens and strips accents', () => {
    expect(slugifyKeyword('Web Agency Boston')).toBe('web-agency-boston')
  })

  it('removes dots and ampersands', () => {
    expect(slugifyKeyword('Next.js & React')).toBe('nextjs-react')
  })

  it('removes slashes', () => {
    // Slash is stripped by the regex, leaving "uxui" joined
    expect(slugifyKeyword('design UX/UI')).toBe('design-uxui')
  })
})

// ---------------------------------------------------------------------------
// keywordMatchesText
// ---------------------------------------------------------------------------

describe('keywordMatchesText', () => {
  it('finds exact substring match', () => {
    expect(keywordMatchesText('web agency', 'our web agency in boston')).toBe(true)
  })

  it('returns false for absent keyword', () => {
    expect(keywordMatchesText('mobile creation', 'our web agency in boston')).toBe(false)
  })

  it('handles multi-word keywords with significant words present', () => {
    expect(
      keywordMatchesText(
        'privacy policy gdpr',
        'discover our privacy policy compliant with gdpr',
      ),
    ).toBe(true)
  })

  it('returns false when not all significant words present for 3+ words', () => {
    expect(
      keywordMatchesText(
        'privacy policy gdpr',
        'discover our privacy policy',
      ),
    ).toBe(false)
  })

  it('returns false for empty inputs', () => {
    expect(keywordMatchesText('', 'some text')).toBe(false)
    expect(keywordMatchesText('keyword', '')).toBe(false)
  })

  it('handles single short keyword', () => {
    expect(keywordMatchesText('seo', 'complete seo guide')).toBe(true)
    expect(keywordMatchesText('seo', 'complete guide')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// countKeywordOccurrences
// ---------------------------------------------------------------------------

describe('countKeywordOccurrences', () => {
  it('counts exact occurrences and computes density', () => {
    const text = 'web agency in boston is a web agency of quality'
    const result = countKeywordOccurrences('web agency', text, 10)
    expect(result.exactCount).toBe(2)
    expect(result.wordLevelMatch).toBe(true)
    expect(result.effectiveDensity).toBeCloseTo(40, 0) // 2*2/10 * 100 = 40%
  })

  it('returns zero for absent keyword', () => {
    const result = countKeywordOccurrences('mobile creation', 'web agency boston', 3)
    expect(result.exactCount).toBe(0)
    expect(result.wordLevelMatch).toBe(false)
    expect(result.effectiveDensity).toBe(0)
  })

  it('detects word-level match for multi-word keywords', () => {
    const result = countKeywordOccurrences(
      'website creation service',
      'the creation of your website for any service is our job',
      10,
    )
    expect(result.exactCount).toBe(0)
    expect(result.wordLevelMatch).toBe(true)
    expect(result.effectiveDensity).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// detectPageType (unified version)
// ---------------------------------------------------------------------------

describe('detectPageType', () => {
  // Collection-based detection
  it('detects blog from collection=posts', () => {
    expect(detectPageType('some-article', 'posts')).toBe('blog')
  })

  // Home
  it('detects home from empty slug', () => {
    expect(detectPageType('')).toBe('home')
    expect(detectPageType('home')).toBe('home')
  })

  // Legal pages
  it('detects legal pages by slug', () => {
    expect(detectPageType('legal-notice')).toBe('legal')
    expect(detectPageType('privacy-policy')).toBe('legal')
    expect(detectPageType('terms-of-service')).toBe('legal')
    expect(detectPageType('terms')).toBe('legal')
    expect(detectPageType('cookies')).toBe('legal')
    expect(detectPageType('accessibility')).toBe('legal')
    expect(detectPageType('gdpr')).toBe('legal')
  })

  // Contact
  it('detects contact page', () => {
    expect(detectPageType('contact')).toBe('contact')
  })

  // Form pages
  it('detects form pages', () => {
    expect(detectPageType('request-quote')).toBe('form')
    expect(detectPageType('signup')).toBe('form')
    expect(detectPageType('support')).toBe('form')
  })

  // Local SEO
  it('detects local SEO from explicit slugs', () => {
    expect(detectPageType('seattle-web', undefined, ['seattle-web'])).toBe('local-seo')
  })

  it('detects local SEO from patterns', () => {
    expect(detectPageType('web-agency-boston')).toBe('local-seo')
    expect(detectPageType('web-developer-miami')).toBe('local-seo')
    expect(detectPageType('seo-agency-austin')).toBe('local-seo')
  })

  // Service
  it('detects service pages', () => {
    expect(detectPageType('services/web-design')).toBe('service')
    expect(detectPageType('services-development')).toBe('service')
    expect(detectPageType('our-services')).toBe('service')
  })

  // Resource
  it('detects resource pages', () => {
    expect(detectPageType('resources/seo-guide')).toBe('resource')
    expect(detectPageType('resources-free')).toBe('resource')
  })

  // Agency
  it('detects agency pages', () => {
    expect(detectPageType('about-us')).toBe('agency')
    expect(detectPageType('about')).toBe('agency')
    expect(detectPageType('portfolio')).toBe('agency')
  })

  // Blog slug-based fallback
  it('detects blog from slug pattern', () => {
    expect(detectPageType('posts/my-article')).toBe('blog')
    expect(detectPageType('blog/guide')).toBe('blog')
  })

  // Generic
  it('returns generic for unknown slugs', () => {
    expect(detectPageType('pricing')).toBe('generic')
    expect(detectPageType('random-page')).toBe('generic')
  })
})

// ---------------------------------------------------------------------------
// extractTextFromLexical
// ---------------------------------------------------------------------------

describe('extractTextFromLexical', () => {
  it('extracts text from a simple Lexical tree', () => {
    const node = {
      root: {
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      },
    }
    expect(extractTextFromLexical(node)).toBe('Hello world')
  })

  it('handles null/undefined', () => {
    expect(extractTextFromLexical(null)).toBe('')
    expect(extractTextFromLexical(undefined)).toBe('')
  })

  it('does NOT add sentence boundaries by default (clean output for word count / headings)', () => {
    const node = {
      root: {
        children: [
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Title without period' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'A paragraph' }] },
        ],
      },
    }
    // Default: blocks joined with a space, no injected periods.
    expect(extractTextFromLexical(node)).toBe('Title without period A paragraph')
  })

  it('adds sentence boundaries at block ends when sentenceBoundaries=true (readability)', () => {
    const node = {
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Intro without final punctuation' }] },
          {
            type: 'list',
            children: [
              { type: 'listitem', children: [{ type: 'text', text: 'First list item' }] },
              { type: 'listitem', children: [{ type: 'text', text: 'Second list item' }] },
            ],
          },
        ],
      },
    }
    const out = extractTextFromLexical(node, undefined, true)
    // Each block (paragraph + each list item) terminates a sentence.
    expect(out).toContain('Intro without final punctuation.')
    expect(out).toContain('First list item.')
    expect(out).toContain('Second list item.')
    // List-heavy content is now segmented into 3 sentences instead of 1 giant one.
    expect(countSentences(out).length).toBe(3)
    // A pre-existing terminator is not doubled.
    const ending = {
      root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Already punctuated!' }] }] },
    }
    expect(extractTextFromLexical(ending, undefined, true)).toBe('Already punctuated!')
  })

  it('respects maxDepth parameter', () => {
    // Build a tree 20 levels deep
    let tree: Record<string, unknown> = { type: 'text', text: 'found' }
    for (let i = 0; i < 20; i++) {
      tree = { type: 'paragraph', children: [tree] }
    }
    // With maxDepth=5, should not reach the text node 20 levels deep
    expect(extractTextFromLexical({ root: tree }, 5)).toBe('')
    // With default maxDepth (50), should reach it
    expect(extractTextFromLexical({ root: tree })).toContain('found')
  })

  it('concatenates multiple text nodes', () => {
    const node = {
      root: {
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'Hello' },
              { type: 'text', text: ' le monde' },
            ],
          },
        ],
      },
    }
    expect(extractTextFromLexical(node)).toContain('Hello')
    expect(extractTextFromLexical(node)).toContain('le monde')
  })
})

// ---------------------------------------------------------------------------
// extractHeadingsFromLexical
// ---------------------------------------------------------------------------

describe('extractHeadingsFromLexical', () => {
  it('extracts headings with tags', () => {
    const node = {
      root: {
        children: [
          { type: 'heading', tag: 'h1', children: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'Content' }] },
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Subtitle' }] },
        ],
      },
    }
    const headings = extractHeadingsFromLexical(node)
    expect(headings).toHaveLength(2)
    expect(headings[0]).toEqual({ tag: 'h1', text: 'Title' })
    expect(headings[1]).toEqual({ tag: 'h2', text: 'Subtitle' })
  })

  it('returns empty for no headings', () => {
    const node = {
      root: {
        children: [{ type: 'paragraph', children: [{ type: 'text', text: 'No headings' }] }],
      },
    }
    expect(extractHeadingsFromLexical(node)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// countSyllablesEN
// ---------------------------------------------------------------------------

describe('countSyllablesEN', () => {
  it('counts monosyllabic words', () => {
    expect(countSyllablesEN('test')).toBe(1)
    expect(countSyllablesEN('web')).toBe(1)
  })

  it('counts polysyllabic words', () => {
    expect(countSyllablesEN('creation')).toBeGreaterThanOrEqual(2)
    expect(countSyllablesEN('development')).toBeGreaterThanOrEqual(3)
  })

  it('handles silent-e and -ed endings', () => {
    expect(countSyllablesEN('make')).toBe(1)
    expect(countSyllablesEN('jumped')).toBe(1)
    expect(countSyllablesEN('wanted')).toBe(2)
  })

  it('returns 1 for empty/invalid input', () => {
    expect(countSyllablesEN('')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// calculateFlesch
// ---------------------------------------------------------------------------

describe('calculateFlesch', () => {
  it('returns 0 for empty text', () => {
    expect(calculateFlesch('')).toBe(0)
  })

  it('returns a score for normal text', () => {
    const text =
      'Web development is an exciting field. Technologies evolve quickly. You need to keep learning.'
    const score = calculateFlesch(text)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns higher score for simple sentences', () => {
    const simple = 'The cat sleeps. It rains. I eat.'
    const complex =
      'The algorithmic implementation of distributed systems requires a thorough understanding of concurrent programming paradigms.'
    expect(calculateFlesch(simple)).toBeGreaterThan(calculateFlesch(complex))
  })
})

// ---------------------------------------------------------------------------
// countWords / countSentences
// ---------------------------------------------------------------------------

describe('countWords', () => {
  it('counts words correctly', () => {
    expect(countWords('Hello world')).toBe(2)
    expect(countWords('  multiple   spaces  ')).toBe(2)
    expect(countWords('')).toBe(0)
  })
})

describe('countSentences', () => {
  it('splits on sentence-ending punctuation', () => {
    expect(countSentences('Hello. World!')).toHaveLength(2)
    expect(countSentences('One sentence')).toHaveLength(1)
  })

  it('handles abbreviations', () => {
    const sentences = countSentences('Mr. Smith is here. Mrs. Jones is here too.')
    expect(sentences).toHaveLength(2)
  })

  it('returns empty for empty text', () => {
    expect(countSentences('')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// detectPassiveVoice
// ---------------------------------------------------------------------------

describe('detectPassiveVoice', () => {
  it('detects passive voice with be-verb + past participle', () => {
    expect(detectPassiveVoice('The site is created by our team')).toBe(true)
    expect(detectPassiveVoice('The project was finished yesterday')).toBe(true)
  })

  it('returns false for active voice', () => {
    expect(detectPassiveVoice('Our team creates websites')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasTransitionWord
// ---------------------------------------------------------------------------

describe('hasTransitionWord', () => {
  it('detects transition words at start of sentence', () => {
    expect(hasTransitionWord('Furthermore, our service is fast')).toBe(true)
    expect(hasTransitionWord('However we should note that')).toBe(true)
  })

  it('detects transition words inside sentence', () => {
    expect(hasTransitionWord('Our service, indeed, is fast')).toBe(true)
  })

  it('returns false when no transition word', () => {
    expect(hasTransitionWord('Our service is fast')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// checkHeadingHierarchy
// ---------------------------------------------------------------------------

describe('checkHeadingHierarchy', () => {
  it('returns true for correct hierarchy', () => {
    expect(
      checkHeadingHierarchy([
        { tag: 'h1', text: 'Title' },
        { tag: 'h2', text: 'Sub' },
        { tag: 'h3', text: 'Sub-sub' },
      ]),
    ).toBe(true)
  })

  it('returns false for skipped levels', () => {
    expect(
      checkHeadingHierarchy([
        { tag: 'h1', text: 'Title' },
        { tag: 'h3', text: 'Skipped h2' },
      ]),
    ).toBe(false)
  })

  it('returns true for empty headings', () => {
    expect(checkHeadingHierarchy([])).toBe(true)
  })

  it('returns false for a skip after the outline went back up', () => {
    expect(checkHeadingHierarchy(seq('h1 h2 h3 h2 h4'))).toBe(false)
    expect(checkHeadingHierarchy(seq('h2 h3 h2 h4'))).toBe(false)
  })

  it('returns true when levels go back up by more than one', () => {
    expect(checkHeadingHierarchy(seq('h1 h2 h3 h4 h2 h3'))).toBe(true)
    expect(checkHeadingHierarchy(seq('h1 h2 h3 h4 h1'))).toBe(true)
  })

  it('lets a leading h3 pass: the H1 checks cover the top', () => {
    expect(checkHeadingHierarchy(seq('h3 h4'))).toBe(true)
  })
})

function seq(tags: string): Array<{ tag: string; text: string }> {
  return tags.split(' ').map((tag, i) => ({ tag, text: `Heading ${i}` }))
}

describe('findHeadingSkips', () => {
  it('returns nothing for a correct outline and for no headings', () => {
    expect(findHeadingSkips(seq('h1 h2 h3 h4 h2 h3'))).toEqual([])
    expect(findHeadingSkips([])).toEqual([])
  })

  it('compares each heading with the previous one', () => {
    expect(findHeadingSkips(seq('h1 h2 h3 h2 h4'))).toEqual([
      { index: 4, previousLevel: 2, level: 4, skippedLevels: [3], text: 'Heading 4' },
    ])
    expect(findHeadingSkips(seq('h2 h3 h2 h4'))).toHaveLength(1)
  })

  it('lists every skipped level', () => {
    expect(findHeadingSkips(seq('h2 h5'))[0]).toMatchObject({
      index: 1,
      previousLevel: 2,
      level: 5,
      skippedLevels: [3, 4],
    })
  })

  it('returns every skip, in order', () => {
    expect(findHeadingSkips(seq('h1 h3 h4 h2 h4 h6')).map((s) => s.index)).toEqual([1, 4, 5])
  })

  it('never flags the first heading', () => {
    expect(findHeadingSkips(seq('h3'))).toEqual([])
  })

  it('ignores tags that are not h1-h6', () => {
    expect(findHeadingSkips([...seq('h1'), { tag: 'p', text: 'x' }, { tag: 'h2', text: 'y' }])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// countLongSections
// ---------------------------------------------------------------------------

describe('countLongSections', () => {
  it('returns 0 for null input', () => {
    expect(countLongSections(null)).toBe(0)
  })

  it('counts sections exceeding threshold', () => {
    // Build a Lexical tree with a long paragraph (many words)
    const longText = Array(350).fill('word').join(' ')
    const node = {
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: longText }] },
        ],
      },
    }
    expect(countLongSections(node, 300)).toBe(1)
  })

  it('resets counter after heading', () => {
    const text150 = Array(150).fill('word').join(' ')
    const node = {
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: text150 }] },
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Title' }] },
          { type: 'paragraph', children: [{ type: 'text', text: text150 }] },
        ],
      },
    }
    expect(countLongSections(node, 300)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getStopWords / getActionVerbs
// ---------------------------------------------------------------------------

describe('getStopWords', () => {
  it('returns an array of stop words', () => {
    const words = getStopWords()
    expect(words.length).toBeGreaterThan(20)
    expect(words).toContain('the')
    expect(words).toContain('and')
  })
})

describe('getActionVerbs', () => {
  it('returns action verbs', () => {
    const verbs = getActionVerbs()
    expect(verbs.length).toBeGreaterThan(25)
    expect(verbs).toContain('discover')
    expect(verbs).toContain('download')
  })
})

// ---------------------------------------------------------------------------
// isStopWordInCompoundExpression
// ---------------------------------------------------------------------------

describe('isStopWordInCompoundExpression', () => {
  it('detects "in the" compound', () => {
    expect(isStopWordInCompoundExpression(['service', 'in', 'the'], 1)).toBe(true)
  })

  it('detects "on the" compound', () => {
    expect(isStopWordInCompoundExpression(['site', 'on', 'the'], 1)).toBe(true)
  })

  it('returns false for standalone stop word', () => {
    expect(isStopWordInCompoundExpression(['site', 'of', 'test'], 1)).toBe(false)
  })
})
