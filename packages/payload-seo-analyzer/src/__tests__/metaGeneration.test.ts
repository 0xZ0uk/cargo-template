import { describe, it, expect } from 'vitest'
import { generateMetaDescription, generateMetaTitle } from '../helpers/metaGeneration.js'
import { createAiGenerateHandler } from '../endpoints/aiGenerate.js'

// The heuristic generator (/ai-generate, and the fallback of /ai-rewrite and /ai-optimize)
// writes English templates.
describe('heuristic meta generation', () => {
  const content = 'The pour-over method extracts coffee slowly and evenly. Grind size changes the cup a lot.'

  it('writes English templates', () => {
    const title = generateMetaTitle('Hello', undefined, 'hello')
    expect(title).toMatch(/^(Discover|Guide to|All about|Tips for|Keys to): Hello$/)
    const desc = generateMetaDescription(content, undefined, 'hello')
    // The leading English article is dropped after the prefix.
    expect(desc).toMatch(/^(Discover|Read our guide to|All about|Learn how|Explore) pour-over method/)
  })

  it('falls back to a prefixed keyword when there is no content', () => {
    expect(generateMetaDescription('', 'coffee', 'hello')).toMatch(
      /^(Discover|Read our guide to|All about|Learn how|Explore) coffee\.$/,
    )
  })

  it('/ai-generate writes English templates', async () => {
    const res = await createAiGenerateHandler()({
      user: { id: 1, collection: 'users' },
      json: async () => ({ title: 'Hello', content, slug: 'hello' }),
      payload: { config: { admin: { user: 'users' } }, logger: { error: () => {} } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const body = (await res.json()) as { metaTitle: string; metaDescription: string }
    expect(body.metaTitle).toMatch(/^(Discover|Guide to|All about|Tips for|Keys to): Hello$/)
    expect(body.metaDescription).toMatch(/^(Discover|Read our guide to|All about|Learn how|Explore) /)
  })
})
