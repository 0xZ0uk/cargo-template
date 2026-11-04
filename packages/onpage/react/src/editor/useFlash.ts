'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Flash } from '../types.ts'

const SHOWN_FOR = 4000

/** The dock's short message, cleared after a few seconds. */
export function useFlash(): [Flash | null, (text: string, bad?: boolean) => void] {
  const [flash, setFlash] = useState<Flash | null>(null)
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), SHOWN_FOR)
    return () => clearTimeout(id)
  }, [flash])
  const notify = useCallback((text: string, bad?: boolean) => setFlash({ text, bad }), [])
  return [flash, notify]
}
