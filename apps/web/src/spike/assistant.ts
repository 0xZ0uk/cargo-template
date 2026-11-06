/**
 * SPIKE (issue #59): throwaway. plugin-mcp tools through TanStack AI + OpenRouter, in the
 * same Worker as the logged-in admin user. Never merge.
 *
 * POST /api/assistant/spike  { action, ... }
 *   tools   → connect an MCP client to /api/mcp in-process, list tools, measure.
 *   chat    → chat() with the MCP client; SSE with memoryStream durability (join with
 *             Last-Event-ID + X-Run-Id). Pass `resume` to answer an approval interrupt.
 *   thread  → reconstructChat-style view of the memory persistence (pending interrupts).
 *   metrics → what the spike recorded for a runId (OpenRouter request size, usage, timings).
 */
import {
  chat,
  maxIterations,
  memoryStream,
  toServerSentEventsResponse,
  type StreamChunk,
} from '@tanstack/ai'
import { createMCPClient } from '@tanstack/ai-mcp'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { memoryPersistence, withPersistence } from '@tanstack/ai-persistence'
import { handleEndpoints, type Endpoint, type PayloadRequest } from 'payload'

import { waitUntil } from '#cloudflare-runtime'

const MODEL = 'deepseek/deepseek-v4.1-flash'

// Module-global: survives between requests only inside one isolate (fine for the spike).
const persistence = memoryPersistence()
const metrics = new Map<string, Record<string, unknown>>()

type McpCall = { ms: number; method: string; status: number }

/** A fetch that hands the MCP request to Payload's own router, in this isolate. */
function inProcessFetch(req: PayloadRequest, calls: McpCall[]): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input, init)
    let method = '?'
    const reqText = await request.clone().text().catch(() => '')
    try {
      method = JSON.parse(reqText)?.method ?? '?'
    } catch {}
    const t0 = performance.now()
    const response = await handleEndpoints({
      config: req.payload.config,
      path: new URL(request.url).pathname,
      request,
    })
    calls.push({ method, ms: Math.round(performance.now() - t0), status: response.status })
    if (response.status >= 400) {
      const h: Record<string, string> = {}
      request.headers.forEach((v, k) => (h[k] = k === 'cookie' ? '<redacted>' : v))
      console.log(
        JSON.stringify({
          spike: 'mcp-error',
          status: response.status,
          headers: h,
          body: reqText,
          response: await response.clone().text(),
        }),
      )
    }
    return response
  }
}

type Body = {
  action: 'chat' | 'metrics' | 'thread' | 'tools'
  /** Override the forwarded Origin: a string, or null to send none. Default: request origin. */
  origin?: null | string
  /** Temporarily set config.csrf for this request (to test the Origin check). */
  csrf?: string[]
  /** Skip forwarding the cookie (negative control). */
  noCookie?: boolean
  /** Keep the producer alive after a client disconnect with ctx.waitUntil. */
  detach?: boolean
  prompt?: string
  resume?: unknown[]
  runId?: string
  threadId?: string
}

async function connect(req: PayloadRequest, body: Body, calls: McpCall[]) {
  const url = new URL('/api/mcp', req.url!).toString()
  const headers: Record<string, string> = {}
  const cookie = req.headers.get('cookie')
  if (cookie && !body.noCookie) headers.Cookie = cookie
  const origin = body.origin === undefined ? new URL(req.url!).origin : body.origin
  if (origin) headers.Origin = origin
  const t0 = performance.now()
  const client = await createMCPClient({
    transport: { type: 'http', url, headers, fetch: inProcessFetch(req, calls) },
    needsApproval: (tool) => tool.annotations?.readOnlyHint !== true,
    // Drop tools the assistant doesn't need (smaller fixed prefix).
    toolFilter: (tool) => !/^(login|logout|me|unlock|forgotPassword|resetPassword|verify)/.test(tool.name),
  })
  return { client, connectMs: Math.round(performance.now() - t0) }
}

const json = (data: unknown, status = 200) => Response.json(data, { status })

async function handler(req: PayloadRequest): Promise<Response> {
  if (!req.user) return json({ error: 'log in first' }, 401)
  const body = ((await req.json?.()) ?? {}) as Body
  const savedCsrf = req.payload.config.csrf
  if (body.csrf) req.payload.config.csrf = body.csrf
  try {
    switch (body.action) {
      case 'tools':
        return await toolsAction(req, body)
      case 'chat':
        return await chatAction(req, body)
      case 'thread': {
        const threadId = body.threadId ?? ''
        const messages = await persistence.stores.messages.loadThread(threadId)
        const pending = await persistence.stores.interrupts?.listPending?.(threadId)
        return json({ messages, pending })
      }
      case 'metrics':
        return json(metrics.get(body.runId ?? '') ?? null)
      default:
        return json({ error: 'unknown action' }, 400)
    }
  } finally {
    if (body.csrf) req.payload.config.csrf = savedCsrf
  }
}

async function toolsAction(req: PayloadRequest, body: Body) {
  const calls: McpCall[] = []
  const { client, connectMs } = await connect(req, body, calls)
  try {
    const t0 = performance.now()
    const tools = await client.tools()
    const toolsMs = Math.round(performance.now() - t0)
    // What goes to the model per request: name + description + JSON schema per tool.
    const defs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }))
    const chars = JSON.stringify(defs).length
    return json({
      user: (req.user as { email?: string }).email,
      connectMs,
      toolsMs,
      mcpCalls: calls,
      count: tools.length,
      chars,
      tokensEst: Math.round(chars / 4),
      tools: tools.map((t) => ({
        name: t.name,
        needsApproval: t.needsApproval,
        readOnlyHint: t.metadata.mcp.annotations?.readOnlyHint,
        chars: JSON.stringify({ d: t.description, p: t.inputSchema }).length,
      })),
    })
  } finally {
    await client.close()
  }
}

async function chatAction(req: PayloadRequest, body: Body) {
  const threadId = body.threadId ?? crypto.randomUUID()
  const runId = body.runId ?? crypto.randomUUID()
  const request = req as unknown as Request
  const durability = memoryStream(request)
  const isJoin = durability.resumeFrom() !== null
  const m: Record<string, unknown> = { threadId, runId, isJoin, modelCalls: [] }
  if (!isJoin) metrics.set(runId, m)

  // A join replays from the log; chat() is lazy and never iterated, so don't connect MCP.
  if (isJoin) {
    return toServerSentEventsResponse((async function* () {})(), {
      durability: { adapter: durability },
    })
  }

  const calls: McpCall[] = []
  m.mcpCalls = calls
  const { client, connectMs } = await connect(req, body, calls)
  m.connectMs = connectMs

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return json({ error: 'no OPENROUTER_API_KEY' }, 500)

  const adapter = createOpenRouterText(MODEL, apiKey, {
    appTitle: 'cargo-template assistant spike',
    httpReferer: new URL(req.url!).origin,
  })

  const t0 = performance.now()
  const stream = chat({
    adapter,
    threadId,
    runId,
    messages: body.prompt ? [{ id: crypto.randomUUID(), role: 'user', content: body.prompt }] : [],
    ...(body.resume ? { resume: body.resume as never } : {}),
    systemPrompts: [
      'You are an assistant inside the Payload CMS admin. Use the tools to read and change content. ' +
        'When you call find, always pass `select` with only the fields you need and a small `limit`. ' +
        'Pages are in the collection with slug "pages"; their draft/published status field is `_status`. ' +
        'To change a page, call updateDocument with draft: true.',
    ],
    mcp: { clients: [client] },
    agentLoopStrategy: maxIterations(4),
    modelOptions: {
      // camelCase: the SDK serialises these to require_parameters / data_collection and
      // silently strips snake_case keys.
      provider: { requireParameters: true, dataCollection: 'deny' },
    } as never,
    reasoning: 'off' as never,
    middleware: [withPersistence(persistence as never)],
    // Capture what goes to OpenRouter (size of the tools array) and timings. Never the key.
    wrapFetch: (next) => async (input, init) => {
      const started = performance.now()
      let reqBody = ''
      try {
        reqBody = typeof init?.body === 'string' ? init.body : await new Request(input, init).clone().text()
      } catch {}
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(reqBody)
      } catch {}
      const res = await next(input, init)
      ;(m.modelCalls as unknown[]).push({
        atMs: Math.round(started - t0),
        status: res.status,
        bodyChars: reqBody.length,
        toolsChars: JSON.stringify(parsed.tools ?? []).length,
        toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
        provider: parsed.provider,
        reasoning: parsed.reasoning,
        messages: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
      })
      return res
    },
  })

  // Tap the stream: record tool calls, interrupts and usage.
  let finished: () => void = () => {}
  if (body.detach) {
    const done = new Promise<void>((resolve) => (finished = resolve))
    waitUntil?.(done)
    m.detach = Boolean(waitUntil)
  }
  const tapped = (async function* (): AsyncGenerator<StreamChunk> {
   try {
    const events: unknown[] = []
    m.events = events
    for await (const chunk of stream) {
      const c = chunk as Record<string, unknown>
      if (c.type === 'TOOL_CALL_START') events.push({ t: c.type, name: c.toolCallName ?? c.toolName })
      if (c.type === 'TOOL_CALL_END' || c.type === 'TOOL_CALL_RESULT')
        events.push({ t: c.type, name: c.toolCallName ?? c.toolName, result: String(c.result ?? c.content ?? '').slice(0, 300) })
      if (c.type === 'RUN_FINISHED') {
        m.outcome = c.outcome
        m.usage = c.usage
        m.totalMs = Math.round(performance.now() - t0)
      }
      if (c.type === 'RUN_ERROR') m.error = c.message ?? c.error
      yield chunk
    }
   } finally {
    finished()
   }
  })()

  return toServerSentEventsResponse(tapped, { durability: { adapter: durability } })
}

export const assistantSpikeEndpoint: Endpoint = {
  path: '/assistant/spike',
  method: 'post',
  handler,
}
