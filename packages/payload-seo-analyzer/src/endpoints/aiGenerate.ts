/**
 * Meta generation endpoint (the sidebar's "Generate meta").
 * Generates meta title + meta description from page content using heuristic extraction, in
 * English. No LLM call: the model-backed
 * suggestions are /ai-optimize ("Optimize with AI").
 */

import type { PayloadHandler } from 'payload'
import type { SeoConfig } from '../types.js'
import { generateMetaTitle, generateMetaDescription } from '../helpers/metaGeneration.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import { isSeoPanelUser } from '../helpers/isAdmin.js'

// ---------------------------------------------------------------------------
// Endpoint handler factory
// ---------------------------------------------------------------------------
export function createAiGenerateHandler(seoConfig?: SeoConfig): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Parse request body
      const body = await parseJsonBody(req)

      const title = typeof body.title === 'string' ? body.title : ''
      const focusKeyword = typeof body.focusKeyword === 'string' ? body.focusKeyword : undefined
      const content = typeof body.content === 'string' ? body.content : ''
      const slug = typeof body.slug === 'string' ? body.slug : ''

      if (!title && !content) {
        return Response.json(
          { error: 'At least title or content is required' },
          { status: 400 },
        )
      }

      const metaTitle = generateMetaTitle(title, focusKeyword, slug)
      const metaDescription = generateMetaDescription(content, focusKeyword, slug)

      return Response.json({ metaTitle, metaDescription })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] ai-generate error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
