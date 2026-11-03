// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', async () => (await import('./helpers/payloadUiStub.js')).payloadUiStub)

import { keywordUsageEditPath } from '../components/SeoAnalyzer.js'
import { createCheckKeywordHandler } from '../endpoints/checkKeyword.js'

describe('keyword usage links', () => {
  it('check-keyword returns the document id of every match', async () => {
    const find = vi.fn(async (args: { where: Record<string, unknown> }) =>
      'focusKeyword' in args.where
        ? { docs: [{ id: 42, title: 'Pricing', slug: 'pricing' }] }
        : { docs: [{ id: 42, title: 'Pricing', slug: 'pricing' }, { id: 7, title: 'Plans', slug: 'plans' }] },
    )
    const handler = createCheckKeywordHandler(['pages'], [])
    const res = await handler({
      user: { id: 1, collection: 'users' },
      url: 'http://localhost/api/seo-plugin/check-keyword?keyword=pricing',
      payload: { config: { admin: { user: 'users' } }, find, logger: { error: vi.fn() } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const body = (await res.json()) as { pages: Array<{ id: number; slug: string }> }
    expect(body.pages.map((p) => p.id)).toEqual([42, 7])
  })

  it('links collection documents by id and globals by slug', () => {
    expect(keywordUsageEditPath({ id: 42, collection: 'pages' })).toBe('/collections/pages/42')
    expect(keywordUsageEditPath({ collection: 'global:header' })).toBe('/globals/header')
  })
})
