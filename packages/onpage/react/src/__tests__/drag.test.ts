import { describe, expect, it } from 'vitest'
import { slotAt } from '../ui/DragHandle.tsx'

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, right: left + width, bottom: top + height }) as DOMRect

describe('drop slots', () => {
  // Three stacked sections, 100px tall, starting at y=0.
  const stacked = [rect(0, 0, 500, 100), rect(100, 0, 500, 100), rect(200, 0, 500, 100)]
  it('stacked rows: the slot before the first row whose middle is below the pointer', () => {
    expect(slotAt(stacked, 0, 10, 20)?.to).toBe(0) // stays
    expect(slotAt(stacked, 0, 10, 160)?.to).toBe(1) // between 2nd and 3rd
    expect(slotAt(stacked, 0, 10, 290)?.to).toBe(2) // last
    expect(slotAt(stacked, 2, 10, 20)?.to).toBe(0)
    expect(slotAt(stacked, 2, 10, 120)?.to).toBe(1)
  })
  it('draws the line at the slot edge, across the row', () => {
    expect(slotAt(stacked, 0, 10, 160)?.line).toEqual({ top: 200, left: 0, width: 500, height: 3 })
    expect(slotAt(stacked, 0, 10, 290)?.line).toEqual({ top: 300, left: 0, width: 500, height: 3 })
  })
  it('cards side by side are ordered by x, with a vertical line', () => {
    const cards = [rect(0, 0, 100, 80), rect(0, 120, 100, 80), rect(0, 240, 100, 80)]
    expect(slotAt(cards, 0, 230, 40)).toEqual({
      to: 1,
      line: { top: 0, left: 240, width: 3, height: 80 },
    })
    expect(slotAt(cards, 2, 10, 40)?.to).toBe(0)
  })
})
