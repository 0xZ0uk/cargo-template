// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useTranslation: () => ({ i18n: { language: 'en' } }),
  useLocale: () => ({}),
}))

import { SeoView } from '../components/SeoView.js'
import { resetModalStub } from './helpers/payloadUiStub.js'

const page = {
  id: 1,
  title: 'Coffee',
  slug: 'coffee',
  collection: 'pages',
  score: 40,
  level: 'needs-work',
  status: 'published',
  focusKeyword: '',
  metaTitle: '',
  metaDescription: '',
  wordCount: 100,
  readabilityScore: 60,
  headingCount: 1,
  hasH1: true,
  h1Count: 1,
  internalLinkCount: 0,
  updatedAt: '2026-11-01T00:00:00.000Z',
  isCornerstone: false,
  contentLastReviewed: '',
  daysSinceUpdate: 1,
}

const auditBody = {
  results: [page],
  stats: {
    totalPages: 1,
    avgScore: 40,
    good: 0,
    needsWork: 1,
    critical: 0,
    noKeyword: 1,
    noMetaTitle: 1,
    noMetaDesc: 1,
    avgWordCount: 100,
    avgReadability: 60,
  },
  pagination: { page: 1, totalPages: 1 },
  cached: true,
  builtAt: Date.UTC(2026, 10, 3, 9, 30),
}

const proposal = {
  results: [
    {
      id: 1,
      collection: 'pages',
      title: 'Coffee',
      changed: true,
      before: { metaTitle: '', metaDescription: '', focusKeyword: '' },
      after: { metaTitle: 'Coffee brewing basics', metaDescription: 'Learn to brew better coffee.', focusKeyword: 'coffee' },
    },
  ],
  processed: 1,
  capped: false,
}

interface Apply {
  body: unknown
  release: () => void
}

/** Audit + proposal respond right away; the "apply" call waits until the test releases it. */
function stubFetch() {
  const applies: Apply[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/audit?')) return new Response(JSON.stringify(auditBody), { status: 200 })
      if (url.includes('/ai-optimize-bulk')) {
        const body = JSON.parse(String(init?.body))
        if (!body.apply) return new Response(JSON.stringify(proposal), { status: 200 })
        return new Promise<Response>((resolve) => {
          applies.push({ body, release: () => resolve(new Response(JSON.stringify({ applied: 1 }), { status: 200 })) })
        })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }),
  )
  return applies
}

async function openDialog() {
  render(<SeoView />)
  await screen.findByText('Coffee')
  expect(screen.queryByRole('dialog')).toBeNull()
  const trigger = screen.getByRole('button', { name: 'Optimize site' })
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(trigger)
  await screen.findByRole('dialog')
  return trigger
}

beforeEach(() => {
  resetModalStub()
})
afterEach(() => {
  cleanup()
  document.body.removeAttribute('tabindex')
  vi.unstubAllGlobals()
})

describe('bulk preview dialog (Payload DialogModal)', () => {
  it('is closed until a proposal comes back, then opens as a labelled dialog', async () => {
    stubFetch()
    await openDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Proposed meta corrections' })).toBeTruthy()
    // Its content is the before → after review.
    expect(screen.getByText('Coffee brewing basics')).toBeTruthy()
    expect(screen.getByText('Learn to brew better coffee.')).toBeTruthy()
    expect(screen.getByText('1 / 1')).toBeTruthy()
    const inDialog = within(dialog)
    expect(inDialog.getByRole('button', { name: 'Apply (1)' })).toBeTruthy()
    expect(inDialog.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })

  it('moves focus into the dialog', async () => {
    stubFetch()
    await openDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('hands focus back to the button that started the preview', async () => {
    stubFetch()
    render(<SeoView />)
    await screen.findByText('Coffee')
    const trigger = screen.getByRole('button', { name: 'Optimize site' }) as HTMLButtonElement
    await waitFor(() => expect(trigger.disabled).toBe(false))
    trigger.focus()
    fireEvent.click(trigger)
    // The trigger is disabled while the proposal loads, and a browser drops focus from a
    // button that becomes disabled: the dialog then opens with nothing to return focus to.
    expect(trigger.disabled).toBe(true)
    document.body.tabIndex = -1 // jsdom keeps focus on a disabled button; move it like a browser
    document.body.focus()
    expect(document.activeElement).toBe(document.body)
    await screen.findByRole('dialog')
    expect(trigger.disabled).toBe(false)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('closes with Escape and drops the proposal', async () => {
    stubFetch()
    await openDialog()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('Coffee brewing basics')).toBeNull()
  })

  it('closes with the header close button and with Cancel', async () => {
    stubFetch()
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Optimize site' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('reopens with a fresh proposal after being closed', async () => {
    stubFetch()
    await openDialog()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Optimize site' }))
    expect(await screen.findByText('Coffee brewing basics')).toBeTruthy()
  })

  it('applies the reviewed corrections (no second model call) and closes', async () => {
    const applies = stubFetch()
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Apply (1)' }))

    await waitFor(() => expect(applies).toHaveLength(1))
    expect(applies[0].body).toEqual({
      corrections: [
        {
          collection: 'pages',
          id: 1,
          metaTitle: 'Coffee brewing basics',
          metaDescription: 'Learn to brew better coffee.',
          focusKeyword: 'coffee',
        },
      ],
      apply: true,
      limit: 100,
    })

    await act(async () => {
      applies[0].release()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cannot be dismissed while the corrections are being written', async () => {
    const applies = stubFetch()
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Apply (1)' }))
    await waitFor(() => expect(applies).toHaveLength(1))

    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => {
      applies[0].release()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
