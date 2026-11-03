import { describe, expect, it, vi } from 'vitest'
import { SeoCache, SeoSharedCache } from '../cache.js'
import { createAuditHandler } from '../endpoints/audit.js'
import { calculateFlesch } from '../helpers.js'
import { extractDocContent } from '../helpers/extractDocContent.js'

const TEXT =
  'The quick brown fox jumps over the lazy dog. It was a sunny day and the fox was happy. ' +
  'Readers like short sentences with simple words because they are easy to follow. '

const doc = {
  id: 1,
  slug: 'page',
  title: 'Page',
  _status: 'published',
  content: {
    root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: TEXT.repeat(3) }] }] },
  },
}
const readabilityText = extractDocContent(doc).readabilityText

async function auditReadability(locale: 'fr' | 'en'): Promise<number> {
  const background: Promise<unknown>[] = []
  const cache = new SeoSharedCache({ memory: new SeoCache(), waitUntil: (p) => void background.push(p) })
  const payload = {
    config: { admin: { user: 'users' } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    find: vi.fn(async (args: { collection: string }) =>
      args.collection === 'pages' ? { docs: [doc], hasNextPage: false } : { docs: [], hasNextPage: false },
    ),
    findGlobal: vi.fn(async () => null),
  }
  const handler = createAuditHandler(['pages'], { locale }, [], undefined, cache)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = { user: { id: 1, collection: 'users' }, url: 'http://localhost/api/seo-plugin/audit', payload } as any
  expect((await handler(req)).status).toBe(202)
  await Promise.all(background)
  const body = (await (await handler(req)).json()) as { results: Array<{ readabilityScore: number }> }
  return body.results[0].readabilityScore
}

describe('audit readability', () => {
  it('uses the English Flesch formula for an English site', async () => {
    const score = await auditReadability('en')
    expect(score).toBe(calculateFlesch(readabilityText, 'en'))
  })

  it('uses the French formula for a French site', async () => {
    const score = await auditReadability('fr')
    expect(score).toBe(calculateFlesch(readabilityText, 'fr'))
    expect(score).not.toBe(await auditReadability('en'))
  })
})
