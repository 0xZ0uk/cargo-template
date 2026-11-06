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
 * way, the last one of the same locale stays, so the score doesn't flicker between the two
 * readings; if that request fails, the older answer is dropped and the score reads the form as it is.
 *
 * Answers are cached per form session (this component's lifetime) by the locale and the
 * posted values, so returning to an earlier state costs no request. Nothing is cached
 * across sessions.
 */
export function useSidebarContent(
  formFields: unknown,
  collection: string | undefined,
  endpoint: string,
  locale?: string,
): SidebarContentState {
  const doc = useMemo(() => formStateToDoc(formFields), [formFields])
  const local = useMemo(() => contentInputFromDoc(doc, collection ?? ''), [doc, collection])
  // The server populates relations per `?locale=` (localized alt texts, slugs), so the same
  // values read in another locale are another answer.
  const key = useMemo(() => (collection ? JSON.stringify([locale ?? '', doc]) : ''), [doc, collection, locale])

  const cache = useRef(new Map<string, SidebarContentInput>())
  const [server, setServer] = useState<{ key: string; locale: string; content: SidebarContentInput } | null>(null)

  useEffect(() => {
    if (!collection || !key) return
    const cached = cache.current.get(key)
    if (cached) {
      setServer({ key, locale: locale ?? '', content: cached })
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
        if (controller.signal.aborted) return
        const content = res.ok ? pickDocContentInput(await res.json()) : null
        if (controller.signal.aborted) return
        if (!content) {
          // The request for the current form failed: drop the older answer, so the score
          // reads the form as it is rather than a state the editor has since left.
          setServer(null)
          return
        }
        cache.current.set(key, content)
        if (cache.current.size > CACHE_SIZE) {
          const oldest = cache.current.keys().next().value
          if (oldest !== undefined) cache.current.delete(oldest)
        }
        setServer({ key, locale: locale ?? '', content })
      } catch {
        // Aborted: a newer request replaces this one. Offline or a throw: the older answer
        // is for an older form, so the local reading takes over.
        if (!controller.signal.aborted) setServer(null)
      }
    }, SIDEBAR_CONTENT_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [collection, doc, endpoint, key, locale])

  // The last answer stays while a newer one is on its way, but not across a locale switch:
  // the other locale's answer is a different reading, not an older one.
  const usable = server && server.locale === (locale ?? '') ? server : null
  return useMemo(
    () => ({
      content: usable ? usable.content : local,
      resolved: !!usable && usable.key === key,
    }),
    [usable, local, key],
  )
}
