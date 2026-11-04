import { describe, it, expect } from 'vitest'
import { generateMetaDescription, generateMetaTitle } from '../helpers/metaGeneration.js'
import { createAiGenerateHandler } from '../endpoints/aiGenerate.js'

// The heuristic generator (/ai-generate, and the fallback of /ai-rewrite and /ai-optimize)
// used French templates only, so an English site got "Découvrez : Hello — Home".
const frWords = /Découvrez|Guide|Tout savoir|Conseils|Les clés|Consultez|Apprenez|Explorez/

describe('heuristic meta generation follows the locale', () => {
  const content = 'The pour-over method extracts coffee slowly and evenly. Grind size changes the cup a lot.'

  it('writes English templates for `en`', () => {
    const title = generateMetaTitle('Hello', undefined, 'hello', 'en')
    expect(title).toMatch(/^(Discover|Guide to|All about|Tips for|Keys to): Hello$/)
    const desc = generateMetaDescription(content, undefined, 'hello', 'en')
    expect(desc).not.toMatch(frWords)
    // The leading English article is dropped after the prefix.
    expect(desc).toMatch(/^(Discover|Read our guide to|All about|Learn how|Explore) pour-over method/)
  })

  it('keeps the French templates (and typography) by default and for `fr`', () => {
    expect(generateMetaTitle('Bonjour', undefined, 'hello')).toMatch(/ : Bonjour$/)
    expect(generateMetaTitle('Bonjour', undefined, 'hello', 'fr')).toMatch(frWords)
    expect(generateMetaDescription('', 'café', 'hello', 'fr')).toMatch(frWords)
  })

  it('/ai-generate uses the plugin locale', async () => {
    const res = await createAiGenerateHandler({ locale: 'en' })({
      user: { id: 1, collection: 'users' },
      json: async () => ({ title: 'Hello', content, slug: 'hello' }),
      payload: { config: { admin: { user: 'users' } }, logger: { error: () => {} } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const body = (await res.json()) as { metaTitle: string; metaDescription: string }
    expect(body.metaTitle).not.toMatch(frWords)
    expect(body.metaDescription).not.toMatch(frWords)
  })
})
