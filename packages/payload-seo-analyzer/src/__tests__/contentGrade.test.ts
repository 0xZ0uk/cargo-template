import { describe, it, expect } from 'vitest'
import {
  computeQueryCoverage,
  weightedAveragePosition,
  matchPageRows,
  gradeContentCoverage,
  type GscQueryRow,
} from '../endpoints/contentGrade.js'
import { normalizeForComparison } from '../helpers.js'
import type { GscRow } from '../helpers/gscClient.js'

// Shorthand: build a GscRow (dimensions ['page','query']).
const row = (page: string, query: string, p: Partial<GscRow> = {}): GscRow => ({
  keys: [page, query],
  clicks: p.clicks ?? 0,
  impressions: p.impressions ?? 0,
  ctr: p.ctr ?? 0,
  position: p.position ?? 0,
})

// Shorthand: build a query-level row.
const qrow = (query: string, p: Partial<GscQueryRow> = {}): GscQueryRow => ({
  query,
  clicks: p.clicks ?? 0,
  impressions: p.impressions ?? 0,
  ctr: p.ctr ?? 0,
  position: p.position ?? 0,
})

describe('computeQueryCoverage', () => {
  const content = normalizeForComparison(
    'Café owner in Zürich. Installation and repair of espresso machines.',
  )

  it('returns full coverage when all significant terms are present (accent-insensitive)', () => {
    const cov = computeQueryCoverage('cafe Zurich', content)
    expect(cov.coverage).toBe(1)
    expect(cov.missingTerms).toEqual([])
    expect(cov.presentTerms).toEqual(['cafe', 'zurich'])
  })

  it('matches accented query terms against accent-stripped content', () => {
    // "café zürich" → "cafe zurich" is present in the normalized content
    const cov = computeQueryCoverage('café zürich', content)
    expect(cov.coverage).toBe(1)
  })

  it('reports missing terms and a partial coverage ratio', () => {
    const cov = computeQueryCoverage('repair coffee beans', content)
    expect(cov.terms).toEqual(['repair', 'coffee', 'beans'])
    expect(cov.presentTerms).toEqual(['repair'])
    expect(cov.missingTerms).toEqual(['coffee', 'beans'])
    expect(cov.coverage).toBeCloseTo(1 / 3, 5)
  })

  it('treats a stopword-only / too-short query as fully covered (no significant terms)', () => {
    const cov = computeQueryCoverage('the of and', content)
    expect(cov.terms).toEqual([])
    expect(cov.coverage).toBe(1)
  })
})

describe('weightedAveragePosition', () => {
  it('weights position by impressions', () => {
    expect(
      weightedAveragePosition([
        { impressions: 100, position: 2 },
        { impressions: 300, position: 6 },
      ]),
    ).toBe(5) // (100*2 + 300*6) / 400 = 5
  })

  it('ignores rows without impressions and returns 0 when none', () => {
    expect(weightedAveragePosition([{ impressions: 0, position: 3 }])).toBe(0)
    expect(weightedAveragePosition([])).toBe(0)
  })
})

describe('matchPageRows', () => {
  const rows: GscRow[] = [
    row('https://x.com/services/plumbing', 'plumber', { impressions: 50, clicks: 5, position: 3 }),
    row('https://x.com/services/plumbing', 'plumber lyon', { impressions: 30, clicks: 2, position: 5 }),
    row('https://x.com/contact', 'contact', { impressions: 10, clicks: 1, position: 8 }),
    row('https://x.com/', 'homepage', { impressions: 20, clicks: 3, position: 4 }),
  ]

  it('matches a page by its last path segment slug (accent-insensitive)', () => {
    const { matchedUrl, queryRows } = matchPageRows(rows, { slug: 'plumbing' })
    expect(matchedUrl).toBe('https://x.com/services/plumbing')
    expect(queryRows.map((r) => r.query).sort()).toEqual(['plumber', 'plumber lyon'])
  })

  it('maps the home slug to the root path', () => {
    const { matchedUrl, queryRows } = matchPageRows(rows, { slug: 'home' })
    expect(matchedUrl).toBe('https://x.com/')
    expect(queryRows).toHaveLength(1)
    expect(queryRows[0]!.query).toBe('homepage')
  })

  it('honours an explicit url (trailing-slash tolerant)', () => {
    const { matchedUrl } = matchPageRows(rows, { explicitUrl: 'https://x.com/contact/' })
    expect(matchedUrl).toBe('https://x.com/contact')
  })

  it('returns no match when nothing resolves', () => {
    expect(matchPageRows(rows, { slug: 'nonexistent' })).toEqual({ matchedUrl: null, queryRows: [] })
    expect(matchPageRows([], { slug: 'plumbing' })).toEqual({ matchedUrl: null, queryRows: [] })
  })

  it('picks the highest-impression candidate when several pages share a slug', () => {
    const variants: GscRow[] = [
      row('https://x.com/us/about', 'about us', { impressions: 100 }),
      row('https://x.com/uk/about', 'about', { impressions: 20 }),
    ]
    const { matchedUrl } = matchPageRows(variants, { slug: 'about' })
    expect(matchedUrl).toBe('https://x.com/us/about')
  })
})

describe('gradeContentCoverage', () => {
  it('returns an F / zero result with a clear message when there is no data', () => {
    const res = gradeContentCoverage('whatever content', [])
    expect(res.grade).toBe('F')
    expect(res.score).toBe(0)
    expect(res.queryCount).toBe(0)
    expect(res.recommendations[0]).toMatch(/Not enough Search Console data/)
  })

  it('grades A when content fully covers queries that already convert at the curve', () => {
    const res = gradeContentCoverage('Plumber in Lyon.', [
      qrow('plumber lyon', { impressions: 500, clicks: 140, ctr: 0.28, position: 1 }),
    ])
    expect(res.components.coverage).toBe(100)
    expect(res.components.ctr).toBe(100) // 140 clicks == expected at position 1
    expect(res.components.position).toBe(100)
    expect(res.score).toBe(100)
    expect(res.grade).toBe('A')
    expect(res.coverageGaps).toHaveLength(0)
    expect(res.ctrGaps).toHaveLength(0)
  })

  it('detects coverage gaps and CTR gaps from real query rows', () => {
    const rows: GscQueryRow[] = [
      // fully covered, clicks at curve → no gap
      qrow('plumber lyon', { impressions: 300, clicks: 30, ctr: 0.1, position: 3 }),
      // terms absent from content + under-performing CTR + near-top position
      qrow('boiler quote service', { impressions: 200, clicks: 2, ctr: 0.01, position: 5 }),
    ]
    const res = gradeContentCoverage('Plumber in Lyon.', rows)

    // weighted position = (300*3 + 200*5) / 500 = 3.8
    expect(res.weightedPosition).toBe(3.8)
    expect(res.totalImpressions).toBe(500)

    // coverage gap on the uncovered, near-top query
    expect(res.coverageGaps).toHaveLength(1)
    const gap = res.coverageGaps[0]!
    expect(gap.query).toBe('boiler quote service')
    expect(gap.coverage).toBe(0)
    expect(gap.nearTop).toBe(true)
    expect(gap.missingTerms).toEqual(['boiler', 'quote', 'service'])

    // CTR gap: position 5 → expected ~0.055, actual 0.01 → ~9 potential clicks
    expect(res.ctrGaps).toHaveLength(1)
    const ctr = res.ctrGaps[0]!
    expect(ctr.query).toBe('boiler quote service')
    expect(ctr.potentialClicks).toBe(9) // round(200 * (0.055 - 0.01))

    // recommendations reference both levers
    expect(res.recommendations.some((r) => /Add a section covering/.test(r))).toBe(true)
    expect(res.recommendations.some((r) => /Optimize the title/.test(r))).toBe(true)
  })

  it('sorts coverage gaps with near-top queries first', () => {
    const rows: GscQueryRow[] = [
      qrow('missing term one', { impressions: 1000, clicks: 0, ctr: 0, position: 40 }), // far, high impressions
      qrow('missing term two', { impressions: 100, clicks: 0, ctr: 0, position: 6 }), // near-top, fewer impressions
    ]
    const res = gradeContentCoverage('unrelated content', rows)
    expect(res.coverageGaps[0]!.query).toBe('missing term two') // near-top wins ordering
    expect(res.coverageGaps[0]!.nearTop).toBe(true)
  })

  it('caps gaps and recommendations via options', () => {
    const rows: GscQueryRow[] = Array.from({ length: 20 }, (_, i) =>
      qrow(`missing query ${i}`, { impressions: 100 + i, clicks: 0, ctr: 0, position: 6 }),
    )
    const res = gradeContentCoverage('content', rows, { maxGaps: 5, maxRecommendations: 3 })
    expect(res.coverageGaps.length).toBeLessThanOrEqual(5)
    expect(res.recommendations.length).toBeLessThanOrEqual(3)
  })
})
