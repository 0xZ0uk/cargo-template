import { describe, it, expect } from 'vitest'
import { analyzeSeo } from '../index'
import type { SeoInput, AnalysisContext, SeoConfig, PageType } from '../types'
import { checkTitle } from '../rules/title'
import { checkMetaDescription } from '../rules/meta-description'
import { checkUrl } from '../rules/url'
import { checkHeadings } from '../rules/headings'
import { checkContent } from '../rules/content'
import { checkImages } from '../rules/images'
import { checkLinking } from '../rules/linking'
import { checkKeyphrase } from '../rules/keyphrase'
import { checkSocial } from '../rules/social'
import { checkSchema } from '../rules/schema'
import { checkReadability } from '../rules/readability'
import { checkQuality } from '../rules/quality'
import { checkSecondaryKeywords } from '../rules/secondary-keywords'
import { checkCornerstone } from '../rules/cornerstone'
import { checkFreshness } from '../rules/freshness'
import { checkTechnical } from '../rules/technical'
import { checkEeat } from '../rules/eeat'
import { checkGeo } from '../rules/geo'
import { checkHreflang } from '../rules/hreflang'
import { FLESCH_THRESHOLDS } from '../constants'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<SeoInput> = {}): SeoInput {
  return {
    metaTitle: 'Web Agency in Boston, Massachusetts | My Site',
    metaDescription:
      'Discover our web agency in Boston, Massachusetts. Website creation, web development and SEO services. Get a free quote today.',
    slug: 'web-agency-boston',
    focusKeyword: 'web agency boston',
    ...overrides,
  }
}

function makeCtx(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    fullText: 'Our agency is your web partner in Boston, Massachusetts. We build modern, high-performing websites. Our team of developers masters the latest technologies.',
    wordCount: 300,
    normalizedKeyword: 'web agency boston',
    secondaryNormalizedKeywords: [],
    allHeadings: [
      { tag: 'h1', text: 'Web Agency in Boston' },
      { tag: 'h2', text: 'Our web services' },
    ],
    allLinks: [
      { url: '/services/web-design', text: 'Web design' },
      { url: '/contact', text: 'Contact us' },
      { url: 'https://example.com', text: 'External source' },
    ],
    imageStats: { total: 2, withAlt: 2, altTexts: ['Web agency photo Boston', 'Web agency logo'] },
    sentences: [
      'Our agency is your web partner in Boston, Massachusetts.',
      'We build modern, high-performing websites.',
      'Our team of developers masters the latest technologies.',
    ],
    isPost: false,
    pageType: 'local-seo',
    config: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Title checks
// ---------------------------------------------------------------------------

describe('checkTitle', () => {
  it('passes with valid title', () => {
    const checks = checkTitle(makeInput(), makeCtx())
    const lengthCheck = checks.find((c) => c.id === 'title-length')
    expect(lengthCheck?.status).toBe('pass')
  })

  it('treats title length as informational, not critical (SEO desintox)', () => {
    const checks = checkTitle(makeInput(), makeCtx())
    const lengthCheck = checks.find((c) => c.id === 'title-length')
    // Title length is a SERP-display hint, not a ranking factor: down-weighted
    expect(lengthCheck?.category).not.toBe('critical')
    expect(lengthCheck?.weight).toBe(1)
  })

  it('adds an informational pixel-width estimate (weight 0)', () => {
    const checks = checkTitle(makeInput(), makeCtx())
    const px = checks.find((c) => c.id === 'title-pixel-width')
    expect(px).toBeDefined()
    expect(px?.weight).toBe(0)
  })

  it('warns when the title is very wide in pixels', () => {
    const checks = checkTitle(makeInput({ metaTitle: 'W'.repeat(70) }), makeCtx())
    const px = checks.find((c) => c.id === 'title-pixel-width')
    expect(px?.status).toBe('warning')
  })

  it('warns for short title', () => {
    const checks = checkTitle(makeInput({ metaTitle: 'Short' }), makeCtx())
    const lengthCheck = checks.find((c) => c.id === 'title-length')
    expect(lengthCheck?.status).toBe('warning')
  })

  it('warns for long title', () => {
    const checks = checkTitle(
      makeInput({ metaTitle: 'A'.repeat(65) }),
      makeCtx(),
    )
    const lengthCheck = checks.find((c) => c.id === 'title-length')
    expect(lengthCheck?.status).toBe('warning')
  })

  it('fails when title is missing', () => {
    const checks = checkTitle(makeInput({ metaTitle: '' }), makeCtx())
    expect(checks[0].id).toBe('title-missing')
    expect(checks[0].status).toBe('fail')
  })

  it('passes when keyword is in title', () => {
    const checks = checkTitle(makeInput(), makeCtx())
    const kwCheck = checks.find((c) => c.id === 'title-keyword')
    expect(kwCheck?.status).toBe('pass')
  })

  it('detects duplicate brand in title', () => {
    const checks = checkTitle(
      makeInput({ metaTitle: 'My Site | My Site' }),
      makeCtx(),
    )
    const dupCheck = checks.find((c) => c.id === 'title-duplicate-brand')
    expect(dupCheck?.status).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// Meta description checks
// ---------------------------------------------------------------------------

describe('checkMetaDescription', () => {
  it('passes with valid description', () => {
    const checks = checkMetaDescription(makeInput(), makeCtx())
    const lengthCheck = checks.find((c) => c.id === 'meta-desc-length')
    expect(lengthCheck?.status).toBe('pass')
  })

  it('warns for short description', () => {
    const checks = checkMetaDescription(
      makeInput({ metaDescription: 'Trop court' }),
      makeCtx(),
    )
    const lengthCheck = checks.find((c) => c.id === 'meta-desc-length')
    expect(lengthCheck?.status).toBe('warning')
  })

  it('fails when missing', () => {
    const checks = checkMetaDescription(
      makeInput({ metaDescription: '' }),
      makeCtx(),
    )
    expect(checks[0].status).toBe('fail')
  })

  it('detects action verb CTA', () => {
    const checks = checkMetaDescription(makeInput(), makeCtx())
    const ctaCheck = checks.find((c) => c.id === 'meta-desc-cta')
    expect(ctaCheck?.status).toBe('pass')
  })

  it('warns when no CTA', () => {
    const checks = checkMetaDescription(
      makeInput({
        metaDescription:
          'Our agency offers its services in Massachusetts for professional website creation and web development.',
      }),
      makeCtx(),
    )
    const ctaCheck = checks.find((c) => c.id === 'meta-desc-cta')
    expect(ctaCheck?.status).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// URL checks
// ---------------------------------------------------------------------------

describe('checkUrl', () => {
  it('passes with good slug', () => {
    const checks = checkUrl(makeInput(), makeCtx())
    const lengthCheck = checks.find((c) => c.id === 'slug-length')
    expect(lengthCheck?.status).toBe('pass')
  })

  it('warns for long slug', () => {
    const checks = checkUrl(
      makeInput({ slug: 'a'.repeat(80) }),
      makeCtx(),
    )
    const lengthCheck = checks.find((c) => c.id === 'slug-length')
    expect(lengthCheck?.status).toBe('warning')
  })

  it('fails for missing slug', () => {
    const checks = checkUrl(makeInput({ slug: '' }), makeCtx())
    expect(checks[0].status).toBe('fail')
  })

  it('auto-passes utility slugs for keyword check', () => {
    const checks = checkUrl(
      makeInput({ slug: 'contact' }),
      makeCtx({ pageType: 'contact' }),
    )
    const kwCheck = checks.find((c) => c.id === 'slug-keyword')
    expect(kwCheck?.status).toBe('pass')
  })
})

// ---------------------------------------------------------------------------
// Headings checks
// ---------------------------------------------------------------------------

describe('checkHeadings', () => {
  it('passes with single H1 and keyword', () => {
    const checks = checkHeadings(makeInput(), makeCtx())
    const h1Check = checks.find((c) => c.id === 'h1-unique')
    expect(h1Check?.status).toBe('pass')
  })

  it('fails when no H1', () => {
    const checks = checkHeadings(
      makeInput(),
      makeCtx({ allHeadings: [{ tag: 'h2', text: 'Only subtitle' }] }),
    )
    const h1Check = checks.find((c) => c.id === 'h1-missing')
    expect(h1Check?.status).toBe('fail')
  })

  it('warns for multiple H1s', () => {
    const checks = checkHeadings(
      makeInput(),
      makeCtx({
        allHeadings: [
          { tag: 'h1', text: 'First' },
          { tag: 'h1', text: 'Second' },
        ],
      }),
    )
    const h1Check = checks.find((c) => c.id === 'h1-unique')
    expect(h1Check?.status).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// Content checks
// ---------------------------------------------------------------------------

describe('checkContent', () => {
  it('passes with sufficient word count', () => {
    const checks = checkContent(makeInput(), makeCtx({ wordCount: 400 }))
    const wcCheck = checks.find((c) => c.id === 'content-wordcount')
    expect(wcCheck?.status).toBe('pass')
  })

  it('fails with very low word count', () => {
    const checks = checkContent(makeInput(), makeCtx({ wordCount: 50 }))
    const wcCheck = checks.find((c) => c.id === 'content-wordcount')
    expect(wcCheck?.status).toBe('fail')
  })

  it('warns for word count below minimum', () => {
    const checks = checkContent(makeInput(), makeCtx({ wordCount: 200 }))
    const wcCheck = checks.find((c) => c.id === 'content-wordcount')
    expect(wcCheck?.status).toBe('warning')
  })

  it('detects placeholder content', () => {
    const checks = checkContent(
      makeInput(),
      makeCtx({ fullText: 'This is lorem ipsum dolor sit amet content' }),
    )
    const phCheck = checks.find((c) => c.id === 'content-no-placeholder')
    expect(phCheck?.status).toBe('fail')
  })

  it('passes with real content', () => {
    const checks = checkContent(makeInput(), makeCtx())
    const phCheck = checks.find((c) => c.id === 'content-no-placeholder')
    expect(phCheck?.status).toBe('pass')
  })
})

// ---------------------------------------------------------------------------
// Images checks
// ---------------------------------------------------------------------------

describe('checkImages', () => {
  it('passes when all images have alt text', () => {
    const checks = checkImages(makeInput(), makeCtx())
    const altCheck = checks.find((c) => c.id === 'images-alt')
    expect(altCheck?.status).toBe('pass')
  })

  it('auto-passes for legal pages', () => {
    const checks = checkImages(
      makeInput(),
      makeCtx({ pageType: 'legal', imageStats: { total: 0, withAlt: 0, altTexts: [] } }),
    )
    const presentCheck = checks.find((c) => c.id === 'images-present')
    expect(presentCheck?.status).toBe('pass')
  })

  it('warns when no images', () => {
    const checks = checkImages(
      makeInput(),
      makeCtx({ imageStats: { total: 0, withAlt: 0, altTexts: [] } }),
    )
    const presentCheck = checks.find((c) => c.id === 'images-present')
    expect(presentCheck?.status).toBe('warning')
  })

  it('fails for low alt text ratio', () => {
    const checks = checkImages(
      makeInput(),
      makeCtx({ imageStats: { total: 10, withAlt: 2, altTexts: ['alt1', 'alt2'] } }),
    )
    const altCheck = checks.find((c) => c.id === 'images-alt')
    expect(altCheck?.status).toBe('fail')
  })
})

// ---------------------------------------------------------------------------
// Linking checks
// ---------------------------------------------------------------------------

describe('checkLinking', () => {
  it('passes with internal links', () => {
    const checks = checkLinking(makeInput(), makeCtx())
    const intCheck = checks.find((c) => c.id === 'linking-internal')
    expect(intCheck?.status).toBe('pass')
  })

  it('warns for no internal links', () => {
    const checks = checkLinking(
      makeInput(),
      makeCtx({ allLinks: [{ url: 'https://external.com', text: 'External' }] }),
    )
    const intCheck = checks.find((c) => c.id === 'linking-internal')
    expect(intCheck?.status).toBe('warning')
  })

  it('warns for generic anchors', () => {
    const checks = checkLinking(
      makeInput(),
      makeCtx({
        allLinks: [
          { url: '/page', text: 'click here' },
          { url: '/other', text: 'read more' },
        ],
      }),
    )
    const genCheck = checks.find((c) => c.id === 'linking-generic-anchors')
    expect(genCheck?.status).toBe('warning')
  })

  it('warns for empty links', () => {
    const checks = checkLinking(
      makeInput(),
      makeCtx({ allLinks: [{ url: '', text: 'empty' }, { url: '#', text: 'hash' }] }),
    )
    const emptyCheck = checks.find((c) => c.id === 'linking-empty')
    expect(emptyCheck?.status).toBe('warning')
  })
})

describe('checkLinking — competing anchors', () => {
  const run = (links: Array<{ url: string; text: string }>, input: Partial<SeoInput> = {}, ctx: Partial<AnalysisContext> = {}) =>
    checkLinking(makeInput(input), makeCtx({ allLinks: links, ...ctx })).find(
      (c) => c.id === 'linking-competing-anchors',
    )

  it('fails when another page is linked with the keyphrase as anchor', () => {
    const check = run([{ url: '/agency-services', text: 'Web agency Boston' }])
    expect(check?.status).toBe('fail')
    expect(check?.message).toContain('web agency boston')
    expect(check?.message).toContain('/agency-services')
    expect(check?.tip).toBeTruthy()
    expect(check?.group).toBe('linking')
    expect(check?.weight).toBe(2)
  })

  it('treats function words in the anchor as noise and ignores case and accents', () => {
    expect(run([{ url: '/other', text: 'The Best WEB agency in Boston' }])?.status).toBe('fail')
  })

  it('passes when the keyphrase is only part of a longer anchor', () => {
    const check = run([{ url: '/other', text: 'our web agency Boston case studies' }])
    expect(check?.status).toBe('pass')
  })

  it('ignores a link to the page itself, with a fragment or a collection route', () => {
    expect(run([{ url: '/web-agency-boston', text: 'web agency boston' }])?.status).toBe('pass')
    expect(run([{ url: '/web-agency-boston/?utm=1#team', text: 'web agency boston' }])?.status).toBe('pass')
    expect(run([{ url: '/posts/web-agency-boston', text: 'web agency boston' }])?.status).toBe('pass')
    expect(
      run([{ url: '/en/agency', text: 'web agency boston' }], { canonicalUrl: 'https://example.com/en/agency' })?.status,
    ).toBe('pass')
  })

  it('ignores a relative #fragment link', () => {
    expect(run([{ url: '#top', text: 'web agency boston' }])?.status).toBe('pass')
  })

  it('ignores an empty link (reported by linking-empty instead)', () => {
    expect(run([{ url: '', text: 'web agency boston' }], { slug: '' })?.status).not.toBe('fail')
    expect(run([{ url: '  ', text: 'web agency boston' }])?.status).not.toBe('fail')
  })

  it('ignores external links', () => {
    expect(run([{ url: 'https://example.com/boston', text: 'web agency boston' }])?.status).toBe('pass')
  })

  it('lists every competing URL once', () => {
    const check = run([
      { url: '/a', text: 'web agency boston' },
      { url: '/a', text: 'Boston web agency' },
      { url: '/b', text: 'web agency boston' },
    ])
    expect(check?.message).toContain('/a, /b')
  })

  it('does not run without a focus keyword, or for a keyphrase of function words only', () => {
    const links = [{ url: '/other', text: 'web agency boston' }]
    expect(run(links, { focusKeyword: '' }, { normalizedKeyword: '' })).toBeUndefined()
    expect(run([{ url: '/other', text: 'how to' }], {}, { normalizedKeyword: 'how to' })).toBeUndefined()
  })

  it('does not emit a check when the page has no links', () => {
    expect(run([])).toBeUndefined()
  })
})

describe('checkKeyphrase', () => {
  const run = (keyphrase: string) =>
    checkKeyphrase(makeInput({ focusKeyword: keyphrase }), makeCtx({ normalizedKeyword: keyphrase.toLowerCase() }))
  const length = (keyphrase: string) => run(keyphrase).find((c) => c.id === 'keyphrase-length')
  const fnOnly = (keyphrase: string) => run(keyphrase).find((c) => c.id === 'keyphrase-function-words-only')

  it('passes for 1 content word', () => {
    expect(length('coffee')?.status).toBe('pass')
    expect(fnOnly('coffee')?.status).toBe('pass')
  })

  it('does not count function words toward the length', () => {
    expect(length('how to make the best coffee at home')?.status).toBe('pass')
  })

  it('warns for 5 content words', () => {
    const check = length('organic fair trade coffee beans')
    expect(check?.status).toBe('warning')
    expect(check?.message).toContain('5')
    expect(check?.tip).toBeTruthy()
  })

  it('fails for 9 content words', () => {
    const check = length('organic fair trade single origin coffee beans roasted fresh')
    expect(check?.status).toBe('fail')
    expect(check?.message).toContain('9')
  })

  it('passes at 4 content words and warns up to 8', () => {
    expect(length('alpha beta gamma delta')?.status).toBe('pass')
    expect(length('alpha beta gamma delta epsilon zeta eta theta')?.status).toBe('warning')
  })

  it('counts every word of a quoted keyphrase', () => {
    const check = length('"how to make the best coffee at home now"')
    expect(check?.status).toBe('fail')
    expect(check?.message).toContain('9')
  })

  it('fails when the keyphrase has only function words', () => {
    const check = fnOnly('How to be the best')
    expect(check?.status).toBe('fail')
    expect(check?.tip).toBeTruthy()
    expect(check?.group).toBe('content')
    expect(length('How to be the best')).toBeUndefined()
  })

  it('runs only when a focus keyword is set', () => {
    expect(checkKeyphrase(makeInput({ focusKeyword: '' }), makeCtx({ normalizedKeyword: '' }))).toEqual([])
  })

  it('is part of the analysis for the focus keyword only', () => {
    const withKw = analyzeSeo(makeInput({ focusKeyword: 'coffee' }))
    expect(withKw.checks.some((c) => c.id === 'keyphrase-length')).toBe(true)
    const without = analyzeSeo(makeInput({ focusKeyword: undefined, focusKeywords: ['coffee'] }))
    expect(without.checks.some((c) => c.id === 'keyphrase-length')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Social checks
// ---------------------------------------------------------------------------

describe('checkSocial', () => {
  it('passes with OG image', () => {
    const checks = checkSocial(makeInput({ metaImage: { id: 1, url: '/img.jpg' } }), makeCtx())
    const ogCheck = checks.find((c) => c.id === 'social-og-image')
    expect(ogCheck?.status).toBe('pass')
  })

  it('warns without OG image', () => {
    const checks = checkSocial(makeInput({ metaImage: undefined }), makeCtx())
    const ogCheck = checks.find((c) => c.id === 'social-og-image')
    expect(ogCheck?.status).toBe('warning')
  })

  it('warns for long title on social', () => {
    const checks = checkSocial(
      makeInput({ metaTitle: 'A'.repeat(70) }),
      makeCtx(),
    )
    const titleCheck = checks.find((c) => c.id === 'social-title-truncation')
    expect(titleCheck?.status).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// Schema checks
// ---------------------------------------------------------------------------

describe('checkSchema (SEO 2026 — page-type aware, no more theatre)', () => {
  it('does NOT green a page missing required CMS fields', () => {
    const checks = checkSchema(
      makeInput({ metaTitle: '', metaDescription: '', heroTitle: '' }),
      makeCtx({ imageStats: { total: 0, withAlt: 0, altTexts: [] }, allHeadings: [] }),
    )
    const cov = checks.find((c) => c.id === 'schema-coverage')
    // local-seo page → LocalBusiness expected; name (from title) missing → warning, never green
    expect(cov?.status).toBe('warning')
  })

  it('reminds about non-CMS-verifiable required fields (e.g. address) when CMS fields are present', () => {
    const checks = checkSchema(makeInput({ metaImage: { id: 1 } }), makeCtx()) // local-seo → LocalBusiness
    const cov = checks.find((c) => c.id === 'schema-coverage')
    expect(cov?.status).toBe('pass')
    expect(cov?.weight).toBe(0)
    expect(cov?.message.toLowerCase()).toContain('address')
  })

  it('expects an Article schema for blog posts and passes when headline + image present', () => {
    const checks = checkSchema(
      makeInput({ isPost: true, metaImage: { id: 1 } }),
      makeCtx({ pageType: 'blog' }),
    )
    const cov = checks.find((c) => c.id === 'schema-coverage')
    expect(cov?.status).toBe('pass')
    expect(cov?.message).toContain('Article')
  })

  it('flags FAQ blocks as valid-but-no-rich-result (2026), weight 0, never suggesting removal', () => {
    const checks = checkSchema(
      makeInput({ blocks: [{ blockType: 'faq', items: [] }] }),
      makeCtx(),
    )
    const faq = checks.find((c) => c.id === 'schema-faq-no-rich-result')
    expect(faq).toBeDefined()
    expect(faq?.weight).toBe(0)
    expect(faq?.message.toLowerCase()).not.toContain('remove')
  })

  it('treats structured data as optional for legal/contact pages (informational, weight 0)', () => {
    const checks = checkSchema(makeInput(), makeCtx({ pageType: 'legal' }))
    const cov = checks.find((c) => c.id === 'schema-coverage')
    expect(cov?.status).toBe('pass')
    expect(cov?.weight).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Readability checks
// ---------------------------------------------------------------------------

describe('checkReadability', () => {
  it('skips for very short content', () => {
    const checks = checkReadability(makeInput(), makeCtx({ wordCount: 30 }))
    expect(checks).toHaveLength(0)
  })

  it('runs all checks for sufficient content', () => {
    const longText = Array(100).fill('Web development is an exciting field.').join(' ')
    const sentences = longText.split('. ').filter(Boolean)
    const checks = checkReadability(
      makeInput({ heroRichText: null, content: null, blocks: [] }),
      makeCtx({
        fullText: longText,
        wordCount: 700,
        sentences,
      }),
    )
    // Should have Flesch, long sentences, paragraphs, passive, transitions checks
    expect(checks.length).toBeGreaterThanOrEqual(4)
  })

  it('names the Flesch target when the score is below it', () => {
    const hard =
      'Notwithstanding considerable methodological heterogeneity, comprehensive organizational transformation necessitates systematic evaluation of interdependent infrastructural capabilities and multidimensional institutional accountability mechanisms.'
    const fullText = Array(6).fill(hard).join(' ')
    const checks = checkReadability(
      makeInput({ heroRichText: null, content: null, blocks: [] }),
      makeCtx({ fullText, wordCount: 120, sentences: Array(6).fill(hard) }),
    )
    const flesch = checks.find((c) => c.id === 'readability-flesch')
    expect(flesch?.status).toBe('fail')
    expect(flesch?.message).toContain(`(aim for ${FLESCH_THRESHOLDS.pass}+)`)
  })

  it('leaves the target out of a passing Flesch message', () => {
    const easy = 'We make good coffee. You can make it too. Use fresh beans and hot water.'
    const fullText = Array(12).fill(easy).join(' ')
    const checks = checkReadability(
      makeInput({ heroRichText: null, content: null, blocks: [] }),
      makeCtx({ fullText, wordCount: 180, sentences: fullText.split(/(?<=\.)\s+/) }),
    )
    const flesch = checks.find((c) => c.id === 'readability-flesch')
    expect(flesch?.status).toBe('pass')
    expect(flesch?.message).not.toContain('aim for')
  })
})

// ---------------------------------------------------------------------------
// Quality checks
// ---------------------------------------------------------------------------

describe('checkQuality', () => {
  it('passes with good content', () => {
    const checks = checkQuality(makeInput(), makeCtx())
    const dupCheck = checks.find((c) => c.id === 'quality-no-duplicate')
    const subCheck = checks.find((c) => c.id === 'quality-substantial')
    expect(dupCheck?.status).toBe('pass')
    expect(subCheck?.status).toBe('pass')
  })

  it('fails for very thin content', () => {
    const checks = checkQuality(makeInput(), makeCtx({ wordCount: 30 }))
    const subCheck = checks.find((c) => c.id === 'quality-substantial')
    expect(subCheck?.status).toBe('fail')
  })

  it('warns for light content', () => {
    const checks = checkQuality(makeInput(), makeCtx({ wordCount: 100 }))
    const subCheck = checks.find((c) => c.id === 'quality-substantial')
    expect(subCheck?.status).toBe('warning')
  })

  it('detects duplicate content', () => {
    const checks = checkQuality(
      makeInput(),
      makeCtx({ fullText: 'lorem ipsum dolor sit amet consectetur' }),
    )
    const dupCheck = checks.find((c) => c.id === 'quality-no-duplicate')
    expect(dupCheck?.status).toBe('fail')
  })

  // Regression guard for the tandem-repeat detector that replaced the
  // catastrophically backtracking `/(.{30,})\1/i` pattern. It must keep the
  // exact same semantics: a block of >= 30 characters immediately repeated.
  it('detects a tandem repeat of at least 30 characters', () => {
    const block = 'the same sentence repeated twice in a row exactly '
    const checks = checkQuality(makeInput(), makeCtx({ fullText: block + block }))
    const dupCheck = checks.find((c) => c.id === 'quality-no-duplicate')
    expect(dupCheck?.status).toBe('fail')
  })

  it('does not flag a repeated block shorter than 30 characters', () => {
    // 12 chars repeated: below the threshold the old regex used too.
    const checks = checkQuality(makeInput(), makeCtx({ fullText: 'short block short block ' }))
    const dupCheck = checks.find((c) => c.id === 'quality-no-duplicate')
    expect(dupCheck?.status).toBe('pass')
  })

  it('does not flag a repeat that is not adjacent to itself', () => {
    const block = 'a block of more than thirty clearly identifiable characters'
    const checks = checkQuality(
      makeInput(),
      makeCtx({ fullText: `${block} some text inserted here to break the adjacency ${block}` }),
    )
    const dupCheck = checks.find((c) => c.id === 'quality-no-duplicate')
    expect(dupCheck?.status).toBe('pass')
  })

  // Guards against the backreference regex coming back: on this non-matching
  // input it took ~11 600 ms, and it ran on every keystroke in the editor.
  //
  // On the bound: the linear detector needs ~8 ms here, but a single timed run
  // is not a stable measurement — over 12 runs on an idle machine the same call
  // ranged from 1.9 ms to 261 ms, because a GC pause lands wherever it lands. A
  // 100 ms assertion duly flaked. 1 s keeps a 100x margin over the real cost
  // while staying far below anything backtracking could produce, so the test
  // still fails loudly on a regression without failing on noise.
  it('analyses 20 000 characters of non-duplicate text without backtracking', () => {
    const words: string[] = []
    for (let i = 0; i < 4000; i++) words.push(`word${i}`)
    const fullText = words.join(' ').slice(0, 20_000)

    checkQuality(makeInput(), makeCtx({ fullText })) // warm-up, JIT

    const start = performance.now()
    const checks = checkQuality(makeInput(), makeCtx({ fullText }))
    const elapsed = performance.now() - start

    expect(checks.find((c) => c.id === 'quality-no-duplicate')?.status).toBe('pass')
    expect(elapsed).toBeLessThan(1_000)
  })
})

// ---------------------------------------------------------------------------
// Secondary keywords checks
// ---------------------------------------------------------------------------

describe('checkSecondaryKeywords', () => {
  it('returns nothing when no secondary keywords', () => {
    const checks = checkSecondaryKeywords(makeInput(), makeCtx())
    expect(checks).toHaveLength(0)
  })

  it('checks secondary keywords in title/desc/content/headings', () => {
    const checks = checkSecondaryKeywords(
      makeInput({ focusKeywords: ['website creation'] }),
      makeCtx({ secondaryNormalizedKeywords: ['website creation'] }),
    )
    expect(checks.length).toBe(4) // title, desc, content, heading
  })

  it('displays original accented keyword (fix 3b)', () => {
    const checks = checkSecondaryKeywords(
      makeInput({ focusKeywords: ['café menu'] }),
      makeCtx({ secondaryNormalizedKeywords: ['cafe menu'] }),
    )
    const titleCheck = checks.find((c) => c.id === 'secondary-kw-title-0')
    // Should display the original "café menu" not the normalized "cafe menu"
    expect(titleCheck?.message).toContain('café menu')
  })
})

// ---------------------------------------------------------------------------
// Cornerstone checks
// ---------------------------------------------------------------------------

describe('checkCornerstone', () => {
  it('returns nothing when not cornerstone', () => {
    const checks = checkCornerstone(makeInput(), makeCtx())
    expect(checks).toHaveLength(0)
  })

  it('runs all cornerstone checks', () => {
    const checks = checkCornerstone(
      makeInput({ isCornerstone: true }),
      makeCtx({ wordCount: 2000 }),
    )
    expect(checks.length).toBeGreaterThanOrEqual(3)
    const wcCheck = checks.find((c) => c.id === 'cornerstone-wordcount')
    expect(wcCheck?.status).toBe('pass')
  })

  it('warns for insufficient word count', () => {
    const checks = checkCornerstone(
      makeInput({ isCornerstone: true }),
      makeCtx({ wordCount: 500 }),
    )
    const wcCheck = checks.find((c) => c.id === 'cornerstone-wordcount')
    expect(wcCheck?.status).toBe('warning')
  })

  it('warns for insufficient internal links', () => {
    const checks = checkCornerstone(
      makeInput({ isCornerstone: true }),
      makeCtx({ allLinks: [{ url: '/page', text: 'Link' }] }),
    )
    const linkCheck = checks.find((c) => c.id === 'cornerstone-internal-links')
    expect(linkCheck?.status).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// Freshness checks
// ---------------------------------------------------------------------------

describe('checkFreshness', () => {
  it('passes for recently updated content', () => {
    const today = new Date().toISOString()
    const checks = checkFreshness(
      makeInput({ updatedAt: today }),
      makeCtx(),
    )
    const ageCheck = checks.find((c) => c.id === 'freshness-age')
    expect(ageCheck?.status).toBe('pass')
  })

  it('fails for very old content', () => {
    const oldDate = new Date(Date.now() - 400 * 86400000).toISOString()
    const checks = checkFreshness(
      makeInput({ updatedAt: oldDate }),
      makeCtx(),
    )
    const ageCheck = checks.find((c) => c.id === 'freshness-age')
    expect(ageCheck?.status).toBe('fail')
  })

  it('warns for moderately old content', () => {
    const date = new Date(Date.now() - 200 * 86400000).toISOString()
    const checks = checkFreshness(
      makeInput({ updatedAt: date }),
      makeCtx(),
    )
    const ageCheck = checks.find((c) => c.id === 'freshness-age')
    expect(ageCheck?.status).toBe('warning')
  })

  it('uses relaxed thresholds for evergreen pages', () => {
    const date = new Date(Date.now() - 400 * 86400000).toISOString()
    const checks = checkFreshness(
      makeInput({ slug: 'legal-notice', updatedAt: date }),
      makeCtx({ pageType: 'legal' }),
    )
    const ageCheck = checks.find((c) => c.id === 'freshness-age')
    // 400 days < 730 (evergreen threshold), so should pass
    expect(ageCheck?.status).toBe('pass')
  })

  it('detects thin aging content', () => {
    const oldDate = new Date(Date.now() - 200 * 86400000).toISOString()
    const checks = checkFreshness(
      makeInput({ updatedAt: oldDate }),
      makeCtx({ wordCount: 200 }),
    )
    const thinCheck = checks.find((c) => c.id === 'freshness-thin-aging')
    expect(thinCheck?.status).toBe('fail')
  })
})

// ---------------------------------------------------------------------------
// Technical checks (canonical, robots)
// ---------------------------------------------------------------------------

describe('checkTechnical', () => {
  it('returns nothing when no canonical/robots defined', () => {
    const checks = checkTechnical(makeInput(), makeCtx())
    expect(checks).toHaveLength(0)
  })

  it('passes for valid canonical URL', () => {
    const checks = checkTechnical(
      makeInput({ canonicalUrl: 'https://example.com/web-agency-boston' }),
      makeCtx(),
    )
    const canonCheck = checks.find((c) => c.id === 'canonical-ok')
    expect(canonCheck?.status).toBe('pass')
  })

  it('warns for empty canonical', () => {
    const checks = checkTechnical(
      makeInput({ canonicalUrl: '' }),
      makeCtx(),
    )
    const canonCheck = checks.find((c) => c.id === 'canonical-missing')
    expect(canonCheck?.status).toBe('warning')
  })

  it('warns for relative canonical URL', () => {
    const checks = checkTechnical(
      makeInput({ canonicalUrl: '/web-agency-boston' }),
      makeCtx(),
    )
    const canonCheck = checks.find((c) => c.id === 'canonical-invalid')
    expect(canonCheck?.status).toBe('warning')
  })

  it('warns for external canonical when siteUrl is set', () => {
    const checks = checkTechnical(
      makeInput({ canonicalUrl: 'https://other-site.com/page' }),
      makeCtx({ config: { siteUrl: 'https://example.com' } }),
    )
    const canonCheck = checks.find((c) => c.id === 'canonical-external')
    expect(canonCheck?.status).toBe('warning')
  })

  it('warns for a cross-canonical (page canonicalizing to a DIFFERENT on-site page)', () => {
    const checks = checkTechnical(
      // slug is 'web-agency-boston' but canonical points to another page → self de-indexing
      makeInput({ canonicalUrl: 'https://example.com/another-page' }),
      makeCtx({ config: { siteUrl: 'https://example.com' } }),
    )
    const cross = checks.find((c) => c.id === 'canonical-cross')
    expect(cross?.status).toBe('warning')
  })

  it('does NOT flag a self-referential canonical (trailing slash tolerated)', () => {
    const checks = checkTechnical(
      makeInput({ canonicalUrl: 'https://example.com/web-agency-boston/' }),
      makeCtx({ config: { siteUrl: 'https://example.com' } }),
    )
    expect(checks.find((c) => c.id === 'canonical-cross')).toBeUndefined()
    expect(checks.find((c) => c.id === 'canonical-ok')?.status).toBe('pass')
  })

  it('fails for noindex on content pages', () => {
    const checks = checkTechnical(
      makeInput({ robotsMeta: 'noindex' }),
      makeCtx({ pageType: 'local-seo' }),
    )
    const robotsCheck = checks.find((c) => c.id === 'robots-noindex')
    expect(robotsCheck?.status).toBe('fail')
  })

  it('warns for noindex on legal pages (acceptable)', () => {
    const checks = checkTechnical(
      makeInput({ robotsMeta: 'noindex' }),
      makeCtx({ pageType: 'legal' }),
    )
    const robotsCheck = checks.find((c) => c.id === 'robots-noindex')
    expect(robotsCheck?.status).toBe('warning')
  })

  it('warns for nofollow', () => {
    const checks = checkTechnical(
      makeInput({ robotsMeta: 'nofollow' }),
      makeCtx(),
    )
    const nofollowCheck = checks.find((c) => c.id === 'robots-nofollow')
    expect(nofollowCheck?.status).toBe('warning')
  })

  it('passes for index,follow', () => {
    const checks = checkTechnical(
      makeInput({ robotsMeta: 'index, follow' }),
      makeCtx(),
    )
    const robotsCheck = checks.find((c) => c.id === 'robots-ok')
    expect(robotsCheck?.status).toBe('pass')
  })
})

// ---------------------------------------------------------------------------
// C1. Keyword distribution in content
// ---------------------------------------------------------------------------

describe('C1 — keyword distribution', () => {
  const kwText = (kw: string, tiers: number[]) => {
    // Build text where keyword appears only in specified tiers (0, 1, 2)
    const filler = 'Web development is an exciting and constantly evolving field. '
    const fillerBlock = filler.repeat(10) // ~180 chars per block
    const parts = [fillerBlock, fillerBlock, fillerBlock]
    for (const t of tiers) {
      parts[t] = parts[t] + ` The ${kw} is important. `
    }
    return parts.join('')
  }

  it('passes when keyword is well distributed (2+ tiers)', () => {
    const text = kwText('web agency boston', [0, 2])
    const checks = checkContent(
      makeInput({ focusKeyword: 'web agency boston' }),
      makeCtx({ fullText: text, wordCount: 500, normalizedKeyword: 'web agency boston' }),
    )
    const distCheck = checks.find((c) => c.id === 'content-keyword-distribution')
    expect(distCheck).toBeDefined()
    expect(distCheck?.status).toBe('pass')
    expect(distCheck?.weight).toBe(0) // informational only (SEO desintox)
  })

  it('warns when keyword is in only 1 tier', () => {
    const text = kwText('web agency boston', [1])
    const checks = checkContent(
      makeInput({ focusKeyword: 'web agency boston' }),
      makeCtx({ fullText: text, wordCount: 500, normalizedKeyword: 'web agency boston' }),
    )
    const distCheck = checks.find((c) => c.id === 'content-keyword-distribution')
    expect(distCheck?.status).toBe('warning')
    expect(distCheck?.weight).toBe(0)
  })

  it('warns informationally (weight 0, not fail) when keyword is in 0 tiers', () => {
    const text = kwText('web agency boston', [])
    const checks = checkContent(
      makeInput({ focusKeyword: 'web agency boston' }),
      makeCtx({ fullText: text, wordCount: 500, normalizedKeyword: 'web agency boston' }),
    )
    const distCheck = checks.find((c) => c.id === 'content-keyword-distribution')
    // SEO desintox: keyword distribution is a disguised density metric — no longer
    // a scored 'fail', just a neutral hint.
    expect(distCheck?.status).toBe('warning')
    expect(distCheck?.weight).toBe(0)
  })

  it('skips distribution check for short content (<100 words)', () => {
    const checks = checkContent(
      makeInput({ focusKeyword: 'web agency' }),
      makeCtx({ wordCount: 50, normalizedKeyword: 'web agency' }),
    )
    const distCheck = checks.find((c) => c.id === 'content-keyword-distribution')
    expect(distCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SEO desintox (2026) — keyword density is anti-stuffing ONLY (no floor penalty)
// ---------------------------------------------------------------------------

describe('SEO desintox — keyword density (anti-stuffing only)', () => {
  it('flags over-stuffing (>3%) as a scored failure (weight 3)', () => {
    // "seo" appears 8 times in 96 words ≈ 8.3% density
    const fullText = ('mot '.repeat(11) + 'seo ').repeat(8).trim()
    const checks = checkContent(
      makeInput({ focusKeyword: 'seo' }),
      makeCtx({ fullText, wordCount: 96, normalizedKeyword: 'seo' }),
    )
    const d = checks.find((c) => c.id === 'content-keyword-density')
    expect(d?.status).toBe('fail')
    expect(d?.weight).toBe(3)
  })

  it('does NOT penalise low density — informational pass, weight 0 (no 0.5% floor)', () => {
    // "seo" appears once in 200 words = 0.5% — previously a warning/fail, now neutral
    const fullText = 'mot '.repeat(199) + 'seo'
    const checks = checkContent(
      makeInput({ focusKeyword: 'seo' }),
      makeCtx({ fullText, wordCount: 200, normalizedKeyword: 'seo' }),
    )
    const d = checks.find((c) => c.id === 'content-keyword-density')
    expect(d?.status).toBe('pass')
    expect(d?.weight).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SEO desintox (2026) — Yoast-style readability heuristics are informational
// ---------------------------------------------------------------------------

describe('SEO desintox — readability heuristics are not scored', () => {
  it('passive voice and transition words have weight 0', () => {
    const checks = checkReadability(makeInput(), makeCtx())
    const passive = checks.find((c) => c.id === 'readability-passive')
    const transitions = checks.find((c) => c.id === 'readability-transitions')
    expect(passive?.weight).toBe(0)
    expect(transitions?.weight).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// C2. Power words in title
// ---------------------------------------------------------------------------

describe('C2 — power words in title', () => {
  it('passes when title contains a power word', () => {
    const checks = checkTitle(
      makeInput({ metaTitle: 'Complete guide to web agencies in Boston' }),
      makeCtx(),
    )
    const pwCheck = checks.find((c) => c.id === 'title-power-words')
    expect(pwCheck).toBeDefined()
    expect(pwCheck?.status).toBe('pass')
    expect(pwCheck?.message).toContain('guide')
  })

  it('warns when title has no power word', () => {
    const checks = checkTitle(
      makeInput({ metaTitle: 'Web Agency in Boston Massachusetts' }),
      makeCtx(),
    )
    const pwCheck = checks.find((c) => c.id === 'title-power-words')
    expect(pwCheck?.status).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// C3. Lists in content
// ---------------------------------------------------------------------------

describe('C3 — lists in content', () => {
  const lexicalWithList = {
    root: {
      children: [
        { type: 'list', tag: 'ul', listType: 'bullet', children: [
          { type: 'listitem', children: [{ type: 'text', text: 'Item 1' }] },
          { type: 'listitem', children: [{ type: 'text', text: 'Item 2' }] },
        ] },
      ],
    },
  }

  const lexicalWithoutList = {
    root: {
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Simple paragraph' }] },
      ],
    },
  }

  it('passes when content has lists (>500 words)', () => {
    const checks = checkContent(
      makeInput({ content: lexicalWithList }),
      makeCtx({ wordCount: 600 }),
    )
    const listCheck = checks.find((c) => c.id === 'content-has-lists')
    expect(listCheck).toBeDefined()
    expect(listCheck?.status).toBe('pass')
  })

  it('warns when no lists in long content', () => {
    const checks = checkContent(
      makeInput({ heroRichText: null, content: lexicalWithoutList, blocks: [] }),
      makeCtx({ wordCount: 600 }),
    )
    const listCheck = checks.find((c) => c.id === 'content-has-lists')
    expect(listCheck?.status).toBe('warning')
  })

  it('skips lists check for short content (<=500 words)', () => {
    const checks = checkContent(
      makeInput({ content: lexicalWithoutList }),
      makeCtx({ wordCount: 300 }),
    )
    const listCheck = checks.find((c) => c.id === 'content-has-lists')
    expect(listCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// C4. H1 vs meta title
// ---------------------------------------------------------------------------

describe('C4 — H1 vs meta title different', () => {
  it('passes when H1 and meta title are different', () => {
    const checks = checkHeadings(
      makeInput({ metaTitle: 'Web Agency in Boston | My Site' }),
      makeCtx({
        allHeadings: [{ tag: 'h1', text: 'Your trusted web agency in Boston' }],
      }),
    )
    const h1TitleCheck = checks.find((c) => c.id === 'h1-title-different')
    expect(h1TitleCheck).toBeDefined()
    expect(h1TitleCheck?.status).toBe('pass')
  })

  it('warns when H1 and meta title are identical', () => {
    const checks = checkHeadings(
      makeInput({ metaTitle: 'Web Agency in Boston' }),
      makeCtx({
        allHeadings: [{ tag: 'h1', text: 'Web Agency in Boston' }],
      }),
    )
    const h1TitleCheck = checks.find((c) => c.id === 'h1-title-different')
    expect(h1TitleCheck?.status).toBe('warning')
  })

  it('skips when no meta title', () => {
    const checks = checkHeadings(
      makeInput({ metaTitle: '' }),
      makeCtx({
        allHeadings: [{ tag: 'h1', text: 'Web Agency in Boston' }],
      }),
    )
    const h1TitleCheck = checks.find((c) => c.id === 'h1-title-different')
    // H1-title check only runs when metaTitle is set (title-missing fires instead)
    expect(h1TitleCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Tips on checks (D3)
// ---------------------------------------------------------------------------

describe('Tips on checks', () => {
  it('includes tip on fail checks', () => {
    const checks = checkTitle(makeInput({ metaTitle: '' }), makeCtx())
    const failCheck = checks.find((c) => c.id === 'title-missing')
    expect(failCheck?.status).toBe('fail')
    expect(failCheck?.tip).toBeDefined()
    expect(failCheck!.tip!.length).toBeGreaterThan(10)
  })

  it('includes tip on warning checks', () => {
    const checks = checkContent(
      makeInput({ focusKeyword: 'web agency boston' }),
      makeCtx({ wordCount: 200, normalizedKeyword: 'web agency boston' }),
    )
    const wcCheck = checks.find((c) => c.id === 'content-wordcount')
    expect(wcCheck?.status).toBe('warning')
    expect(wcCheck?.tip).toBeDefined()
  })

  it('does not include tip on pass checks', () => {
    const checks = checkTitle(makeInput(), makeCtx())
    const passCheck = checks.find((c) => c.id === 'title-length')
    expect(passCheck?.status).toBe('pass')
    expect(passCheck?.tip).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// analyzeSeo() — disabledRules & overrideWeights (B2-B3)
// ---------------------------------------------------------------------------

describe('analyzeSeo — disabledRules', () => {
  it('excludes all checks from a disabled rule group', () => {
    const result = analyzeSeo(makeInput(), {
      disabledRules: ['title'],
    })
    const titleChecks = result.checks.filter((c) => c.group === 'title')
    expect(titleChecks).toHaveLength(0)
    // Other groups should still be present
    const urlChecks = result.checks.filter((c) => c.group === 'url')
    expect(urlChecks.length).toBeGreaterThan(0)
  })

  it('can disable multiple rule groups', () => {
    const result = analyzeSeo(makeInput(), {
      disabledRules: ['title', 'meta-description', 'social'],
    })
    const titleChecks = result.checks.filter((c) => c.group === 'title')
    const metaChecks = result.checks.filter((c) => c.group === 'meta-description')
    const socialChecks = result.checks.filter((c) => c.group === 'social')
    expect(titleChecks).toHaveLength(0)
    expect(metaChecks).toHaveLength(0)
    expect(socialChecks).toHaveLength(0)
  })
})

describe('analyzeSeo — overrideWeights', () => {
  it('overrides weight for all checks in a group', () => {
    const result = analyzeSeo(makeInput(), {
      overrideWeights: { title: 10 },
    })
    const titleChecks = result.checks.filter((c) => c.group === 'title')
    expect(titleChecks.length).toBeGreaterThan(0)
    for (const check of titleChecks) {
      expect(check.weight).toBe(10)
    }
  })

  it('does not affect other groups', () => {
    const resultWith = analyzeSeo(makeInput(), {
      overrideWeights: { title: 0 },
    })
    const resultWithout = analyzeSeo(makeInput())

    // URL checks should have same weights in both
    const urlWith = resultWith.checks.filter((c) => c.group === 'url')
    const urlWithout = resultWithout.checks.filter((c) => c.group === 'url')
    expect(urlWith.length).toBe(urlWithout.length)
    for (let i = 0; i < urlWith.length; i++) {
      expect(urlWith[i].weight).toBe(urlWithout[i].weight)
    }
  })
})

// ---------------------------------------------------------------------------
// P1 — E-E-A-T (transparency signals, non-scoring / weight 0)
// ---------------------------------------------------------------------------

describe('checkEeat (E-E-A-T transparency signals)', () => {
  it('passes the author check when an author is attributed; all checks weight 0', () => {
    const checks = checkEeat(makeInput({ author: 'Jane Doe' }), makeCtx())
    expect(checks.find((c) => c.id === 'eeat-author')?.status).toBe('pass')
    expect(checks.every((c) => c.weight === 0)).toBe(true)
  })

  it('warns when no author is attributed', () => {
    const checks = checkEeat(makeInput({ author: '' }), makeCtx())
    expect(checks.find((c) => c.id === 'eeat-author')?.status).toBe('warning')
  })

  it('detects cited external sources from content links', () => {
    const checks = checkEeat(makeInput({ author: 'X' }), makeCtx())
    expect(checks.find((c) => c.id === 'eeat-sources')?.status).toBe('pass')
  })

  it('does not run on legal/contact pages', () => {
    expect(checkEeat(makeInput({ author: 'X' }), makeCtx({ pageType: 'legal' }))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// P1 — GEO / AI extractability (directional, weight 0)
// ---------------------------------------------------------------------------

describe('checkGeo (GEO — AI extractability)', () => {
  it('produces only weight-0 checks (directional, never moves the SEO score)', () => {
    const checks = checkGeo(makeInput(), makeCtx())
    expect(checks.length).toBeGreaterThan(0)
    expect(checks.every((c) => c.weight === 0)).toBe(true)
  })

  it('detects question-style headings', () => {
    const checks = checkGeo(
      makeInput(),
      makeCtx({ allHeadings: [{ tag: 'h2', text: 'How do I optimize SEO?' }] }),
    )
    expect(checks.find((c) => c.id === 'geo-question-headings')?.status).toBe('pass')
  })

  it('skips when content is too short', () => {
    expect(checkGeo(makeInput(), makeCtx({ wordCount: 100 }))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// P1 — Freshness: fake-refresh detection
// ---------------------------------------------------------------------------

describe('checkFreshness — fake refresh', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

  it('warns (weight 0) when the displayed date is much newer than the real update', () => {
    const checks = checkFreshness(
      makeInput({ displayedDate: daysAgo(5), updatedAt: daysAgo(400) }),
      makeCtx(),
    )
    const fake = checks.find((c) => c.id === 'freshness-fake-refresh')
    expect(fake?.status).toBe('warning')
    expect(fake?.weight).toBe(0)
  })

  it('does not flag a normal page (recent update, older publish date)', () => {
    const checks = checkFreshness(
      makeInput({ displayedDate: daysAgo(400), updatedAt: daysAgo(5) }),
      makeCtx(),
    )
    expect(checks.find((c) => c.id === 'freshness-fake-refresh')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// P1 — hreflang (multi-locale; silent on mono-locale)
// ---------------------------------------------------------------------------

describe('checkHreflang', () => {
  it('stays silent on mono-locale pages (no alternates)', () => {
    expect(checkHreflang(makeInput(), makeCtx())).toHaveLength(0)
  })

  it('passes a well-formed alternate set with x-default', () => {
    const checks = checkHreflang(
      makeInput({
        localeAlternates: [
          { hreflang: 'fr-FR', href: 'https://example.com/fr/page' },
          { hreflang: 'en-US', href: 'https://example.com/en/page' },
          { hreflang: 'x-default', href: 'https://example.com/page' },
        ],
      }),
      makeCtx(),
    )
    expect(checks.find((c) => c.id === 'hreflang-codes')?.status).toBe('pass')
    expect(checks.find((c) => c.id === 'hreflang-x-default')?.status).toBe('pass')
  })

  it('fails on an invalid hreflang code', () => {
    const checks = checkHreflang(
      makeInput({
        localeAlternates: [{ hreflang: 'english', href: 'https://example.com/en' }],
      }),
      makeCtx(),
    )
    expect(checks.find((c) => c.id === 'hreflang-codes')?.status).toBe('fail')
  })

  it('warns when x-default is missing', () => {
    const checks = checkHreflang(
      makeInput({
        localeAlternates: [{ hreflang: 'de', href: 'https://example.com/de' }],
      }),
      makeCtx(),
    )
    expect(checks.find((c) => c.id === 'hreflang-x-default')?.status).toBe('warning')
  })
})
