'use client'

/**
 * Mounts panels that live in a separate chunk (./lazy/panels.tsx). The chunk
 * is fetched when the browser is idle after the editor starts, so opening a
 * panel rarely waits for the network.
 */
import { lazy, Suspense, useEffect } from 'react'
import { useOnPage } from '../context.tsx'
import type { PanelKind } from '../types.ts'

const load = () => import('./lazy/panels.tsx')
const Panel = lazy(load)

/** Panels in the on-demand chunk. */
export const ON_DEMAND: ReadonlySet<PanelKind> = new Set<PanelKind>([
  'publish',
  'blocks',
  'settings',
  'page',
  'versions',
  'comments',
  'saveSection',
])

export function OnDemandPanels() {
  const { panel } = useOnPage()
  useEffect(() => {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(() => void load())
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(() => void load(), 2000)
    return () => clearTimeout(id)
  }, [])
  if (!panel || !ON_DEMAND.has(panel.kind)) return null
  return (
    <Suspense fallback={null}>
      <Panel />
    </Suspense>
  )
}
