// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { belowList, dockOffset, GEOMETRY } from '../geometry.ts'

const rect = (top: number, bottom: number) => ({
  top,
  bottom,
  left: 0,
  right: 100,
  width: 100,
  height: bottom - top,
})

describe('dock offset', () => {
  afterEach(() => document.documentElement.style.removeProperty('--po-dock-bottom'))

  it('defaults to 16px and follows --po-dock-bottom', () => {
    expect(dockOffset()).toBe(16)
    document.documentElement.style.setProperty('--po-dock-bottom', '88px')
    expect(dockOffset()).toBe(88)
  })

  it('pins "+ Add" above a raised dock', () => {
    const tall = rect(0, window.innerHeight * 2) // a list running past the viewport
    expect(belowList(tall)).toBe(window.innerHeight - 16 - GEOMETRY.dock)
    document.documentElement.style.setProperty('--po-dock-bottom', '88px')
    expect(belowList(tall)).toBe(window.innerHeight - 88 - GEOMETRY.dock)
  })
})
