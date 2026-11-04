'use client'

import { useEffect, useRef } from 'react'
import { useOnPage } from '../context.tsx'
import { HIDDEN, placeOver } from '../dom.ts'
import { useLayoutTick } from '../layout.ts'
import { sanitizeHtml } from '../sanitize.ts'
import type { Ghost } from './useGhosts.ts'

/** Refresh mode: committed content stays on screen until the server render shows it. */
export function Ghosts({ ghosts }: { ghosts: Ghost[] }) {
  return (
    <>
      {ghosts.map((g) => (
        <GhostView key={g.id} ghost={g} />
      ))}
    </>
  )
}

function GhostView({ ghost }: { ghost: Ghost }) {
  const { targets, editing } = useOnPage()
  const box = useRef<HTMLDivElement>(null)
  const hidden = useRef<Element | null>(null)
  const tick = useLayoutTick()
  const reopened = editing?.key === ghost.key && editing.path === ghost.path

  useEffect(() => {
    const el = targets.find(ghost.key, ghost.path)?.el ?? null
    if (hidden.current && hidden.current !== el) hidden.current.removeAttribute(HIDDEN)
    hidden.current = el
    const b = box.current
    if (!b) return
    if (!el || reopened) {
      b.style.visibility = 'hidden'
      return
    }
    el.setAttribute(HIDDEN, 'true')
    placeOver(b, el, { minHeight: true })
    b.style.visibility = 'visible'
  }, [targets, ghost.key, ghost.path, reopened, tick])

  useEffect(() => () => hidden.current?.removeAttribute(HIDDEN), [])

  return (
    <div
      ref={box}
      className={`po-ghost${ghost.className ? ` ${ghost.className}` : ''}`}
      style={ghost.style as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(ghost.html) }}
      aria-hidden
      data-testid="onpage-ghost"
    />
  )
}
