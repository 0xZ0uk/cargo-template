// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('@payloadcms/ui', async () => {
  const { payloadUiStub } = await import('./helpers/payloadUiStub.js')
  return { ...payloadUiStub, useLocale: () => ({}), useTranslation: () => ({ i18n: { language: 'en' } }) }
})

import { SitemapAuditView } from '../components/SitemapAuditView.js'

const auditBody = {
  orphanPages: [],
  weakPages: [],
  linkHubs: [],
  brokenLinks: [],
  stats: { totalPages: 1, totalLinks: 0, avgLinksPerPage: 0, orphanCount: 0, weakCount: 0, hubCount: 0, brokenCount: 0 },
}

const page = [{ title: 'Home', slug: 'home', collection: 'pages' }]
const r = (url: string, status: number, error?: string) => ({
  url,
  status,
  ok: status >= 200 && status < 300,
  ...(error && { error }),
  sourcePages: page,
})

/** `/external-links` answers with each body in turn (the last one repeats). */
function mockApi(externalBodies: unknown[], failOn: number[] = []) {
  let call = 0
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/external-links')) {
      const i = call++
      if (failOn.includes(i)) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => externalBodies[Math.min(i, externalBodies.length - 1)], init }
    }
    return { ok: true, status: 200, json: async () => (url.includes('/sitemap-audit') ? auditBody : { logs: [] }) }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = fn
  return fn
}

const externalPosts = (fn: ReturnType<typeof mockApi>) =>
  fn.mock.calls.filter(([u]) => String(u).includes('/external-links')).map(([, init]) => JSON.parse(String((init as RequestInit).body)))

async function openExternalTab() {
  fireEvent.click(await screen.findByRole('tab', { name: /external/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Scan external links' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mixed = {
  results: [
    r('https://a.example/gone', 404),
    r('https://b.example/', 0, 'timeout'),
    r('https://dead.example/', 0, 'dns'),
    r('https://internal.example/', 0, 'blocked-private-ip'),
    r('https://linkedin.example/in/x', 999),
    r('https://shop.example/', 429),
    r('https://ok.example/', 200),
  ],
  capped: false,
  totalFound: 7,
  maxLinks: 100,
  pending: 0,
  partial: false,
  subrequests: 20,
}

describe('External links tab', () => {
  it('shows one pill per bucket and they add up to the total', async () => {
    mockApi([mixed])
    render(<SitemapAuditView />)
    await openExternalTab()
    expect(await screen.findByText('7 total')).toBeTruthy()
    expect(screen.getByText('1 OK')).toBeTruthy()
    expect(screen.getByText('1 broken')).toBeTruthy()
    expect(screen.getByText('1 timeout')).toBeTruthy()
    expect(screen.getByText('1 unreachable')).toBeTruthy()
    expect(screen.getByText('1 blocked')).toBeTruthy()
    expect(screen.getByText("2 couldn't verify")).toBeTruthy()
    // No scan notice for a finished, uncapped scan.
    expect(screen.queryByRole('button', { name: /continue scan/i })).toBeNull()
    expect(screen.queryByText(/still pending/)).toBeNull()
    expect(screen.queryByText(/unique external links are checked/)).toBeNull()
  })

  it("lists 429 / 999 under 'Couldn't verify', not under Broken", async () => {
    mockApi([mixed])
    render(<SitemapAuditView />)
    await openExternalTab()
    await screen.findByText('7 total')

    fireEvent.click(screen.getByRole('button', { name: 'Broken' }))
    let table = screen.getByRole('table')
    expect(within(table).queryByText(/linkedin\.example/)).toBeNull()
    expect(within(table).queryByText(/shop\.example/)).toBeNull()
    expect(within(table).queryByText(/internal\.example/)).toBeNull()
    expect(within(table).getByText(/a\.example\/gone/)).toBeTruthy()
    expect(within(table).getByText(/dead\.example/)).toBeTruthy()
    expect(within(table).getByText(/b\.example/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: "Couldn't verify" }))
    table = screen.getByRole('table')
    expect(within(table).getByText(/linkedin\.example/)).toBeTruthy()
    expect(within(table).getByText(/shop\.example/)).toBeTruthy()
    expect(within(table).getByText(/internal\.example/)).toBeTruthy()
    expect(within(table).getByText('999')).toBeTruthy()
    expect(within(table).getByText('429')).toBeTruthy()
    expect(within(table).queryByText(/a\.example\/gone/)).toBeNull()
    expect(screen.getByText(/401, 403, 429, 451 or 999/)).toBeTruthy()
  })

  it('hides the unverified filter when nothing is unverified', async () => {
    mockApi([{ ...mixed, results: [r('https://ok.example/', 200), r('https://a.example/gone', 404)] }])
    render(<SitemapAuditView />)
    await openExternalTab()
    await screen.findByText('2 total')
    expect(screen.queryByRole('button', { name: "Couldn't verify" })).toBeNull()
    expect(screen.queryByText(/couldn't verify/)).toBeNull()
  })

  it('classifies a result cached before the buckets existed (no blocked/unverified in stats)', async () => {
    mockApi([{ results: [r('https://ok.example/', 200), r('https://x.example/', 429)], stats: { total: 2, ok: 1, broken: 1, timeout: 0 } }])
    render(<SitemapAuditView />)
    await openExternalTab()
    expect(await screen.findByText("1 couldn't verify")).toBeTruthy()
    expect(screen.getByText('0 broken')).toBeTruthy()
  })

  it('says when the list is capped (N of M)', async () => {
    mockApi([{ ...mixed, capped: true, totalFound: 148, maxLinks: 100 }])
    render(<SitemapAuditView />)
    await openExternalTab()
    expect(await screen.findByText('Only the first 100 of 148 unique external links are checked.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /continue scan/i })).toBeNull()
  })

  it('shows a partial scan with its pending count and the reason, and continues it from the button', async () => {
    const first = {
      results: [r('https://a.example/', 200), r('https://b.example/', 404), r('https://c.example/', 429)],
      capped: false,
      totalFound: 10,
      maxLinks: 100,
      pending: 7,
      partial: true,
      stoppedBy: 'budget',
      subrequests: 9,
    }
    const second = {
      ...first,
      results: [...first.results, r('https://d.example/', 200), r('https://e.example/', 200)],
      pending: 5,
      subrequests: 6,
    }
    const done = {
      ...first,
      results: [...second.results, ...Array.from({ length: 5 }, (_, i) => r(`https://z${i}.example/`, 200))],
      pending: 0,
      partial: false,
      stoppedBy: undefined,
    }
    const fn = mockApi([first, second, done])
    render(<SitemapAuditView />)
    await openExternalTab()

    expect(
      await screen.findByText(/3 of 10 links checked, 7 still pending\. This step stopped because it used its request budget\./),
    ).toBeTruthy()
    // The partial results are listed meanwhile.
    expect(screen.getByText('3 total')).toBeTruthy()
    expect(externalPosts(fn)).toEqual([{ forceRefresh: false }])

    fireEvent.click(screen.getByRole('button', { name: 'Continue scan' }))
    expect(await screen.findByText(/5 of 10 links checked, 5 still pending/)).toBeTruthy()
    expect(screen.getByText('5 total')).toBeTruthy()
    // Continuing is a plain resume: it never forces a rescan.
    expect(externalPosts(fn)).toEqual([{ forceRefresh: false }, { forceRefresh: false }])

    fireEvent.click(screen.getByRole('button', { name: 'Continue scan' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue scan' })).toBeNull())
    expect(screen.queryByText(/still pending/)).toBeNull()
    expect(screen.getByText('10 total')).toBeTruthy()
  })

  it('names a time-limited step, keeps the results and disables the button while continuing', async () => {
    const partial = {
      results: [r('https://a.example/', 200)],
      capped: true,
      totalFound: 30,
      maxLinks: 20,
      pending: 19,
      partial: true,
      stoppedBy: 'deadline',
      subrequests: 4,
    }
    let release: (v: unknown) => void = () => {}
    const gate = new Promise((res) => (release = res))
    let calls = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url.includes('/external-links')) {
        if (calls++ > 0) await gate
        return { ok: true, status: 200, json: async () => partial }
      }
      return { ok: true, status: 200, json: async () => (url.includes('/sitemap-audit') ? auditBody : { logs: [] }) }
    })
    render(<SitemapAuditView />)
    await openExternalTab()
    expect(await screen.findByText(/This step stopped because it ran out of time\./)).toBeTruthy()
    expect(screen.getByText('Only the first 20 of 30 unique external links are checked.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Continue scan' }))
    const busy = await screen.findByRole('button', { name: 'Continuing…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    // The results stay on screen while the next batch is checked.
    expect(screen.getByText('1 total')).toBeTruthy()
    release(undefined)
    expect(await screen.findByRole('button', { name: 'Continue scan' })).toBeTruthy()
  })

  it('keeps the results and offers to retry when a continue request fails', async () => {
    const partial = {
      results: [r('https://a.example/', 200)],
      capped: false,
      totalFound: 3,
      maxLinks: 100,
      pending: 2,
      partial: true,
      stoppedBy: 'budget',
      subrequests: 3,
    }
    mockApi([partial], [1])
    render(<SitemapAuditView />)
    await openExternalTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue scan' }))
    expect(await screen.findByText(/HTTP 500/)).toBeTruthy()
    expect(screen.getByText('1 total')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue scan' })).toBeTruthy()
  })

  it('exports every link that is not ok, with its state', async () => {
    mockApi([mixed])
    let text = ''
    const OrigBlob = globalThis.Blob
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).Blob = class extends OrigBlob {
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts)
        text = parts.map(String).join('')
      }
    }
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      render(<SitemapAuditView />)
      await openExternalTab()
      await screen.findByText('7 total')
      // The view's own export button is in the page header; this one is in the External card.
      const card = screen.getByRole('table').closest('.seo-card') ?? document.body
      fireEvent.click(within(card as HTMLElement).getAllByRole('button', { name: 'Export CSV' }).at(-1)!)
      const rows = text.trim().split('\n')
      expect(rows[0]).toContain('State')
      expect(rows).toHaveLength(7) // header + 6 not ok
      expect(text).toContain('unverified')
      expect(text).toContain('blocked')
    } finally {
      globalThis.Blob = OrigBlob
    }
  })
})
