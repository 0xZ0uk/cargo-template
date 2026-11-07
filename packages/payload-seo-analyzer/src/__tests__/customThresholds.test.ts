import { describe, expect, it, vi } from 'vitest'
import { analyzeSeo } from '../index'
import type { SeoCheck, SeoConfig, SeoInput, SeoThresholds } from '../types'
import { calculateFlesch } from '../helpers'
import { resolveThresholds, mergeThresholds } from '../helpers/thresholds'
import { loadMergedConfig } from '../helpers/loadMergedConfig'
import {
  FLESCH_SCORE_PASS,
  FLESCH_SCORE_WARN,
  KEYWORD_DENSITY_MAX,
  KEYWORD_DENSITY_WARN,
  META_DESC_LENGTH_MAX,
  META_DESC_LENGTH_MIN,
  MIN_WORDS_GENERIC,
  MIN_WORDS_POST,
  SLUG_MAX_LENGTH,
  TITLE_LENGTH_MAX,
  TITLE_LENGTH_MIN,
} from '../constants'

const paragraphs = (...texts: string[]) => ({
  root: {
    type: 'root',
    children: texts.map((text) => ({ type: 'paragraph', children: [{ type: 'text', text }] })),
  },
})

const run = (input: SeoInput, thresholds?: SeoThresholds): SeoCheck[] =>
  analyzeSeo(input, thresholds ? { thresholds } : undefined).checks

const find = (checks: SeoCheck[], id: string) => checks.find((c) => c.id === id)

/** `n` characters of letters, for lengths that must hit a boundary exactly. */
const chars = (n: number) => 'a'.repeat(n)

describe('resolveThresholds', () => {
  it('returns the constants when nothing is set', () => {
    const t = resolveThresholds()
    expect(t).toMatchObject({
      titleLengthMin: TITLE_LENGTH_MIN,
      titleLengthMax: TITLE_LENGTH_MAX,
      metaDescLengthMin: META_DESC_LENGTH_MIN,
      metaDescLengthMax: META_DESC_LENGTH_MAX,
      minWordsGeneric: MIN_WORDS_GENERIC,
      minWordsPost: MIN_WORDS_POST,
      keywordDensityMax: KEYWORD_DENSITY_MAX,
      keywordDensityWarn: KEYWORD_DENSITY_WARN,
      fleschScorePass: FLESCH_SCORE_PASS,
      fleschScoreWarn: FLESCH_SCORE_WARN,
      slugMaxLength: SLUG_MAX_LENGTH,
    })
    expect(resolveThresholds({})).toEqual(t)
  })

  it('ignores null and non-finite values (an emptied settings field)', () => {
    const t = resolveThresholds({ titleLengthMax: null, slugMaxLength: NaN } as unknown as SeoThresholds)
    expect(t.titleLengthMax).toBe(TITLE_LENGTH_MAX)
    expect(t.slugMaxLength).toBe(SLUG_MAX_LENGTH)
  })

  it('keeps the warn boundaries in proportion to the setting they belong to', () => {
    expect(resolveThresholds({ fleschScorePass: 90 }).fleschScoreWarn).toBe(60)
    expect(resolveThresholds({ keywordDensityMax: 6 }).keywordDensityWarn).toBe(5)
  })
})

describe('mergeThresholds', () => {
  it('layers saved numbers over the plugin option and skips nulls', () => {
    expect(mergeThresholds({ titleLengthMin: 10, slugMaxLength: 50 }, { titleLengthMin: 20, slugMaxLength: null })).toEqual({
      titleLengthMin: 20,
      slugMaxLength: 50,
    })
  })

  it('returns the plugin option untouched when nothing is saved', () => {
    const base = { titleLengthMin: 10 }
    expect(mergeThresholds(base, null)).toBe(base)
    expect(mergeThresholds(base, { titleLengthMin: null })).toBe(base)
    expect(mergeThresholds(undefined, {})).toBeUndefined()
  })
})

describe('title length', () => {
  const at = (n: number) => ({ metaTitle: chars(n), slug: 's', focusKeyword: '' })

  it('defaults are unchanged', () => {
    expect(find(run(at(TITLE_LENGTH_MIN - 1)), 'title-length')?.status).toBe('warning')
    expect(find(run(at(TITLE_LENGTH_MIN)), 'title-length')?.status).toBe('pass')
    expect(find(run(at(TITLE_LENGTH_MAX)), 'title-length')?.status).toBe('pass')
    expect(find(run(at(TITLE_LENGTH_MAX + 1)), 'title-length')?.status).toBe('warning')
  })

  it('a custom minimum moves the short boundary and the message quotes it', () => {
    const check = find(run(at(40), { titleLengthMin: 45 }), 'title-length')
    expect(check?.status).toBe('warning')
    expect(check?.message).toContain('45 to 60')
    expect(check?.tip).toContain('45')
    expect(find(run(at(20), { titleLengthMin: 10 }), 'title-length')?.status).toBe('pass')
  })

  it('a custom maximum moves the long boundary and the message quotes it', () => {
    const check = find(run(at(50), { titleLengthMax: 45 }), 'title-length')
    expect(check?.status).toBe('warning')
    expect(check?.message).toContain('45 max')
    expect(check?.tip).toContain('45')
    expect(find(run(at(70), { titleLengthMax: 80 }), 'title-length')?.status).toBe('pass')
  })

  it('the missing-title tip quotes the range', () => {
    const tip = find(run({ metaTitle: '', slug: 's' }, { titleLengthMin: 20, titleLengthMax: 70 }), 'title-missing')?.tip
    expect(tip).toContain('20-70')
  })
})

describe('meta description length', () => {
  const at = (n: number) => ({ metaDescription: chars(n), slug: 's', focusKeyword: '' })

  it('defaults are unchanged', () => {
    expect(find(run(at(META_DESC_LENGTH_MIN - 1)), 'meta-desc-length')?.status).toBe('warning')
    expect(find(run(at(META_DESC_LENGTH_MIN)), 'meta-desc-length')?.status).toBe('pass')
    expect(find(run(at(META_DESC_LENGTH_MAX)), 'meta-desc-length')?.status).toBe('pass')
    expect(find(run(at(META_DESC_LENGTH_MAX + 1)), 'meta-desc-length')?.status).toBe('warning')
  })

  it('a custom minimum moves the short boundary and the message quotes it', () => {
    const check = find(run(at(130), { metaDescLengthMin: 140 }), 'meta-desc-length')
    expect(check?.status).toBe('warning')
    expect(check?.message).toContain('140 to 160')
    expect(check?.tip).toBeDefined()
    expect(find(run(at(100), { metaDescLengthMin: 80 }), 'meta-desc-length')?.status).toBe('pass')
  })

  it('a custom maximum moves the long boundary and the message quotes it', () => {
    const check = find(run(at(150), { metaDescLengthMax: 140 }), 'meta-desc-length')
    expect(check?.status).toBe('warning')
    expect(check?.message).toContain('140 max')
    expect(check?.tip).toContain('140')
    expect(find(run(at(170), { metaDescLengthMax: 200 }), 'meta-desc-length')?.status).toBe('pass')
  })

  it('the missing-description tip quotes the range', () => {
    const tip = find(
      run({ metaDescription: '', slug: 's' }, { metaDescLengthMin: 100, metaDescLengthMax: 180 }),
      'meta-desc-missing',
    )?.tip
    expect(tip).toContain('100-180')
  })

  it('the pillar-content check follows the same range', () => {
    const input = { ...at(130), isCornerstone: true }
    expect(find(run(input), 'cornerstone-meta-description')?.status).toBe('pass')
    const custom = find(run(input, { metaDescLengthMin: 140 }), 'cornerstone-meta-description')
    expect(custom?.status).toBe('warning')
    expect(custom?.message).toContain('140 to 160')
  })
})

describe('slug max length', () => {
  const at = (n: number) => ({ slug: chars(n), focusKeyword: '' })

  it('default is unchanged', () => {
    expect(find(run(at(SLUG_MAX_LENGTH)), 'slug-length')?.status).toBe('pass')
    expect(find(run(at(SLUG_MAX_LENGTH + 1)), 'slug-length')?.status).toBe('warning')
  })

  it('a custom maximum moves the boundary and the message quotes it', () => {
    const check = find(run(at(40), { slugMaxLength: 30 }), 'slug-length')
    expect(check?.status).toBe('warning')
    expect(check?.message).toContain('under 30 characters')
    expect(find(run(at(90), { slugMaxLength: 100 }), 'slug-length')?.status).toBe('pass')
  })
})

describe('minimum word count', () => {
  const words = (n: number) => paragraphs(Array.from({ length: n }, (_, i) => `word${i}`).join(' '))
  const page = (n: number): SeoInput => ({ slug: 's', focusKeyword: '', content: words(n) })
  const post = (n: number): SeoInput => ({ ...page(n), isPost: true })

  it('defaults are unchanged', () => {
    expect(find(run(page(MIN_WORDS_GENERIC - 1)), 'content-wordcount')?.status).toBe('warning')
    expect(find(run(page(MIN_WORDS_GENERIC)), 'content-wordcount')?.status).toBe('pass')
    expect(find(run(post(MIN_WORDS_POST - 1)), 'content-wordcount')?.status).toBe('warning')
    expect(find(run(post(MIN_WORDS_POST)), 'content-wordcount')?.status).toBe('pass')
  })

  it('a custom page minimum moves the boundary and the message quotes it', () => {
    const raised = find(run(page(400), { minWordsGeneric: 500 }), 'content-wordcount')
    expect(raised?.status).toBe('warning')
    expect(raised?.message).toContain('500 words (page)')
    expect(find(run(page(250), { minWordsGeneric: 200 }), 'content-wordcount')?.status).toBe('pass')
  })

  it('a custom post minimum moves the boundary and the message quotes it', () => {
    const raised = find(run(post(850), { minWordsPost: 1000 }), 'content-wordcount')
    expect(raised?.status).toBe('warning')
    expect(raised?.message).toContain('1000 words (article)')
    expect(find(run(post(600), { minWordsPost: 500 }), 'content-wordcount')?.status).toBe('pass')
  })

  it('the page setting does not move the post boundary, nor the reverse', () => {
    expect(find(run(post(400), { minWordsGeneric: 100 }), 'content-wordcount')?.status).toBe('warning')
    expect(find(run(page(400), { minWordsPost: 100 }), 'content-wordcount')?.status).toBe('pass')
  })

  it('a minimum below the hard-fail floor lowers the floor with it', () => {
    expect(find(run(page(60)), 'content-wordcount')?.status).toBe('fail')
    expect(find(run(page(60), { minWordsGeneric: 50 }), 'content-wordcount')?.status).toBe('pass')
  })
})

describe('keyword density max', () => {
  // `seo` n times in 100 words → n% density
  const density = (n: number): SeoInput => ({
    slug: 's',
    focusKeyword: 'seo',
    content: paragraphs([...Array<string>(n).fill('seo'), ...Array.from({ length: 100 - n }, (_, i) => `w${i}`)].join(' ')),
  })

  it('defaults are unchanged', () => {
    expect(find(run(density(2)), 'content-keyword-density')?.status).toBe('pass')
    expect(find(run(density(3)), 'content-keyword-density')?.status).toBe('warning')
    expect(find(run(density(4)), 'content-keyword-density')?.status).toBe('fail')
  })

  it('a lower maximum fails what used to warn, and the message quotes it', () => {
    const check = find(run(density(3), { keywordDensityMax: 2 }), 'content-keyword-density')
    expect(check?.status).toBe('fail')
    expect(check?.message).toContain('>2%')
  })

  it('a higher maximum lets denser text through, with the warn band moving along', () => {
    // warn line = 6 × 2.5/3 = 5
    expect(find(run(density(5), { keywordDensityMax: 6 }), 'content-keyword-density')?.status).toBe('pass')
    expect(find(run(density(6), { keywordDensityMax: 6 }), 'content-keyword-density')?.status).toBe('warning')
    expect(find(run(density(7), { keywordDensityMax: 6 }), 'content-keyword-density')?.status).toBe('fail')
  })

  it('keywordDensityMin changes nothing (the density floor is deprecated)', () => {
    const low = density(1)
    expect(find(run(low, { keywordDensityMin: 5 }), 'content-keyword-density')).toEqual(
      find(run(low), 'content-keyword-density'),
    )
  })
})

describe('min Flesch score', () => {
  const text = Array(12).fill('We make good coffee. You can make it too. Use fresh beans and hot water.').join(' ')
  const input: SeoInput = { slug: 's', focusKeyword: '', content: paragraphs(text) }
  const score = Math.round(calculateFlesch(text))

  it('the fixture is readable by default', () => {
    expect(score).toBeGreaterThanOrEqual(FLESCH_SCORE_PASS)
    expect(find(run(input), 'readability-flesch')?.status).toBe('pass')
  })

  it('a higher minimum turns the same page into a warning, then a failure', () => {
    const warn = find(run(input, { fleschScorePass: score + 10 }), 'readability-flesch')
    expect(warn?.status).toBe('warning')
    expect(warn?.message).toContain(`aim for ${score + 10}+`)

    const high = Math.ceil(score * 1.5) + 5
    const fail = find(run(input, { fleschScorePass: high }), 'readability-flesch')
    expect(fail?.status).toBe('fail')
    expect(fail?.message).toContain(`aim for ${high}+`)
  })

  it('a lower minimum passes what used to fail', () => {
    const hard =
      'Notwithstanding considerable methodological heterogeneity, comprehensive organizational transformation necessitates systematic evaluation of interdependent infrastructural capabilities and multidimensional institutional accountability mechanisms.'
    const hardText = Array(6).fill(hard).join(' ')
    const hardInput: SeoInput = { slug: 's', focusKeyword: '', content: paragraphs(hardText) }
    expect(find(run(hardInput), 'readability-flesch')?.status).toBe('fail')
    expect(find(run(hardInput, { fleschScorePass: -200 }), 'readability-flesch')?.status).toBe('pass')
  })
})

describe('config plumbing', () => {
  it('loadMergedConfig layers the saved thresholds over the plugin option', async () => {
    const payload = {
      find: vi.fn(async () => ({
        docs: [{ thresholds: { titleLengthMin: 20, slugMaxLength: null, fleschScorePass: 95 } }],
      })),
    }
    const plugin: SeoConfig = { thresholds: { titleLengthMin: 10, slugMaxLength: 50 } }
    const { config } = await loadMergedConfig(payload, plugin)
    expect(config.thresholds).toEqual({ titleLengthMin: 20, slugMaxLength: 50, fleschScorePass: 95 })
    // and the merged config reaches the rules
    const check = find(
      analyzeSeo({ metaTitle: chars(15), slug: 's' }, config).checks,
      'title-length',
    )
    expect(check?.status).toBe('warning')
  })
})
