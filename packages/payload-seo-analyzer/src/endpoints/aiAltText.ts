/**
 * AI image alt-text (SEO 2026 + accessibility) — a vision model through OpenRouter.
 *
 *   GET  /alt-text-audit → list media missing alt text (admin)
 *   POST /ai-alt-text    → generate alt for one image (vision model), optionally apply (admin)
 *                          - { id, apply:false }                 → generate, return suggestion
 *                          - { id, apply:true, altText:"..." }   → write the provided text (no LLM call)
 *
 * Gated behind `features.aiFeatures`. The API key is read only from OPENROUTER_API_KEY (server
 * side). Model: see helpers/aiClient (SEO_AI_MODEL, must take image input).
 *
 * Image bytes come from Payload's own file route, run in-process (`handleEndpoints`), so they
 * are read from whatever storage the uploads collection uses (R2, local disk…) with the
 * caller's read access. Nothing goes over the network: on Workers a subrequest to the
 * Worker's own origin is unreliable. When that route has no file (media stored elsewhere),
 * the image is fetched server-side and must be on the site origin (the `siteUrl` option,
 * SITE_URL or the request's origin) or SEO_MEDIA_ORIGIN — SSRF-safe, consistent with the Core
 * Web Vitals endpoint.
 */
import { handleEndpoints } from 'payload'
import type { PayloadHandler, PayloadRequest } from 'payload'
import type { SeoConfig } from '../types.js'
import { resolveGscSiteUrl } from '../helpers/gscClient.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import { aiApiKey, aiChat, aiModel } from '../helpers/aiClient.js'
import { buildPayloadApiUrl, payloadApiRoute } from '../helpers/seoApiUrl.js'

const ALT_MAX = 125
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

const SUPPORTED_MIME: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
}

import { isSeoAdminRequest as isAdmin } from '../helpers/isAdmin.js'

/** Request headers that carry the caller's identity into the in-process file read. */
const FORWARDED_HEADERS = ['authorization', 'cookie']

/**
 * Reads an upload's file through Payload's `/<collection>/file/<filename>` route in-process,
 * as the caller. `null` when the route has no file for it (or refuses it).
 */
async function readUploadInProcess(
  req: PayloadRequest,
  collection: string,
  media: Record<string, unknown>,
): Promise<Uint8Array | null> {
  const filename = typeof media.filename === 'string' ? media.filename : ''
  if (!filename) return null

  const origin = req.url ? new URL(req.url).origin : 'http://localhost'
  const path = buildPayloadApiUrl(payloadApiRoute(req.payload), `/${collection}/file/${encodeURIComponent(filename)}`)
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers?.get(name)
    if (value) headers.set(name, value)
  }

  let res: Response
  try {
    res = await handleEndpoints({ config: req.payload.config, request: new Request(`${origin}${path}`, { headers }) })
  } catch (e) {
    req.payload.logger.warn(`[seo] ai-alt-text: in-process file read failed: ${e instanceof Error ? e.message : 'unknown'}`)
    return null
  }
  if (!res.ok) {
    await res.body?.cancel()
    return null
  }
  return new Uint8Array(await res.arrayBuffer())
}

/** Resolve an absolute, SSRF-checked image URL from a media doc. Returns null if not allowed. */
function resolveImageUrl(media: Record<string, unknown>, siteUrl: string | undefined): string | null {
  const raw = (typeof media.url === 'string' && media.url) || (typeof media.filename === 'string' ? `/media/${media.filename}` : '')
  if (!raw) return null

  let absolute: string
  if (/^https?:\/\//i.test(raw)) {
    absolute = raw
  } else if (siteUrl) {
    absolute = `${siteUrl.replace(/\/$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`
  } else {
    return null
  }

  // SSRF: only the site origin (or an explicit media origin) may be fetched.
  try {
    const target = new URL(absolute)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
    const allowed = new Set<string>()
    if (siteUrl) allowed.add(new URL(siteUrl).origin)
    if (process.env.SEO_MEDIA_ORIGIN) allowed.add(new URL(process.env.SEO_MEDIA_ORIGIN).origin)
    // If we have an allowlist, enforce it; otherwise (no siteUrl) refuse absolute external URLs.
    if (allowed.size > 0 && !allowed.has(target.origin)) return null
    if (allowed.size === 0) return null
    return target.toString()
  } catch {
    return null
  }
}

async function generateAltText(
  apiKey: string,
  model: string,
  base64: string,
  mediaType: string,
  language: string,
  context: { filename: string; title?: string },
): Promise<string | null> {
  const systemPrompt = `You write concise, descriptive image ALT text for accessibility and SEO.
Rules:
- Describe what is actually visible in the image.
- Maximum ${ALT_MAX} characters.
- Write in ${language === 'en' ? 'English' : 'French'}.
- Do NOT start with "image of", "photo of", "picture of" or similar.
- No quotes around the result. Return ONLY the alt text, nothing else.`

  const userText = `Filename: ${context.filename}${context.title ? `\nPage/context: ${context.title}` : ''}\nWrite the alt text for this image:`

  const raw = await aiChat({
    apiKey,
    model,
    system: systemPrompt,
    user: [
      { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
      { type: 'text', text: userText },
    ],
    maxTokens: 300,
  })
  const text = (raw || '').replace(/^["']|["']$/g, '').trim()
  if (!text) return null
  return text.length > ALT_MAX ? text.slice(0, ALT_MAX).trim() : text
}

// ---------------------------------------------------------------------------
// GET /alt-text-audit — media missing alt text
// ---------------------------------------------------------------------------
export function createAltTextAuditHandler(uploadsCollection: string): PayloadHandler {
  return async (req) => {
    try {
      if (!isAdmin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })

      const url = new URL(req.url as string)
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)))

      try {
        const missing = await req.payload.find({
          collection: uploadsCollection,
          where: { or: [{ alt: { exists: false } }, { alt: { equals: '' } }] },
          limit,
          depth: 0,
          overrideAccess: true,
        })
        const items = missing.docs.map((d) => ({
          id: d.id,
          filename: (d.filename as string) || '',
          url: (d.url as string) || '',
          mimeType: (d.mimeType as string) || '',
          alt: (d.alt as string) || '',
        }))
        return Response.json(
          { collection: uploadsCollection, missingCount: missing.totalDocs, items },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      } catch {
        // The uploads collection may not have an `alt` field — nothing to audit.
        return Response.json(
          { collection: uploadsCollection, missingCount: 0, items: [], note: 'no_alt_field' },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] alt-text-audit error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}

// ---------------------------------------------------------------------------
// POST /ai-alt-text — generate (vision model) and/or apply
// ---------------------------------------------------------------------------
export function createAiAltTextHandler(uploadsCollection: string, seoConfig?: SeoConfig): PayloadHandler {
  return async (req) => {
    try {
      if (!isAdmin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 })

      const body = await parseJsonBody(req)
      // The target collection is NOT taken from the body: `findByID` and
      // `update` below run with `overrideAccess: true`, so an arbitrary
      // `collection` turned this endpoint into a read-anything / write-`alt`-
      // anywhere primitive. Only the configured uploads collection is allowed;
      // the admin panel already round-trips exactly that value, so a mismatch
      // means the call did not come from the plugin UI.
      const collection = uploadsCollection
      if (typeof body.collection === 'string' && body.collection !== uploadsCollection) {
        return Response.json(
          { error: `Forbidden: collection must be "${uploadsCollection}"` },
          { status: 403 },
        )
      }
      const id = body.id != null ? String(body.id) : undefined
      const apply = body.apply === true
      const providedAlt = typeof body.altText === 'string' ? body.altText.trim() : undefined

      if (!id) return Response.json({ error: 'Missing required field: id' }, { status: 400 })

      // Fast path — apply a reviewed alt text without calling the model again.
      if (apply && providedAlt) {
        const alt = providedAlt.slice(0, ALT_MAX)
        await req.payload.update({ collection, id, data: { alt }, overrideAccess: true })
        return Response.json({ alt, applied: true, method: 'manual' })
      }

      const apiKey = aiApiKey()
      if (!apiKey) {
        return Response.json(
          { error: 'AI not configured. Set OPENROUTER_API_KEY to generate alt text.', code: 'no_api_key' },
          { status: 400 },
        )
      }

      let media: Record<string, unknown>
      try {
        media = (await req.payload.findByID({ collection, id, depth: 0, overrideAccess: true })) as Record<string, unknown>
      } catch {
        return Response.json({ error: `Media not found: ${collection}/${id}` }, { status: 404 })
      }

      const mime = (media.mimeType as string) || ''
      const mediaType = SUPPORTED_MIME[mime.toLowerCase()]
      if (!mediaType) {
        return Response.json(
          { error: `Unsupported image type for vision: ${mime || 'unknown'} (use JPEG, PNG, GIF or WebP).` },
          { status: 422 },
        )
      }

      // Image bytes: from Payload's file route in-process, else fetched (SSRF-checked).
      let bytes: Uint8Array
      try {
        const stored = await readUploadInProcess(req, collection, media)
        if (stored) {
          bytes = stored
        } else {
          const imageUrl = resolveImageUrl(media, resolveGscSiteUrl(seoConfig, req))
          if (!imageUrl) {
            return Response.json(
              { error: 'Could not resolve a safe image URL (must be on the site origin or SEO_MEDIA_ORIGIN).' },
              { status: 422 },
            )
          }
          const imgResp = await fetch(imageUrl)
          if (!imgResp.ok) throw new Error(`fetch ${imgResp.status}`)
          bytes = new Uint8Array(await imgResp.arrayBuffer())
        }
      } catch (e) {
        return Response.json({ error: `Could not fetch image: ${e instanceof Error ? e.message : 'error'}` }, { status: 502 })
      }
      if (bytes.byteLength === 0) {
        return Response.json({ error: 'Could not fetch image: empty file' }, { status: 502 })
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return Response.json({ error: 'Image too large for vision (max 5 MB).' }, { status: 413 })
      }
      const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')

      const model = aiModel()
      const language = seoConfig?.locale === 'en' ? 'en' : 'fr'

      let alt: string | null
      try {
        alt = await generateAltText(apiKey, model, base64, mediaType, language, {
          filename: (media.filename as string) || '',
          title: typeof body.context === 'string' ? body.context : undefined,
        })
      } catch (e) {
        req.payload.logger.error(`[seo] ai-alt-text AI error: ${e instanceof Error ? e.message : 'unknown'}`)
        return Response.json({ error: 'Alt-text generation failed.' }, { status: 502 })
      }

      if (!alt) {
        return Response.json({ error: 'The model did not return alt text (possibly declined).' }, { status: 502 })
      }

      let applied = false
      if (apply) {
        await req.payload.update({ collection, id, data: { alt }, overrideAccess: true })
        applied = true
      }

      return Response.json({ alt, applied, method: 'ai', model })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] ai-alt-text error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
