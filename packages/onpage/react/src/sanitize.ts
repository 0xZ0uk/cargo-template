/**
 * Minimal HTML sanitizer for editor-generated markup shown in ghosts (the
 * stand-in content kept on screen until a server refresh lands). Drops active
 * elements, event handlers and unsafe URLs.
 */
import { safeLinkUrl } from '@shipment/onpage-core'

const DROP = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'META',
  'BASE',
  'FORM',
  'INPUT',
  'TEXTAREA',
  'BUTTON',
  'SELECT',
  'TEMPLATE',
  'SVG',
  'MATH',
])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster'])

export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const walk = (node: ParentNode) => {
    for (const el of Array.from(node.children)) {
      if (DROP.has(el.tagName.toUpperCase())) {
        el.remove()
        continue
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        if (
          name.startsWith('on') ||
          name === 'style' ||
          (URL_ATTRS.has(name) && !safeLinkUrl(attr.value))
        ) {
          el.removeAttribute(attr.name)
        }
      }
      walk(el)
    }
  }
  walk(tpl.content)
  return tpl.innerHTML
}

/** Text made safe to put in HTML. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ESCAPES[c as keyof typeof ESCAPES])

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as const
