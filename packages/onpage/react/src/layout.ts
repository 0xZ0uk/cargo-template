'use client'

/**
 * Layout change notifications for everything drawn over the page. Event
 * driven (capture-phase scroll, resize, ResizeObserver on the document and on
 * tracked elements), batched to one callback per animation frame: no polling.
 */
import { useEvent } from './useEvent.ts'
import { useEffect, useState } from 'react'

const listeners = new Set<() => void>()
let frame = 0
let observer: ResizeObserver | undefined

function emit() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    for (const fn of listeners) fn()
  })
}

function install() {
  window.addEventListener('scroll', emit, { capture: true, passive: true })
  window.addEventListener('resize', emit, { passive: true })
  observer = new ResizeObserver(emit)
  observer.observe(document.documentElement)
}

function uninstall() {
  window.removeEventListener('scroll', emit, { capture: true })
  window.removeEventListener('resize', emit)
  observer?.disconnect()
  observer = undefined
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

/** Run `fn` (batched per frame) whenever the page may have moved. Returns an unsubscribe. */
export function onLayoutChange(fn: () => void): () => void {
  if (!listeners.size) install()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (!listeners.size) uninstall()
  }
}

/** Tell overlays to re-measure (after the editor changed the page itself). */
export const notifyLayout = (): void => {
  if (listeners.size) emit()
}

/** Re-render on layout changes. */
export function useLayoutTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => onLayoutChange(() => setTick((t) => t + 1)), [])
  return tick
}

/**
 * Call `fn(el)` now and whenever `el` may have moved or resized (page layout
 * changes, or the element itself resizing, e.g. live re-render while typing).
 */
export function useTrackElement(getElement: () => Element | null, fn: (el: Element) => void): void {
  const run = useEvent(() => {
    const el = getElement()
    if (el) fn(el)
  })
  useEffect(() => {
    run()
    const off = onLayoutChange(run)
    const el = getElement()
    let ro: ResizeObserver | undefined
    if (el) {
      ro = new ResizeObserver(() => run())
      ro.observe(el)
    }
    return () => {
      off()
      ro?.disconnect()
    }
    // getElement identity may change per render; tracking follows the element via run().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
