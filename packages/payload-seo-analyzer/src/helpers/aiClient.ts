/**
 * The LLM client behind the AI endpoints (optimize, bulk optimize, rewrite, alt text, content
 * brief), and the model the health endpoint reports: one definition, so the report cannot
 * drift from what runs.
 *
 * It speaks the OpenAI-compatible Chat Completions API of OpenRouter, so any model OpenRouter
 * routes to works. The default is DeepSeek V4.1 Flash: an open-weights model, served by many
 * providers, that takes image input (alt text) and supports structured outputs, at a fraction
 * of a cent per call.
 *
 * Environment (server side only; the key never comes from a request):
 * - `OPENROUTER_API_KEY`: required for AI answers. Without it the endpoints fall back to
 *   heuristics or answer `no_api_key`. Put a credit limit on the key in OpenRouter: that's the
 *   hard cap on spend (the plugin's rate limits only brake runaway clients).
 * - `SEO_AI_MODEL`: an OpenRouter model id. It must support structured outputs, and image
 *   input for alt text.
 * - `SEO_AI_BASE_URL`: OpenRouter's API, or a proxy of it such as Cloudflare AI Gateway's
 *   OpenRouter endpoint (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openrouter`).
 * - `SEO_AI_REASONING`: reasoning effort, `none` by default (these are short, well-specified
 *   tasks; reasoning only adds latency and cost). Set `low`… for a model that can't turn it off.
 * - `SEO_AI_DATA_COLLECTION`: `deny` by default, so OpenRouter only routes to providers that
 *   don't store or train on prompts (page content, drafts included). `allow` lifts that.
 */
import { fetchWithRetry } from './fetchWithRetry.js'

export const DEFAULT_AI_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_AI_MODEL = 'deepseek/deepseek-v4.1-flash'

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

// Declared-but-empty variables arrive as '' (varlock): treat them as unset.
const env = (name: string): string | undefined => process.env[name]?.trim() || undefined

export function aiApiKey(): string | undefined {
  return env('OPENROUTER_API_KEY')
}

export function aiModel(): string {
  return env('SEO_AI_MODEL') || DEFAULT_AI_MODEL
}

export function aiBaseUrl(): string {
  return (env('SEO_AI_BASE_URL') || DEFAULT_AI_BASE_URL).replace(/\/+$/, '')
}

export function aiReasoningEffort(): string {
  const effort = env('SEO_AI_REASONING')?.toLowerCase()
  return effort && REASONING_EFFORTS.has(effort) ? effort : 'none'
}

function aiDataCollection(): 'allow' | 'deny' {
  return env('SEO_AI_DATA_COLLECTION')?.toLowerCase() === 'allow' ? 'allow' : 'deny'
}

/**
 * The language the model must answer in: the site's analysis locale, named outright. Asking
 * for "the page's language" lets the model guess on thin content (a four-word page came back
 * with an Italian rationale).
 */
export function aiLanguageName(locale: string | undefined): 'English' | 'French' {
  return locale === 'en' ? 'English' : 'French'
}

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface AiChatOptions {
  apiKey: string
  model: string
  system: string
  user: string | AiContentPart[]
  /** Answer budget. Reasoning tokens count against it when reasoning is on. */
  maxTokens: number
  /**
   * JSON Schema the answer must follow (structured outputs, strict). Routing is then limited
   * to providers that support it; the caller still parses defensively.
   */
  schema?: { name: string; schema: Record<string, unknown> }
  timeoutMs?: number
}

/** A failed call (HTTP error or an error body). The message never contains the key. */
export class AiRequestError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
  }
}

const ERROR_BODY_MAX = 500

/** The request body for `/chat/completions`. Exported for tests. */
export function buildAiChatBody(opts: Omit<AiChatOptions, 'apiKey' | 'timeoutMs'>): Record<string, unknown> {
  const effort = aiReasoningEffort()
  return {
    model: opts.model,
    max_tokens: opts.maxTokens,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    reasoning: effort === 'none' ? { enabled: false } : { effort, exclude: true },
    ...(opts.schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema },
          },
        }
      : {}),
    provider: {
      data_collection: aiDataCollection(),
      ...(opts.schema ? { require_parameters: true } : {}),
    },
  }
}

interface ChatCompletion {
  error?: { message?: string; code?: number | string }
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null
      refusal?: string | null
    }
  }>
}

/**
 * Sends one chat completion and returns the answer's text, or `null` when there's no usable
 * answer: a refusal, a content filter, a cut-off answer, or empty content (for example a
 * reasoning model that spent the whole budget thinking). Throws `AiRequestError` on HTTP or
 * API errors.
 */
export async function aiChat(opts: AiChatOptions): Promise<string | null> {
  const { apiKey, timeoutMs, ...rest } = opts
  const response = await fetchWithRetry(
    `${aiBaseUrl()}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildAiChatBody(rest)),
    },
    timeoutMs ? { timeoutMs } : {},
  )

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, ERROR_BODY_MAX)
    throw new AiRequestError(`AI API error ${response.status}: ${body}`, response.status)
  }

  const data = (await response.json()) as ChatCompletion
  if (data.error) {
    const code = typeof data.error.code === 'number' ? data.error.code : undefined
    throw new AiRequestError(`AI API error: ${(data.error.message || 'unknown').slice(0, ERROR_BODY_MAX)}`, code)
  }

  return extractAiText(data)
}

/** The answer's text, or `null` when there's none to use. Exported for tests. */
export function extractAiText(data: ChatCompletion): string | null {
  const choice = data.choices?.[0]
  if (!choice?.message) return null
  // `length`: the answer was cut off (a truncated JSON object or alt text is no answer).
  const finish = choice.finish_reason
  if (choice.message.refusal || finish === 'content_filter' || finish === 'length') return null

  const content = choice.message.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
        : ''
  return text.trim() || null
}
