// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDEBAR_CONTENT_DEBOUNCE_MS, useSidebarContent } from '../hooks/useSidebarContent.js'

const ENDPOINT = '/api/seo-plugin/sidebar-content'

// Stable objects, as the admin's form state is between edits (a fresh one per render would
// look like an edit on every render).
const forms = new Map<string, Record<string, unknown>>()
const form = (title: string) => {
  if (!forms.has(title)) forms.set(title, { 'meta.robots': { value: title } })
  return forms.get(title)
}

interface Answer {
  ok: boolean
  body?: Record<string, unknown>
  throws?: boolean
}
let answers: Answer[]
let urls: string[]

beforeEach(() => {
  vi.useFakeTimers()
  answers = []
  urls = []
  ;(globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string) => {
    urls.push(url)
    const next = answers.shift() ?? { ok: false }
    if (next.throws) throw new Error('offline')
    return { ok: next.ok, json: async () => next.body }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Lets the debounce fire and the awaited fetch settle. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SIDEBAR_CONTENT_DEBOUNCE_MS + 10)
  })
}

const served = (robotsMeta: string): Answer => ({ ok: true, body: { robotsMeta } })

describe('useSidebarContent', () => {
  it('uses the server answer once it matches the form', async () => {
    answers.push(served('from server'))
    const { result } = renderHook(() => useSidebarContent(form('a'), 'pages', ENDPOINT, 'en'))
    expect(result.current.resolved).toBe(false)
    await settle()
    expect(result.current.resolved).toBe(true)
    expect(result.current.content.robotsMeta).toBe('from server')
  })

  it('keeps the last answer while the next request is in flight', async () => {
    answers.push(served('first'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, 'pages', ENDPOINT, 'en'), {
      initialProps: { f: form('a') },
    })
    await settle()
    rerender({ f: form('b') })
    expect(result.current.resolved).toBe(false)
    expect(result.current.content.robotsMeta).toBe('first')
  })

  it('reads the form as it is after a failed request, not the older answer', async () => {
    answers.push(served('stale'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, 'pages', ENDPOINT, 'en'), {
      initialProps: { f: form('a') },
    })
    await settle()
    expect(result.current.content.robotsMeta).toBe('stale')

    // A non-2xx answer for the next edit
    answers.push({ ok: false })
    rerender({ f: form('b') })
    await settle()
    expect(result.current.resolved).toBe(false)
    expect(result.current.content.robotsMeta).toBe('b')

    // And a network error for the one after: still the form, never 'stale'
    answers.push(served('second'))
    rerender({ f: form('c') })
    await settle()
    expect(result.current.content.robotsMeta).toBe('second')
    answers.push({ ok: false, throws: true })
    rerender({ f: form('d') })
    await settle()
    expect(result.current.resolved).toBe(false)
    expect(result.current.content.robotsMeta).toBe('d')
  })

  it('does not treat an aborted request as a failure', async () => {
    answers.push(served('first'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, 'pages', ENDPOINT, 'en'), {
      initialProps: { f: form('a') },
    })
    await settle()
    // Edited again before the debounce fires: the answer stays until the new request answers.
    rerender({ f: form('b') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDEBAR_CONTENT_DEBOUNCE_MS / 2)
    })
    rerender({ f: form('c') })
    expect(result.current.content.robotsMeta).toBe('first')
  })

  it('reports an edit made before the first answer, so the sidebar keeps the opened score', async () => {
    answers.push(served('edited'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, 'pages', ENDPOINT, 'en'), {
      initialProps: { f: undefined as Record<string, unknown> | undefined },
    })
    // The form state has not arrived yet: nothing to compare with.
    expect(result.current.edited).toBe(false)
    rerender({ f: form('opened') })
    expect(result.current.edited).toBe(false)

    // Edited inside the debounce: the first answer is for the edited form, not the opened one.
    rerender({ f: form('changed') })
    await settle()
    expect(result.current.resolved).toBe(true)
    expect(result.current.edited).toBe(true)
    expect(urls).toHaveLength(1)

    // Back to the values as opened: no longer edited.
    rerender({ f: form('opened') })
    expect(result.current.edited).toBe(false)
  })

  it('keys the cache by locale, and asks the server for that locale', async () => {
    answers.push(served('english'), served('portuguese'))
    const { result, rerender } = renderHook(({ locale }) => useSidebarContent(form('same'), 'pages', ENDPOINT, locale), {
      initialProps: { locale: 'en' },
    })
    await settle()
    expect(result.current.content.robotsMeta).toBe('english')

    // Same values in another locale: not the English answer, and a request of its own
    rerender({ locale: 'pt' })
    expect(result.current.resolved).toBe(false)
    expect(result.current.content.robotsMeta).toBe('same')
    await settle()
    expect(result.current.content.robotsMeta).toBe('portuguese')
    expect(urls).toEqual([`${ENDPOINT}?locale=en`, `${ENDPOINT}?locale=pt`])

    // Back to English: cached per locale, no third request
    rerender({ locale: 'en' })
    await settle()
    expect(result.current.content.robotsMeta).toBe('english')
    expect(urls).toHaveLength(2)
  })
})
