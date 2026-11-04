/** DOM helpers shared by the editor UI (browser-only, no React). */

/** Every DOM attribute the editor sets (annotations, which sites write, are `ATTR`). */
export const DOM_ATTR = {
  /** Hides a page element while an editor or ghost stands in for it. */
  hidden: 'data-onpage-hidden',
  /** Marks the editor's own UI, which locators and click handling ignore. */
  ui: 'data-onpage-ui',
  /** A page target the editor made keyboard-focusable. */
  focusable: 'data-onpage-focusable',
  /** On <html> while editing. */
  editing: 'data-onpage-editing',
  /** The editor's injected stylesheet. */
  styles: 'data-onpage-styles',
  /** A field the server called invalid: the message. */
  invalid: 'data-onpage-invalid',
  /** A field that differs from the published version (history panel). */
  changed: 'data-onpage-changed',
} as const

export const HIDDEN = DOM_ATTR.hidden
export const UI = DOM_ATTR.ui

/** Languages written right to left (the editor UI takes its direction from `uiLocale`). */
export const isRtlLocale = (locale: string): boolean =>
  /^(ar|he|fa|ur|ps|yi|dv|ku|sd|ug|ckb)(-|$)/i.test(locale)

const apple = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** A keyboard shortcut as this platform writes it: ⇧⌘Z on Apple devices, Ctrl+Shift+Z elsewhere. */
export const shortcut = (key: string, { shift = false } = {}): string =>
  apple() ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`

/** Computed styles copied onto an inline editor so it looks like the element it replaces. */
export const TYPOGRAPHY = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textAlign',
  // The inline editor writes in the element's direction (right to left for Arabic, Hebrew…).
  'direction',
  'textIndent',
  'color',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

export function copyTypography(from: Element, to: HTMLElement): void {
  const cs = getComputedStyle(from)
  for (const k of TYPOGRAPHY) to.style[k] = cs[k]
}

/** The typography inline styles of an element (for a ghost that must look like it). */
export function typographyOf(el: HTMLElement): Partial<CSSStyleDeclaration> {
  const out: Partial<CSSStyleDeclaration> = {}
  for (const k of TYPOGRAPHY) out[k] = el.style[k]
  return out
}

/** Place an absolutely positioned (document layer) box over `el`. */
export function placeOver(
  box: HTMLElement,
  el: Element,
  opts: { minWidth?: number; minHeight?: boolean } = {},
): void {
  const r = el.getBoundingClientRect()
  box.style.top = `${r.top + window.scrollY}px`
  box.style.left = `${r.left + window.scrollX}px`
  box.style.width = `${Math.max(r.width, opts.minWidth ?? 0)}px`
  if (opts.minHeight) box.style.minHeight = `${r.height}px`
}

/** Inside the editor's own UI? */
export const isOurs = (node: EventTarget | null): boolean =>
  node instanceof Element && !!node.closest(`[${UI}]`)

/** Focus is in a text input or editable region (keyboard shortcuts stay out of the way). */
export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT')

/** The DOM caret position under a viewport point, if it falls inside `within`. */
export function caretAt(
  point: { x: number; y: number },
  within: Element,
): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const pos = doc.caretPositionFromPoint?.(point.x, point.y)
  if (pos && within.contains(pos.offsetNode)) return { node: pos.offsetNode, offset: pos.offset }
  const r = doc.caretRangeFromPoint?.(point.x, point.y)
  if (r && within.contains(r.startContainer))
    return { node: r.startContainer, offset: r.startOffset }
  return null
}

/** Place the caret at a viewport point inside `el`, else at the end. */
export function placeCaret(el: HTMLElement, point?: { x: number; y: number }): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  const hit = point ? caretAt(point, el) : null
  if (hit) range.setStart(hit.node, hit.offset)
  else {
    range.selectNodeContents(el)
    range.collapse(false)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

export { popoverPosition } from './geometry.ts'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export const focusableIn = (root: Element): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled'),
  )
