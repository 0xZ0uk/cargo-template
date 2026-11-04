'use client'

import { useCallback, useInsertionEffect, useRef } from 'react'

/**
 * A stable function that always calls the latest `fn` (the `useEffectEvent`
 * pattern). Our own, because the React bundled with Next.js 15 doesn't export
 * `useEffectEvent`. Call it from effects and event handlers, not during render.
 */
export function useEvent<F extends (...args: never[]) => unknown>(fn: F): F {
  const latest = useRef(fn)
  useInsertionEffect(() => {
    latest.current = fn
  })
  const stable = useCallback((...args: Parameters<F>) => latest.current(...args), [])
  // The wrapper has F's exact signature: it forwards its arguments and result unchanged.
  return stable as F
}
