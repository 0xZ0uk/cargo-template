import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_AI_MODEL, aiModel } from '../helpers/aiModel.js'
import { createSeoHealthHandler } from '../endpoints/health.js'

const admin = {
  user: { id: 1, collection: 'users', role: 'admin' },
  payload: {
    config: { admin: { user: 'users' } },
    find: async () => ({ docs: [] }),
    logger: { warn: () => {}, error: () => {} },
  },
}

const reportedModel = async (): Promise<string> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await createSeoHealthHandler('/seo-plugin')(admin as any)
  return ((await res.json()) as { config: { aiModel: string } }).config.aiModel
}

describe('AI model', () => {
  const saved = process.env.SEO_AI_MODEL
  afterEach(() => {
    if (saved === undefined) delete process.env.SEO_AI_MODEL
    else process.env.SEO_AI_MODEL = saved
  })

  it('defaults to Sonnet 4.6, and SEO_AI_MODEL overrides it', () => {
    delete process.env.SEO_AI_MODEL
    expect(aiModel()).toBe('claude-sonnet-4-6')
    process.env.SEO_AI_MODEL = 'claude-opus-4-8'
    expect(aiModel()).toBe('claude-opus-4-8')
  })

  it('the health endpoint reports the model the endpoints run', async () => {
    delete process.env.SEO_AI_MODEL
    expect(await reportedModel()).toBe(DEFAULT_AI_MODEL)
    process.env.SEO_AI_MODEL = 'claude-opus-4-8'
    expect(await reportedModel()).toBe('claude-opus-4-8')
  })
})
