'use client'

import type { RefKey } from '@shipment/onpage-core'
import { useCallback, useState } from 'react'

/** Documents rendered from editor state on this page (client mode), and how they register. */
export function useClientDocs(): [ReadonlySet<RefKey>, (key: RefKey) => () => void] {
  const [docs, setDocs] = useState<ReadonlySet<RefKey>>(() => new Set())
  const register = useCallback((key: RefKey) => {
    setDocs((s) => new Set(s).add(key))
    return () =>
      setDocs((s) => {
        const next = new Set(s)
        next.delete(key)
        return next
      })
  }, [])
  return [docs, register]
}
