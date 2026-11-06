import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createLinkGraphHandler } from '../endpoints/linkGraph.js'
import { seoCache } from '../cache.js'

function makeReq(docs: Array<Record<string, unknown>>) {
  return {
    user: { id: 1 },
    url: 'http://localhost/api/seo/link-graph',
    payload: {
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
      find: vi.fn(async ({ collection }: { collection: string }) =>
        collection === 'pages' ? { docs, hasNextPage: false } : { docs: [], hasNextPage: false },
      ),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('/link-graph and noindex pages', () => {
  beforeEach(() => {
    seoCache.invalidate()
  })

  it('does not report a noindex page as an orphan', async () => {
    const res = await createLinkGraphHandler(['pages'])(
      makeReq([
        { id: 1, title: 'Home', slug: 'home' },
        { id: 2, title: 'Lost', slug: 'lost' },
        { id: 3, title: 'Thank you', slug: 'thank-you', noindex: true },
        { id: 4, title: 'Private pricing', slug: 'private-pricing', meta: { noindex: true } },
      ]),
    )
    const body = (await res.json()) as {
      nodes: Array<{ slug: string; isOrphan: boolean }>
      stats: { orphanCount: number }
    }
    const orphans = body.nodes.filter((n) => n.isOrphan).map((n) => n.slug)
    expect(orphans).toEqual(['lost'])
    expect(body.stats.orphanCount).toBe(1)
  })
})
