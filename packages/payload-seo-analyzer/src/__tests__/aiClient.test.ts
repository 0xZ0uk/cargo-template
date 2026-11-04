import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// /ai-alt-text reads the image through Payload's file route in-process.
const handleEndpoints = vi.hoisted(() => vi.fn())
vi.mock('payload', async (importOriginal) => ({ ...(await importOriginal<object>()), handleEndpoints }))
import {
  AiRequestError,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  aiBaseUrl,
  aiChat,
  aiModel,
  buildAiChatBody,
  extractAiText,
} from '../helpers/aiClient.js'
import { createSeoHealthHandler } from '../endpoints/health.js'
import { optimizeDocMeta } from '../endpoints/aiOptimize.js'
import { createAiAltTextHandler } from '../endpoints/aiAltText.js'
import { createAiOptimizeBulkHandler } from '../endpoints/aiOptimizeBulk.js'
import type { SeoConfig } from '../types.js'

const ENV_VARS = [
  'OPENROUTER_API_KEY',
  'SEO_AI_MODEL',
  'SEO_AI_BASE_URL',
  'SEO_AI_REASONING',
  'SEO_AI_DATA_COLLECTION',
  'SITE_URL',
  'SEO_MEDIA_ORIGIN',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name]
    delete process.env[name]
  }
})
afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  vi.restoreAllMocks()
})

/** A Chat Completions response with one choice. */
const completion = (content: unknown, extra: Record<string, unknown> = {}): Response =>
  Response.json({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }] })

const mockFetch = (...responses: Response[]) => {
  const spy = vi.spyOn(globalThis, 'fetch')
  for (const r of responses) spy.mockResolvedValueOnce(r)
  return spy
}

const sentBody = (spy: ReturnType<typeof mockFetch>, call = 0): Record<string, unknown> =>
  JSON.parse(String((spy.mock.calls[call][1] as RequestInit).body))

describe('AI client configuration', () => {
  it('defaults to DeepSeek V4.1 Flash on OpenRouter; env overrides, empty values do not', () => {
    expect(DEFAULT_AI_MODEL).toBe('deepseek/deepseek-v4.1-flash')
    expect(aiModel()).toBe(DEFAULT_AI_MODEL)
    expect(aiBaseUrl()).toBe(DEFAULT_AI_BASE_URL)

    process.env.SEO_AI_MODEL = ''
    process.env.SEO_AI_BASE_URL = '  '
    expect(aiModel()).toBe(DEFAULT_AI_MODEL)
    expect(aiBaseUrl()).toBe(DEFAULT_AI_BASE_URL)

    process.env.SEO_AI_MODEL = 'qwen/qwen3-vl'
    process.env.SEO_AI_BASE_URL = 'https://gateway.ai.cloudflare.com/v1/acc/gw/openrouter/'
    expect(aiModel()).toBe('qwen/qwen3-vl')
    expect(aiBaseUrl()).toBe('https://gateway.ai.cloudflare.com/v1/acc/gw/openrouter')
  })

  it('the health endpoint reports the model the endpoints run, and whether a key is set', async () => {
    const admin = {
      user: { id: 1, collection: 'users', role: 'admin' },
      payload: {
        config: { admin: { user: 'users' } },
        find: async () => ({ docs: [] }),
        logger: { warn: () => {}, error: () => {} },
      },
    }
    const report = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await createSeoHealthHandler('/seo-plugin')(admin as any)
      return (await res.json()) as { config: { aiModel: string; aiKey: boolean }; warnings: string[] }
    }

    let body = await report()
    expect(body.config).toMatchObject({ aiModel: DEFAULT_AI_MODEL, aiKey: false })
    expect(body.warnings.join(' ')).toContain('OPENROUTER_API_KEY')

    process.env.SEO_AI_MODEL = 'qwen/qwen3-vl'
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    body = await report()
    expect(body.config).toMatchObject({ aiModel: 'qwen/qwen3-vl', aiKey: true })
  })
})

describe('buildAiChatBody', () => {
  const base = { model: 'm', system: 'sys', user: 'hi', maxTokens: 100 }

  it('turns reasoning off and keeps prompts away from data-retaining providers by default', () => {
    expect(buildAiChatBody(base)).toEqual({
      model: 'm',
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      reasoning: { enabled: false },
      provider: { data_collection: 'deny' },
    })
  })

  it('maps SEO_AI_REASONING and SEO_AI_DATA_COLLECTION, ignoring unknown values', () => {
    process.env.SEO_AI_REASONING = 'LOW'
    process.env.SEO_AI_DATA_COLLECTION = 'allow'
    let body = buildAiChatBody(base)
    expect(body.reasoning).toEqual({ effort: 'low', exclude: true })
    expect(body.provider).toEqual({ data_collection: 'allow' })

    process.env.SEO_AI_REASONING = 'turbo'
    process.env.SEO_AI_DATA_COLLECTION = 'yes'
    body = buildAiChatBody(base)
    expect(body.reasoning).toEqual({ enabled: false })
    expect(body.provider).toEqual({ data_collection: 'deny' })
  })

  it('asks for strict structured output, routed only to providers that support it', () => {
    const schema = { type: 'object', properties: {}, required: [], additionalProperties: false }
    const body = buildAiChatBody({ ...base, schema: { name: 'x', schema } })
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'x', strict: true, schema } })
    expect(body.provider).toEqual({ data_collection: 'deny', require_parameters: true })
  })
})

describe('aiChat', () => {
  const opts = { apiKey: 'sk-or-secret', model: 'm', system: 's', user: 'u', maxTokens: 50 }

  it('posts to <base>/chat/completions with a bearer key and returns the trimmed text', async () => {
    const spy = mockFetch(completion('  Hello  '))
    expect(await aiChat(opts)).toBe('Hello')
    const [url, init] = spy.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init as RequestInit).method).toBe('POST')
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer sk-or-secret')
  })

  it('joins text parts when the content is an array', async () => {
    mockFetch(completion([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'no' }, { type: 'text', text: 'b' }]))
    expect(await aiChat(opts)).toBe('ab')
  })

  it('returns null for a refusal, a content filter, a cut-off or an empty answer', () => {
    expect(extractAiText({ choices: [{ message: { content: 'x', refusal: 'no' } }] })).toBeNull()
    expect(extractAiText({ choices: [{ finish_reason: 'content_filter', message: { content: 'x' } }] })).toBeNull()
    expect(extractAiText({ choices: [{ finish_reason: 'length', message: { content: '{"meta' } }] })).toBeNull()
    expect(extractAiText({ choices: [{ finish_reason: 'stop', message: { content: '  ' } }] })).toBeNull()
    expect(extractAiText({ choices: [{ finish_reason: 'stop', message: { content: null } }] })).toBeNull()
    expect(extractAiText({ choices: [] })).toBeNull()
  })

  it('throws AiRequestError with the status on an HTTP error, without the key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'No endpoints found', code: 404 } }), { status: 404 }),
    )
    const err = await aiChat(opts).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiRequestError)
    expect((err as AiRequestError).status).toBe(404)
    expect((err as Error).message).toContain('No endpoints found')
    expect((err as Error).message).not.toContain('sk-or-secret')
  })

  it('throws on an error body returned with a 200', async () => {
    mockFetch(Response.json({ error: { message: 'Provider returned error', code: 502 } }))
    await expect(aiChat(opts)).rejects.toThrow('Provider returned error')
  })
})

// ---------------------------------------------------------------------------
// Endpoints on the client
// ---------------------------------------------------------------------------

const page = {
  id: 7,
  title: 'Coffee brewing basics',
  slug: 'coffee-brewing',
  focusKeyword: '',
  meta: { title: '', description: '' },
  content: {
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'Pour-over, French press and espresso: how each method extracts coffee.' }],
        },
      ],
    },
  },
}

const payloadWith = (docs: Record<string, Record<string, unknown>>, update = vi.fn().mockResolvedValue({})) => ({
  config: { admin: { user: 'users' } },
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  find: vi.fn().mockResolvedValue({ docs: [] }),
  findByID: vi.fn(async ({ id }: { id: string }) => {
    const doc = docs[String(id)]
    if (!doc) throw new Error('not found')
    return doc
  }),
  update,
})

const config = { locale: 'en' } as SeoConfig

describe('optimizeDocMeta on the AI client', () => {
  it('sends the structured-output request and returns sanitized AI suggestions', async () => {
    const spy = mockFetch(
      completion(
        JSON.stringify({
          metaTitle: 'Coffee Brewing Basics: Pour-Over, French Press, Espresso',
          metaDescription: 'x '.repeat(120),
          focusKeyword: 'coffee brewing',
          rationale: ['Adds the keyword.'],
        }),
      ),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await optimizeDocMeta(payloadWith({ 7: page }) as any, {
      collection: 'pages',
      id: '7',
      mergedConfig: config,
      apiKey: 'sk-or-test',
    })

    expect(r).toMatchObject({ ok: true, method: 'ai', model: DEFAULT_AI_MODEL })
    expect(r.suggestions?.focusKeyword).toBe('coffee brewing')
    expect(r.suggestions!.metaDescription.length).toBeLessThanOrEqual(160)
    const body = sentBody(spy)
    expect(body.model).toBe(DEFAULT_AI_MODEL)
    expect((body.response_format as { json_schema: { name: string } }).json_schema.name).toBe('seo_meta_suggestions')
  })

  it('falls back to the heuristics when the API fails or gives no usable answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 401 }))
    const payload = payloadWith({ 7: page })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r = await optimizeDocMeta(payload as any, { collection: 'pages', id: '7', mergedConfig: config, apiKey: 'k' })
    expect(r.method).toBe('heuristic')
    expect(r.suggestions?.metaTitle).toBeTruthy()
    expect(payload.logger.error).toHaveBeenCalled()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion('{"metaTitle":"cut', { finish_reason: 'length' }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r = await optimizeDocMeta(payload as any, { collection: 'pages', id: '7', mergedConfig: config, apiKey: 'k' })
    expect(r.method).toBe('heuristic')
  })
})

describe('POST /ai-alt-text on the AI client', () => {
  const media = { id: 3, filename: 'beans.png', mimeType: 'image/png', url: '/api/media/file/beans.png', alt: '' }
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  const req = (payload: unknown, body: Record<string, unknown>, url = 'https://cms.example/api/seo-plugin/ai-alt-text') =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ user: { id: 1, collection: 'users', role: 'admin' }, url, json: async () => body, payload }) as any

  beforeEach(() => handleEndpoints.mockReset())

  it("reads the image through Payload's file route in-process, as the caller, and sends a data URL", async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    const spy = mockFetch(completion('"Roasted coffee beans in a burlap sack"'))
    handleEndpoints.mockResolvedValue(new Response(png, { headers: { 'Content-Type': 'image/png' } }))
    const r = req(payloadWith({ 3: media }), { id: 3 })
    r.headers = new Headers({ cookie: 'payload-token=abc', 'x-other': 'no' })

    const res = await createAiAltTextHandler('media', config)(r)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      alt: 'Roasted coffee beans in a burlap sack',
      applied: false,
      method: 'ai',
      model: DEFAULT_AI_MODEL,
    })
    const { request } = handleEndpoints.mock.calls[0][0] as { request: Request }
    expect(request.url).toBe('https://cms.example/api/media/file/beans.png')
    expect(request.headers.get('cookie')).toBe('payload-token=abc')
    expect(request.headers.get('x-other')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1) // the model call only: no network fetch of the image
    const user = (sentBody(spy).messages as Array<{ role: string; content: unknown }>)[1].content as Array<{
      type: string
      image_url?: { url: string }
    }>
    expect(user[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` } })
  })

  it("falls back to fetching the URL on the request origin when the file route has nothing", async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    handleEndpoints.mockResolvedValue(Response.json({ message: 'Not Found' }, { status: 404 }))
    const spy = mockFetch(new Response(png), completion('Coffee beans'))
    const res = await createAiAltTextHandler('media', config)(
      req(payloadWith({ 3: media }), { id: 3 }),
    )
    expect(res.status).toBe(200)
    expect(spy.mock.calls[0][0]).toBe('https://cms.example/api/media/file/beans.png')
  })

  it('refuses an image URL off the site origin', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    // Media stored elsewhere: the file route has nothing, so the URL is checked (refused here).
    handleEndpoints.mockResolvedValue(Response.json({ message: 'Not Found' }, { status: 404 }))
    const spy = vi.spyOn(globalThis, 'fetch')
    const res = await createAiAltTextHandler('media', config)(
      req(payloadWith({ 3: { ...media, url: 'https://evil.example/x.png' } }), { id: 3 }),
    )
    expect(res.status).toBe(422)
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers no_api_key without OPENROUTER_API_KEY', async () => {
    const res = await createAiAltTextHandler('media', config)(req(payloadWith({ 3: media }), { id: 3 }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('no_api_key')
  })
})

describe('POST /ai-optimize-bulk', () => {
  it('runs pages in parallel and keeps the request order in the results', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    let inFlight = 0
    let maxInFlight = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      const prompt = JSON.parse(String((init as RequestInit).body)).messages[1].content as string
      const title = /Page title: (.*)/.exec(prompt)?.[1] ?? ''
      return completion(JSON.stringify({ metaTitle: `AI ${title}`, metaDescription: 'd', focusKeyword: '', rationale: [] }))
    })
    const docs = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [String(i + 1), { ...page, id: i + 1, title: `Page ${i + 1}` }]),
    )
    const payload = payloadWith(docs)

    const res = await createAiOptimizeBulkHandler(['pages'], config)({
      user: { id: 1, collection: 'users', role: 'admin' },
      json: async () => ({ ids: ['pages::1', 'pages::2', 'pages::3', 'pages::4', 'pages::5', 'pages::6'] }),
      payload,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const body = (await res.json()) as { processed: number; results: Array<{ id: string; after: { metaTitle: string }; method: string }> }

    expect(body.processed).toBe(6)
    expect(body.results.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(body.results.map((r) => r.after.metaTitle)).toEqual(['AI Page 1', 'AI Page 2', 'AI Page 3', 'AI Page 4', 'AI Page 5', 'AI Page 6'])
    expect(body.results.every((r) => r.method === 'ai')).toBe(true)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })
})
