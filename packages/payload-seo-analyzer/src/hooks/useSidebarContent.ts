'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { contentInputFromDoc } from '../helpers/docContentInput.js'
import { formStateToDoc, pickDocContentInput, type SidebarContentInput } from '../helpers/sidebarContent.js'

/** Wait after the last edit before asking the server (typing fires a change per key). */
export const SIDEBAR_CONTENT_DEBOUNCE_MS = 400
/** Responses kept per form session (undo, toggling a block back) before the oldest goes. */
const CACHE_SIZE = 20

export interface SidebarContentState {
  /** The content the score reads: the server's when it has answered, else the local mapping. */
  content: SidebarContentInput
  /** True once the server's content matches the form as it stands. */
  resolved: boolean
}

/**
 * The sidebar's content input, read like `/validate` reads a saved document.
 *
 * The form's values are posted to `/sidebar-content`, which populates uploads, `reference`
 * links and reusable sections (IDs in form state) with the user's access and runs the
 * collection's `extractContent`. Until the first answer, and if the request fails, the
 * score reads the form as it is (IDs count as nothing). While a newer answer is on its
 * way, the last one stays, so the score doesn't flicker between the two readings.
 *
 * Answers are cached per form session (this component's lifetime) by the posted values,
 * so returning to an earlier state costs no request. Nothing is cached across sessions.
 */
export function useSidebarContent(
  formFields: unknown,
  collection: string | undefined,
  endpoint: string,
  locale?: string,
): SidebarContentState {
  const doc = useMemo(() => formStateToDoc(formFields), [formFields])
  const local = useMemo(() => contentInputFromDoc(doc, collection ?? ''), [doc, collection])
  const key = useMemo(() => (collection ? JSON.stringify(doc) : ''), [doc, collection])

  const cache = useRef(new Map<string, SidebarContentInput>())
  const [server, setServer] = useState<{ key: string; content: SidebarContentInput } | null>(null)

  useEffect(() => {
    if (!collection || !key) return
    const cached = cache.current.get(key)
    if (cached) {
      setServer({ key, content: cached })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const url = locale ? `${endpoint}?locale=${encodeURIComponent(locale)}` : endpoint
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection, data: doc }),
          signal: controller.signal,
        })
        if (!res.ok) return
        const content = pickDocContentInput(await res.json())
        if (!content || controller.signal.aborted) return
        cache.current.set(key, content)
        if (cache.current.size > CACHE_SIZE) {
          const oldest = cache.current.keys().next().value
          if (oldest !== undefined) cache.current.delete(oldest)
        }
        setServer({ key, content })
      } catch {
        // Offline, aborted or refused: the local reading stays.
      }
    }, SIDEBAR_CONTENT_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [collection, doc, endpoint, key, locale])

  return useMemo(
    () => ({
      content: server ? server.content : local,
      resolved: !!server && server.key === key,
    }),
    [server, local, key],
  )
}
