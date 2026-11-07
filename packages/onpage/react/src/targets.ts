'use client'

/**
 * Keeps an index of the page's targets current: scans with the locator on
 * mount and again whenever the page's DOM changes (a server refresh, a client
 * re-render, lazy content), ignoring the editor's own UI. Rescans are
 * debounced and run when the browser is idle.
 */
import { targetKey, type Locator, type Target, type TargetKind } from '@shipment/onpage-core'
import { useEffect, useState } from 'react'
import { ATTR } from './annotations.ts'
import { isOurs } from './dom.ts'
import type { TargetIndex } from './types.ts'

const FIELD_KINDS = new Set<TargetKind>(['text', 'textarea', 'richtext', 'media', 'field'])
export const isFieldTarget = (t: Target): boolean => FIELD_KINDS.has(t.kind)
export const isRowTarget = (t: Target): boolean => t.kind === 'item'

export function buildIndex(all: Target[]): TargetIndex {
  const byEl = new Map<Element, Target[]>()
  const byPath = new Map<string, Target[]>()
  // Annotations first: they are precise, inferred targets are a fallback.
  const sorted = [...all].sort(
    (a, b) => Number(a.source !== 'annotation') - Number(b.source !== 'annotation'),
  )
  for (const t of sorted) {
    byEl.set(t.el, [...(byEl.get(t.el) ?? []), t])
    const k = targetKey(t.ref, t.path)
    byPath.set(k, [...(byPath.get(k) ?? []), t])
  }
  return {
    all: sorted,
    at: (el) => byEl.get(el) ?? [],
    find: (key, path, kinds) =>
      (byPath.get(targetKey(key, path)) ?? []).find(
        (t) => t.el.isConnected && (!kinds || kinds.includes(t.kind)),
      ),
  }
}

/** The innermost field target and all row targets (innermost first) at or above `el`. */
export function targetsAt(
  index: TargetIndex,
  el: Element | null,
): { field?: Target | undefined; rows: Target[] } {
  let field: Target | undefined
  const rows: Target[] = []
  for (let node = el; node; node = node.parentElement) {
    for (const t of index.at(node)) {
      if (!field && isFieldTarget(t)) field = t
      if (isRowTarget(t)) rows.push(t)
    }
  }
  return { field, rows }
}

const WATCHED = [ATTR.ref, ATTR.field, ATTR.row, ATTR.list, 'alt']
const idle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const h = requestIdleCallback(fn, { timeout: 300 })
    return () => cancelIdleCallback(h)
  }
  const h = setTimeout(fn, 50)
  return () => clearTimeout(h)
}

export function useTargets(locator: Locator, root: () => ParentNode | null): TargetIndex {
  const [index, setIndex] = useState<TargetIndex>(() => buildIndex([]))
  useEffect(() => {
    const r = root()
    if (!r) return
    let debounce: ReturnType<typeof setTimeout> | undefined
    let cancelIdle: (() => void) | undefined
    const scan = () => setIndex(buildIndex(locator.scan(r)))
    scan()
    const observer = new MutationObserver((records) => {
      if (
        records.every((m) =>
          isOurs(m.target instanceof Element ? m.target : m.target.parentElement),
        )
      )
        return
      clearTimeout(debounce)
      cancelIdle?.()
      debounce = setTimeout(() => (cancelIdle = idle(scan)), 120)
    })
    observer.observe(r, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: WATCHED,
    })
    return () => {
      observer.disconnect()
      clearTimeout(debounce)
      cancelIdle?.()
    }
  }, [locator, root])
  return index
}
