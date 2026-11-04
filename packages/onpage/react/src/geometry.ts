/**
 * Where the editor's floating UI goes: named distances (px) and the positioning
 * rules shared by the overlay, toolbars and popovers.
 */
type Rect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'width' | 'height'>

export const GEOMETRY = {
  /** Gap kept between floating UI and the viewport edge or its element. */
  margin: 8,
  /** How far an outline sits outside its element. */
  outline: 2,
  /** Height of a row toolbar. */
  toolbar: 40,
  /** Toolbars never ride higher than this (the site header usually lives there). */
  toolbarMinTop: 60,
  /** Field label chips never go above this. */
  chipMinTop: 22,
  /** Gap between a list and its "+ Add" button. */
  addGap: 14,
  /** Room the dock takes above its offset (its height plus a gap). */
  dock: 68,
  /** "+ Add first section" sits at most this far down an empty list. */
  emptyListOffset: 160,
} as const

const { margin, outline, toolbar, toolbarMinTop, addGap, dock } = GEOMETRY

/** Is any of the element on screen, `inset` px inside the top and bottom? */
export const inViewport = (r: Rect, inset = 0): boolean =>
  r.bottom >= inset && r.top <= window.innerHeight - inset

/** An outline box around an element. */
export const outlineBox = (r: Rect) => ({
  top: r.top - outline,
  left: r.left - outline,
  width: r.width + 2 * outline,
  height: r.height + 2 * outline,
})

/**
 * A row toolbar: at the top end of the row (top-right; top-left on a
 * right-to-left page), kept below the header and above the row's end.
 */
export const toolbarPosition = (r: Rect, rtl = false) => {
  const top = Math.min(Math.max(r.top + margin, toolbarMinTop), r.bottom - toolbar)
  return rtl
    ? { top, left: Math.max(r.left + margin, margin) }
    : { top, right: Math.max(window.innerWidth - r.right + margin, margin) }
}

/**
 * How far the dock sits from the bottom: `--po-dock-bottom` (default 16px). A site
 * with its own fixed bottom bar raises the dock by setting it, e.g.
 * `html:has(.cart-bar) { --po-dock-bottom: 88px }`.
 */
export function dockOffset(): number {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--po-dock-bottom'),
  )
  return Number.isFinite(value) ? value : 16
}

/** "+ Add" below a list, or pinned above the dock while the list runs past the viewport. */
export const belowList = (r: Rect): number =>
  Math.min(r.bottom + addGap, window.innerHeight - dockOffset() - dock)

/** A fixed popover below (or, without room, above) an element, kept inside the viewport. */
export function popoverPosition(
  el: Element | null,
  size = { width: 300, height: 320 },
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!el) return { top: 80, left: Math.max(margin, vw / 2 - size.width / 2) }
  const r = el.getBoundingClientRect()
  const below = r.bottom + margin
  const top = below + size.height < vh ? below : Math.max(margin, r.top - margin - size.height)
  // Aligned with the element's start: its left edge, or its right edge on a right-to-left page.
  const start = getComputedStyle(el).direction === 'rtl' ? r.right - size.width : r.left
  const left = Math.min(Math.max(margin, start), vw - size.width - margin)
  return { top, left }
}
