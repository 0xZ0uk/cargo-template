/**
 * AI Meta Rewrite endpoint.
 * Generates an optimized meta title or description using either:
 * - the LLM (OpenRouter, see helpers/aiClient) when OPENROUTER_API_KEY is set
 * - heuristic extraction otherwise, or when the model gives no usable answer
 *
 * Accepts: collection, id, field (title|description). The key never comes from the request.
 * Rate limited by the plugin (`ai-interactive` bucket).
 */

import type { PayloadHandler } from 'payload'
import type { SeoConfig } from '../types.js'
import { resolveAnalysisLocale } from '../helpers/resolveLocale.js'
import { readAccessOpts } from '../helpers/readAccess.js'
import { extractDocContent as extractDocContentHelper } from '../helpers/extractDocContent.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import { aiApiKey, aiChat, aiLanguageName, aiModel } from '../helpers/aiClient.js'
import {
  truncateWords,
  generateMetaTitle as heuristicTitle,
  generateMetaDescription as heuristicDescription,
} from '../helpers/metaGeneration.js'
import { isSeoPanelUser } from '../helpers/isAdmin.js'

// ---------------------------------------------------------------------------
// LLM call — `null` when there's no usable answer
// ---------------------------------------------------------------------------

async function callAiRewrite(
  apiKey: string,
  model: string,
  field: 'title' | 'description',
  pageTitle: string,
  pageContent: string,
  focusKeyword: string,
  locale: string | undefined,
): Promise<string | null> {
  const maxChars = field === 'title' ? 60 : 160
  const fieldLabel = field === 'title' ? 'meta title' : 'meta description'

  const systemPrompt = `You are an SEO expert. Generate an optimized ${fieldLabel} for a web page.
Rules:
- Maximum ${maxChars} characters
- Include the focus keyword naturally if provided
- Write in ${aiLanguageName(locale)}, whatever the language of the content
- Be compelling and click-worthy
- Do not use quotes around the result
- Return ONLY the ${fieldLabel} text, nothing else`

  const userPrompt = `Page title: ${pageTitle}
Focus keyword: ${focusKeyword || '(none)'}
Page content (first 2000 chars): ${pageContent.substring(0, 2000)}

Generate the optimized ${fieldLabel}:`

  const text = await aiChat({ apiKey, model, system: systemPrompt, user: userPrompt, maxTokens: 200 })
  if (!text) return null
  // Ensure it respects max length
  return truncateWords(text.replace(/^["']|["']$/g, '').trim(), maxChars) || null
}

// ---------------------------------------------------------------------------
// Extract text content from a document (delegates to shared helper)
// ---------------------------------------------------------------------------

function extractDocContent(doc: Record<string, unknown>): string {
  return extractDocContentHelper(doc).text
}

// ---------------------------------------------------------------------------
// Endpoint handler factory
// ---------------------------------------------------------------------------

export function createAiRewriteHandler(targetCollections?: string[], seoConfig?: SeoConfig): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const body = await parseJsonBody(req)

      const collection = typeof body.collection === 'string' ? body.collection.trim() : undefined
      const id =
        typeof body.id === 'string' || typeof body.id === 'number' ? String(body.id).trim() : undefined
      const field = (body.field as 'title' | 'description') || undefined

      if (!collection || !id || !field) {
        return Response.json(
          { error: 'Missing required fields: collection, id, field' },
          { status: 400 },
        )
      }

      if (field !== 'title' && field !== 'description') {
        return Response.json(
          { error: 'Field must be "title" or "description"' },
          { status: 400 },
        )
      }

      // Validate collection against allowed target collections
      if (targetCollections && !targetCollections.includes(collection)) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
      }

      // Fetch the document
      let doc: Record<string, unknown>
      try {
        const result = await req.payload.findByID({
          collection,
          id,
          depth: 1,
          ...readAccessOpts(req),
        })
        doc = result as Record<string, unknown>
      } catch {
        return Response.json({ error: `Document not found: ${collection}/${id}` }, { status: 404 })
      }

      const title = (doc.title as string) || ''
      const slug = (doc.slug as string) || ''
      const focusKeyword = (doc.focusKeyword as string) || ''
      const pageContent = extractDocContent(doc)

      const locale = resolveAnalysisLocale({
        reqLocale: req.locale as string | undefined,
        pluginLocale: seoConfig?.locale,
        customMapping: seoConfig?.localeMapping,
      })
      const heuristic = (): string =>
        field === 'title'
          ? heuristicTitle(title, focusKeyword, slug, locale)
          : heuristicDescription(pageContent, focusKeyword, slug, locale)

      let result: string | null = null
      let method: 'heuristic' | 'ai' = 'heuristic'

      // Read API key from environment variable (never from client request)
      const apiKey = aiApiKey()
      if (apiKey) {
        try {
          result = await callAiRewrite(apiKey, aiModel(), field, title, pageContent, focusKeyword, locale)
          if (result) method = 'ai'
        } catch (error) {
          req.payload.logger.error(`[seo] ai-rewrite AI API error: ${error instanceof Error ? error.message : 'unknown'}`)
        }
      }
      if (!result) result = heuristic()

      return Response.json({
        field,
        value: result,
        method,
        length: result.length,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] ai-rewrite error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
