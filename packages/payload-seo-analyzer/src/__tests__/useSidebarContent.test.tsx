// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { seoInputFromDoc } from '../helpers/seoInputFromDoc.js'
import { formStateToDoc } from '../helpers/sidebarContent.js'
import { SIDEBAR_CONTENT_DEBOUNCE_MS, useSidebarContent } from '../hooks/useSidebarContent.js'
import type { SeoConfig, SeoInput } from '../types.js'

const ENDPOINT = '/api/seo-plugin/sidebar-content'
const PAGES = { collection: 'pages' }

// Stable objects, as the admin's form state is between edits.
const forms = new Map<string, Record<string, unknown>>()
const form = (name: string) => {
  if (!forms.has(name)) forms.set(name, { 'meta.title': { value: `Title ${name}` }, 'meta.image': { value: 7 } })
  return forms.get(name)
}

interface Answer {
  ok: boolean
  body?: unknown
  throws?: boolean
}
let answers: Answer[]
let requests: Array<{ url: string; body: Record<string, unknown> }>

beforeEach(() => {
  vi.useFakeTimers()
  answers = []
  requests = []
  ;(globalThis as { fetch?: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
    requests.push({ url, body: JSON.parse(init?.body ?? '{}') })
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

/**
 * What the server answers for a form: its own mapping of the values (echoed fields unchanged)
 * with the meta image populated, and a config.
 */
const served = (name: string, image: string, config: SeoConfig = { disabledRules: ['social'] }): Answer => {
  const input: SeoInput = {
    ...seoInputFromDoc(formStateToDoc(form(name)), PAGES),
    metaImage: { url: `/${image}.png`, alt: image },
  }
  return { ok: true, body: JSON.parse(JSON.stringify({ input, config })) }
}
/** The meta image's alt once populated, else the form's ID. */
const imageAlt = (input: SeoInput) =>
  input.metaImage && typeof input.metaImage === 'object' ? (input.metaImage as { alt?: string }).alt : input.metaImage

describe('useSidebarContent', () => {
  it('scores the server input and config once they match the form', async () => {
    answers.push(served('a', 'populated'))
    const { result } = renderHook(() => useSidebarContent(form('a'), PAGES, ENDPOINT, 'en'))
    expect(result.current.resolved).toBe(false)
    expect(result.current.config).toBeNull()
    expect(result.current.input.metaImage).toBe(7) // the form's ID, before the server reads it
    await settle()
    expect(result.current.resolved).toBe(true)
    expect(result.current.input).toEqual((served('a', 'populated').body as { input: SeoInput }).input)
    expect(result.current.config).toEqual({ disabledRules: ['social'] })
    expect(requests[0].body).toEqual({ collection: 'pages', data: formStateToDoc(form('a')) })
  })

  it('keeps what the last answer populated while the next request is in flight; echoed fields follow the form', async () => {
    answers.push(served('a', 'first'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, PAGES, ENDPOINT, 'en'), {
      initialProps: { f: form('a') },
    })
    await settle()
    rerender({ f: form('b') })
    expect(result.current.resolved).toBe(false)
    expect(imageAlt(result.current.input)).toBe('first')
    expect(result.current.input.metaTitle).toBe('Title b')
  })

  it('reads the form as it is after a failed request, not the older answer; the config stays', async () => {
    answers.push(served('a', 'stale'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, PAGES, ENDPOINT, 'en'), {
      initialProps: { f: form('a') },
    })
    await settle()
    expect(imageAlt(result.current.input)).toBe('stale')

    // A non-2xx answer for the next edit
    answers.push({ ok: false })
    rerender({ f: form('b') })
    await settle()
    expect(result.current.resolved).toBe(false)
    expect(result.current.input.metaImage).toBe(7)
    expect(result.current.config).toEqual({ disabledRules: ['social'] })

    // A malformed answer counts as a failure too
    answers.push({ ok: true, body: { robotsMeta: 'old shape' } })
    rerender({ f: form('c') })
    await settle()
    expect(result.current.input.metaImage).toBe(7)

    // And a network error: still the form, never 'stale'
    answers.push(served('d', 'second'))
    rerender({ f: form('d') })
    await settle()
    expect(imageAlt(result.current.input)).toBe('second')
    answers.push({ ok: false, throws: true })
    rerender({ f: form('e') })
    await settle()
    expect(result.current.resolved).toBe(false)
    expect(result.current.input.metaImage).toBe(7)
  })

  it('does not treat an aborted request as a failure', async () => {
    answers.push(served('a', 'first'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, PAGES, ENDPOINT, 'en'), {
      initialProps: { f: form('a') },
    })
    await settle()
    // Edited again before the debounce fires: the answer stays until the new request answers.
    rerender({ f: form('b') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDEBAR_CONTENT_DEBOUNCE_MS / 2)
    })
    rerender({ f: form('c') })
    expect(imageAlt(result.current.input)).toBe('first')
  })

  it('asks once per form state, even when the form state object is a new reference', async () => {
    answers.push(served('a', 'once'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, PAGES, ENDPOINT, 'en'), {
      initialProps: { f: { ...form('a') } },
    })
    await settle()
    rerender({ f: { ...form('a') } })
    await settle()
    expect(requests).toHaveLength(1)
    expect(result.current.resolved).toBe(true)
  })

  it('reports an edit made before the first answer, so the sidebar keeps the opened score', async () => {
    answers.push(served('changed', 'edited'))
    const { result, rerender } = renderHook(({ f }) => useSidebarContent(f, PAGES, ENDPOINT, 'en'), {
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
    expect(requests).toHaveLength(1)

    // Back to the values as opened: no longer edited.
    rerender({ f: form('opened') })
    expect(result.current.edited).toBe(false)
  })

  it('keys the cache by locale, and asks the server for that locale', async () => {
    answers.push(served('same', 'english'), served('same', 'portuguese'))
    const { result, rerender } = renderHook(({ locale }) => useSidebarContent(form('same'), PAGES, ENDPOINT, locale), {
      initialProps: { locale: 'en' },
    })
    await settle()
    expect(imageAlt(result.current.input)).toBe('english')

    // Same values in another locale: not the English answer, and a request of its own
    rerender({ locale: 'pt' })
    expect(result.current.resolved).toBe(false)
    expect(result.current.input.metaImage).toBe(7)
    await settle()
    expect(imageAlt(result.current.input)).toBe('portuguese')
    expect(requests.map((r) => r.url)).toEqual([`${ENDPOINT}?locale=en`, `${ENDPOINT}?locale=pt`])

    // Back to English: cached per locale, no third request
    rerender({ locale: 'en' })
    await settle()
    expect(imageAlt(result.current.input)).toBe('english')
    expect(requests).toHaveLength(2)
  })

  it('reads a global as a global: no slug, and the server is asked for the global', async () => {
    const withSlug = { ...form('a'), slug: { value: 'home' } }
    const { result } = renderHook(() => useSidebarContent(withSlug, { global: 'home-page' }, ENDPOINT))
    expect(result.current.input.isGlobal).toBe(true)
    expect(result.current.input.slug).toBe('')
    await settle()
    expect(requests[0].body.global).toBe('home-page')
    expect(requests[0].body.collection).toBeUndefined()
  })
})
