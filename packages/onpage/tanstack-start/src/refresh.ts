/**
 * The TanStack Start Renderer: after a save, re-run the route loaders
 * (router.invalidate) inside a transition. `afterSave` resolves once the
 * invalidated routes settle, so the editor knows when to drop its stand-ins.
 * Saves landing close together share one invalidation.
 */
import { useMemo, useRef, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { Renderer } from '@shipment/onpage-core'

const DEBOUNCE = 60
const FALLBACK = 10_000

export function useTanstackRefresh(): Renderer {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const queued = useRef<Array<() => void>>([])
  const inFlight = useRef<Array<() => void>>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  return useMemo<Renderer>(
    () => ({
      name: 'tanstack-refresh',
      live: false,
      afterSave: () =>
        new Promise<void>((resolve) => {
          queued.current.push(resolve)
          setTimeout(resolve, FALLBACK) // never hang the editor on a refresh that didn't report back
          clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            inFlight.current.push(...queued.current)
            queued.current = []
            startTransition(() => {
              // Settles when the invalidated loaders finish; either way the
              // editor's stand-ins are dropped exactly once.
              const flush = () => {
                const done = inFlight.current
                inFlight.current = []
                done.forEach((f) => f())
              }
              Promise.resolve(router.invalidate()).then(flush, flush)
            })
          }, DEBOUNCE)
        }),
    }),
    [router],
  )
}
