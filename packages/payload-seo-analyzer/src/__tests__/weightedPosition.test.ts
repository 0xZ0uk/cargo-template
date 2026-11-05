import { describe, expect, it } from 'vitest'
import { weightedPosition } from '../helpers/weightedPosition.js'

describe('weightedPosition', () => {
  it('weights by impressions', () => {
    expect(
      weightedPosition([
        { position: 2, impressions: 80 },
        { position: 40, impressions: 0 },
      ]),
    ).toBe(2)
    expect(
      weightedPosition([
        { position: 1, impressions: 1 },
        { position: 2, impressions: 2 },
      ]),
    ).toBe(1.7)
  })

  it('ignores position <= 0 rows', () => {
    expect(weightedPosition([{ position: 0, impressions: 1000 }, { position: 6, impressions: 1 }])).toBe(6)
    expect(weightedPosition([{ position: 0, impressions: 10 }])).toBe(0)
  })

  it('falls back to the plain average when nothing has impressions', () => {
    expect(weightedPosition([{ position: 2, impressions: 0 }, { position: 5, impressions: 0 }])).toBe(3.5)
  })

  it('returns 0 for no rows', () => {
    expect(weightedPosition([])).toBe(0)
  })
})
