'use client'

/**
 * Ghosts: in refresh mode, committed content stays on screen (over the hidden
 * original) until the server render that includes it has landed. A ghost
 * records the document's save sequence when it was made; the render after a
 * later save retires it. Failed saves and a TTL retire ghosts too.
 */
import type { SessionSnapshot, RefKey } from '@cargo/onpage-core'
import type { GhostInput } from '../types.ts'
import { useCallback, useEffect, useState } from 'react'

export interface Ghost extends GhostInput {
  id: string
  key: RefKey
  path: string
  /** Save sequence of the document when the ghost was made. */
  afterSeq: number
  until: number
}

const TTL = 15_000

export function useGhosts(snap: SessionSnapshot | null) {
  const [ghosts, setGhosts] = useState<Ghost[]>([])

  const add = useCallback((g: Omit<Ghost, 'id' | 'until' | 'afterSeq'>, afterSeq: number) => {
    const now = Date.now()
    setGhosts((gs) => [
      ...gs.filter((x) => !(x.key === g.key && x.path === g.path)),
      { ...g, afterSeq, id: `${now}-${Math.random().toString(36).slice(2)}`, until: now + TTL },
    ])
  }, [])

  /** The page re-rendered after save `seq` of document `key`. */
  const rendered = useCallback((key: RefKey, seq: number) => {
    setGhosts((gs) =>
      gs.some((g) => g.key === key && g.afterSeq < seq)
        ? gs.filter((g) => !(g.key === key && g.afterSeq < seq))
        : gs,
    )
  }, [])

  // Expired ghosts.
  useEffect(() => {
    if (!ghosts.length) return
    const next = Math.min(...ghosts.map((g) => g.until)) - Date.now()
    const timer = setTimeout(
      () => setGhosts((gs) => gs.filter((g) => g.until > Date.now())),
      Math.max(next, 0) + 10,
    )
    return () => clearTimeout(timer)
  }, [ghosts])

  // A failed save will never render: don't cover the page for it.
  const visible = ghosts.filter((g) => {
    const status = snap?.docs[g.key]?.save.status
    return status !== 'error' && status !== 'conflict'
  })

  return { ghosts: visible, add, rendered }
}
