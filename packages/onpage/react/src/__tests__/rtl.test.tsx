// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isRtlLocale } from '../dom.ts'
import { popoverPosition, toolbarPosition } from '../geometry.ts'

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect

describe('right-to-left', () => {
  it('knows right-to-left languages', () => {
    expect(['ar', 'he-IL', 'fa', 'ur'].every(isRtlLocale)).toBe(true)
    expect(['en', 'de', 'fr-CA', 'ja'].some(isRtlLocale)).toBe(false)
  })
  it('puts a row toolbar at the top end of the row: right, or left on a right-to-left page', () => {
    const r = rect(100, 200, 400, 300)
    expect(toolbarPosition(r)).toEqual({ top: 208, right: window.innerWidth - 500 + 8 })
    expect(toolbarPosition(r, true)).toEqual({ top: 208, left: 108 })
  })
  it("aligns a popover with the element's start edge", () => {
    const el = document.createElement('p')
    document.body.appendChild(el)
    el.getBoundingClientRect = () => rect(300, 100, 400, 40)
    expect(popoverPosition(el, { width: 200, height: 100 }).left).toBe(300)
    el.style.direction = 'rtl'
    expect(popoverPosition(el, { width: 200, height: 100 }).left).toBe(500) // right edge − width
    el.remove()
  })
})
