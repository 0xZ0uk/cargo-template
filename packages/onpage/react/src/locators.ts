/**
 * Locators — the Locator port's default adapters. Each scans the DOM and
 * returns targets: { el, ref, path, kind }.
 *
 *   annotations()  data-onpage-* attributes (precise, opt-in)
 *   stega()        invisible markers in text and <img alt> (automatic), plus
 *                  inferred rows and lists for array/blocks content
 *   composite()    merge several; earlier locators win for the same element+path
 */
import {
  hasStegaMarker,
  isTargetKind,
  parseRefKey,
  rowPrefixes,
  targetKey,
  stegaDecode,
  type DocRef,
  type Locator,
  type Target,
  type TargetKind,
} from '@shipment/onpage-core'
import { ATTR } from './annotations.ts'
import { UI } from './dom.ts'

export function annotations(): Locator {
  return {
    name: 'annotations',
    scan(root) {
      const out: Target[] = []
      root.querySelectorAll(`[${ATTR.ref}]`).forEach((el) => {
        const ref = parseRefKey(el.getAttribute(ATTR.ref) ?? '')
        if (!ref) return
        const label = el.getAttribute(ATTR.label) ?? undefined
        const field = el.getAttribute(ATTR.field)
        const kind = el.getAttribute(ATTR.kind)
        if (field)
          out.push({
            el,
            ref,
            path: field,
            // Page markup is input: an unknown kind is treated as a plain field.
            kind: isTargetKind(kind) ? kind : 'field',
            label,
            source: 'annotation',
          })
        const row = el.getAttribute(ATTR.row)
        if (row) out.push({ el, ref, path: row, kind: 'item', label, source: 'annotation' })
        const list = el.getAttribute(ATTR.list)
        if (list) out.push({ el, ref, path: list, kind: 'list', label, source: 'annotation' })
      })
      return out
    },
  }
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE'])

/** Lowest common ancestor of a set of elements. */
function commonAncestor(els: Element[]): Element | null {
  if (!els.length) return null
  let anc: Element | null = els[0] ?? null
  for (const el of els.slice(1)) {
    while (anc && !anc.contains(el)) anc = anc.parentElement
    if (!anc) return null
  }
  return anc
}

export function stega(opts: { inferRows?: boolean } = {}): Locator {
  const inferRows = opts.inferRows ?? true
  return {
    name: 'stega',
    scan(root) {
      const fields: Target[] = []
      const seen = new Set<string>()
      const ids = new WeakMap<Element, number>()
      let nextId = 0
      const add = (el: Element, ref: DocRef, path: string, kind: TargetKind) => {
        let id = ids.get(el)
        if (id === undefined) ids.set(el, (id = nextId++))
        const k = `${id}|${targetKey(ref, path)}|${kind}`
        if (seen.has(k)) return // several text nodes of one field in one element
        seen.add(k)
        fields.push({ el, ref, path, kind, source: 'stega' })
      }

      const doc = (root as Node).ownerDocument ?? (root as Document)
      const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue
        if (!text || !hasStegaMarker(text)) continue
        const parent = n.parentElement
        if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest(`[${UI}]`)) continue
        for (const m of stegaDecode(text)) {
          const ref = parseRefKey(m.ref)
          if (!ref) continue
          // Rich text: map the block that holds all of the field's text (resolved below).
          add(parent, ref, m.path, m.kind === 'richtext' ? 'richtext' : m.kind)
        }
      }
      root.querySelectorAll('img[alt]').forEach((img) => {
        for (const m of stegaDecode(img.getAttribute('alt') ?? '')) {
          const ref = parseRefKey(m.ref)
          if (ref) add(img.closest('picture') ?? img, ref, m.path, 'media')
        }
      })

      // Rich text: one target per field = the common ancestor of all its text.
      const out: Target[] = []
      const rich = new Map<string, Target[]>()
      for (const t of fields) {
        if (t.kind !== 'richtext') {
          out.push(t)
          continue
        }
        const k = targetKey(t.ref, t.path)
        rich.set(k, [...(rich.get(k) ?? []), t])
      }
      for (const group of rich.values()) {
        const [first] = group
        const el = commonAncestor(group.map((t) => t.el))
        if (first && el) out.push({ ...first, el })
      }

      if (!inferRows) return out

      // Rows: for each row path, the common ancestor of its fields — accepted
      // only if it doesn't also contain a sibling row's fields.
      // Precompute, for every ancestor of a field, the field keys under it (one pass).
      const under = new Map<Element, string[]>()
      for (const t of out) {
        const key = targetKey(t.ref, t.path)
        for (let el: Element | null = t.el; el && el !== root; el = el.parentElement) {
          const list = under.get(el)
          if (list) list.push(key)
          else under.set(el, [key])
        }
      }
      const byRow = new Map<string, { ref: DocRef; path: string; els: Element[] }>()
      for (const t of out) {
        for (const row of rowPrefixes(t.path)) {
          const k = targetKey(t.ref, row)
          const entry = byRow.get(k) ?? { ref: t.ref, path: row, els: [] }
          entry.els.push(t.el)
          byRow.set(k, entry)
        }
      }
      const rows: Target[] = []
      for (const [rowKey, { ref, path, els }] of byRow) {
        let anc = commonAncestor(els)
        if (!anc || anc === root) continue
        const foreignInside = (el: Element) =>
          (under.get(el) ?? []).some((k) => k !== rowKey && !k.startsWith(`${rowKey}.`))
        if (foreignInside(anc)) continue // two rows share one element: can't tell them apart
        // Grow to the row's wrapper: the largest ancestor holding only this row's fields.
        while (anc.parentElement && anc.parentElement !== root && !foreignInside(anc.parentElement))
          anc = anc.parentElement
        rows.push({ el: anc, ref, path, kind: 'item', source: 'stega' })
      }
      // Lists: the common ancestor of a list's rows.
      const byList = new Map<string, { ref: DocRef; path: string; els: Element[] }>()
      for (const r of [...rows]) {
        const list = r.path.slice(0, r.path.lastIndexOf('.'))
        const k = targetKey(r.ref, list)
        const entry = byList.get(k) ?? { ref: r.ref, path: list, els: [] }
        entry.els.push(r.el)
        byList.set(k, entry)
      }
      for (const { ref, path, els } of byList.values()) {
        const anc = els.length > 1 ? commonAncestor(els) : (els[0]?.parentElement ?? null)
        if (anc && anc !== root) rows.push({ el: anc, ref, path, kind: 'list', source: 'stega' })
      }
      return [...out, ...rows]
    },
  }
}

/** Merge locators; for the same element and path the earlier locator wins. Rows/lists: one element per path, first wins. */
export function composite(...locators: Locator[]): Locator {
  return {
    name: `composite(${locators.map((l) => l.name).join(',')})`,
    scan(root) {
      const out: Target[] = []
      const byPath = new Set<string>()
      const byElPath = new Set<string>()
      const elIds = new WeakMap<Element, number>()
      let next = 0
      const id = (el: Element) => {
        let v = elIds.get(el)
        if (v === undefined) elIds.set(el, (v = next++))
        return v
      }
      for (const loc of locators) {
        for (const t of loc.scan(root)) {
          const pathKey = `${targetKey(t.ref, t.path)}|${t.kind}`
          if ((t.kind === 'item' || t.kind === 'list') && byPath.has(pathKey)) continue
          const k = `${id(t.el)}|${pathKey}`
          if (byElPath.has(k)) continue
          byElPath.add(k)
          byPath.add(pathKey)
          out.push(t)
        }
      }
      return out
    },
  }
}
