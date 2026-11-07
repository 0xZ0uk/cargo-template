'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { type DocumentTarget, seoInputFromDoc } from '../helpers/seoInputFromDoc.js'
import { formStateToDoc, populatedFields } from '../helpers/sidebarContent.js'
import type { SeoConfig, SeoInput } from '../types.js'

/** Wait after the last edit before asking the server (typing fires a change per key). */
export const SIDEBAR_CONTENT_DEBOUNCE_MS = 400
/** Responses kept per form session (undo, toggling a block back) before the oldest goes. */
const CACHE_SIZE = 20

export interface SidebarContentState {
  /**
   * The input the score reads. Once the server has answered for the form as it stands, it is
   * the server's input (what `/validate` would map). Before that, the form's own mapping,
   * with the fields the last answer populated (uploads, blocks, authors…) kept from it.
   */
  input: SeoInput
  /** The effective config from the last answer (any locale, any form), or null before one. */
  config: SeoConfig | null
  /** True once the server's input matches the form as it stands. */
  resolved: boolean
  /**
   * True once the form differs from how it was when first read (the document as opened).
   * Edits before the first answer arrives mean that answer is not for the opened document.
   */
  edited: boolean
}

interface Answer {
  populated: Partial<SeoInput>
  config: SeoConfig
}

function parseAnswer(body: unknown, local: SeoInput): Answer | null {
  const { input, config } = (body ?? {}) as { input?: unknown; config?: unknown }
  if (!input || typeof input !== 'object' || !config || typeof config !== 'object') return null
  return { populated: populatedFields(local, input as SeoInput), config: config as SeoConfig }
}

/**
 * What the sidebar scores, read like `/validate` reads a saved document.
 *
 * The form's values are posted to `/sidebar-content`, which populates uploads, authors,
 * `reference` links and reusable sections (IDs in form state) with the user's access, runs
 * the collection's `extractContent` and maps the result with the server's mapping; it also
 * returns the effective config (plugin options with the saved settings on top).
 *
 * Until the first answer, and if the request fails, the input is the form as it is (IDs count
 * as nothing). While a newer answer is on its way, the fields the last answer of the same
 * locale populated stay, so the score doesn't flicker between the two readings, and the
 * fields the server only echoes (the meta title, the keyword) follow the form at once; if that
 * request fails, the older answer is dropped and the input is the form as it is. The config
 * doesn't depend on the form: the last one received stays.
 *
 * Answers are cached per form session (this component's lifetime) by the target, the locale
 * and the posted values, so returning to an earlier state costs no request. Nothing is cached
 * across sessions.
 */
export function useSidebarContent(
  formFields: unknown,
  target: DocumentTarget | undefined,
  endpoint: string,
  locale?: string,
): SidebarContentState {
  const targetKey = target ? JSON.stringify(target) : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableTarget = useMemo(() => target, [targetKey])
  const doc = useMemo(() => formStateToDoc(formFields), [formFields])
  const local = useMemo(() => seoInputFromDoc(doc, stableTarget ?? { collection: '' }), [doc, stableTarget])
  // The server populates relations per `?locale=` (localized alt texts, slugs), so the same
  // values read in another locale are another answer.
  const key = useMemo(
    () => (stableTarget ? JSON.stringify([targetKey, locale ?? '', doc]) : ''),
    [doc, stableTarget, targetKey, locale],
  )

  // The key of the form as opened: the first one read once the form state has arrived.
  const openedKey = useRef<string | null>(null)
  if (openedKey.current === null && formFields) openedKey.current = key
  const edited = openedKey.current !== null && key !== openedKey.current

  const cache = useRef(new Map<string, Answer>())
  const [server, setServer] = useState<{ key: string; locale: string; answer: Answer } | null>(null)
  const [config, setConfig] = useState<SeoConfig | null>(null)

  // The values the key was built from, read by the effect below, which runs per key (the
  // form state object can be a new reference without any change in its values).
  const current = useRef({ doc, local, target: stableTarget })
  current.current = { doc, local, target: stableTarget }

  useEffect(() => {
    const { doc, local, target } = current.current
    if (!target || !key) return
    const cached = cache.current.get(key)
    if (cached) {
      setServer((prev) =>
        prev && prev.key === key && prev.answer === cached ? prev : { key, locale: locale ?? '', answer: cached },
      )
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
          body: JSON.stringify({ ...target, data: doc }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const answer = res.ok ? parseAnswer(await res.json(), local) : null
        if (controller.signal.aborted) return
        if (!answer) {
          // The request for the current form failed: drop the older answer, so the score
          // reads the form as it is rather than a state the editor has since left.
          setServer(null)
          return
        }
        cache.current.set(key, answer)
        if (cache.current.size > CACHE_SIZE) {
          const oldest = cache.current.keys().next().value
          if (oldest !== undefined) cache.current.delete(oldest)
        }
        setServer({ key, locale: locale ?? '', answer })
        setConfig(answer.config)
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
  }, [endpoint, key, locale])

  // The last answer stays while a newer one is on its way, but not across a locale switch:
  // the other locale's answer is a different reading, not an older one.
  const usable = server && server.locale === (locale ?? '') ? server : null
  return useMemo(
    () => ({
      // For the form the answer is for, this is the server's input: every field it did not
      // populate equals the local mapping of the same values.
      input: usable ? { ...local, ...usable.answer.populated } : local,
      config,
      resolved: !!usable && usable.key === key,
      edited,
    }),
    [usable, local, key, edited, config],
  )
}
