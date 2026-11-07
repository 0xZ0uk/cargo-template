/**
 * SEO Validate endpoint handler.
 * Runs the full SEO engine (50+ checks) on a page or post.
 *
 * NOTE: Rate limiting is not handled by this plugin. The consuming application
 * should implement rate limiting via its own middleware (e.g., express-rate-limit,
 * Next.js middleware, or a reverse proxy like Nginx/Caddy).
 */

import type { PayloadHandler } from 'payload'
import { analyzeSeo } from '../index.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import type { SeoAnalysis, SeoInput, SeoConfig } from '../types.js'
import { isSeoPanelUser } from '../helpers/isAdmin.js'
import { loadMergedConfig } from '../helpers/loadMergedConfig.js'
import { analyzeDocument, type DocumentRef } from '../helpers/analyzeDocument.js'

export function createValidateHandler(
  _collections: string[],
  _globals: string[] = [],
  seoConfig?: SeoConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Load merged config from DB settings + plugin config
      const { config: mergedConfig } = await loadMergedConfig(req.payload, seoConfig)

      // GET — quick score check by ID
      if (req.method === 'GET') {
        const url = new URL(req.url as string)
        const id = url.searchParams.get('id')
        const collection = url.searchParams.get('collection') || 'pages'

        if (!id) {
          return Response.json({ error: 'Missing id parameter' }, { status: 400 })
        }

        // Validate collection against allowed target collections
        if (!_collections.includes(collection)) {
          return Response.json({ error: 'Collection not allowed' }, { status: 403 })
        }

        const globalSlug = url.searchParams.get('global')

        // Allowlist guard (IDOR): only the plugin's configured globals can be read.
        if (globalSlug && !_globals.includes(globalSlug)) {
          return Response.json({ error: 'Global not allowed' }, { status: 403 })
        }

        if (globalSlug) {
          const { analysis } = await analyzeDocument(req, { global: globalSlug }, { mergedConfig })
          return Response.json({
            global: globalSlug,
            score: analysis.score,
            level: analysis.level,
            failedChecks: analysis.checks.filter((c) => c.status === 'fail').map((c) => ({ id: c.id, label: c.label, message: c.message })),
            warningChecks: analysis.checks.filter((c) => c.status === 'warning').map((c) => ({ id: c.id, label: c.label, message: c.message })),
            passedChecks: analysis.checks.filter((c) => c.status === 'pass').length,
            totalChecks: analysis.checks.length,
          })
        }

        const { input: seoInput, analysis } = await analyzeDocument(req, { collection, id }, { mergedConfig })

        return Response.json({
          id,
          collection,
          slug: seoInput.slug,
          score: analysis.score,
          level: analysis.level,
          failedChecks: analysis.checks
            .filter((c) => c.status === 'fail')
            .map((c) => ({ id: c.id, label: c.label, message: c.message })),
          warningChecks: analysis.checks
            .filter((c) => c.status === 'warning')
            .map((c) => ({ id: c.id, label: c.label, message: c.message })),
          passedChecks: analysis.checks.filter((c) => c.status === 'pass').length,
          totalChecks: analysis.checks.length,
        })
      }

      // POST — full analysis with multiple modes
      const body = await parseJsonBody(req)
      const { id, collection, data, overrides, global: globalSlug } = body as {
        id?: number | string
        collection?: string
        data?: SeoInput
        overrides?: Partial<SeoInput>
        global?: string
      }

      let seoInput: SeoInput
      let analysis: SeoAnalysis

      if (data) {
        seoInput = { ...data, ...(overrides || {}) }
        analysis = analyzeSeo(seoInput, mergedConfig)
      } else {
        let ref: DocumentRef
        if (globalSlug) {
          // Allowlist guard (IDOR): only the plugin's configured globals can be read.
          if (!_globals.includes(globalSlug)) {
            return Response.json({ error: 'Global not allowed' }, { status: 403 })
          }
          ref = { global: globalSlug }
        } else if (id && collection) {
          // Validate collection against allowed target collections
          if (!_collections.includes(collection)) {
            return Response.json({ error: 'Collection not allowed' }, { status: 403 })
          }
          ref = { collection, id }
        } else {
          return Response.json(
            { error: 'Provide either { id, collection } or { data }' },
            { status: 400 },
          )
        }
        const result = await analyzeDocument(req, ref, { mergedConfig })
        seoInput = result.input
        analysis = result.analysis
        // Overrides change the input, so the document is scored again with them.
        if (overrides) {
          seoInput = { ...seoInput, ...overrides }
          analysis = analyzeSeo(seoInput, mergedConfig)
        }
      }

      return Response.json({
        score: analysis.score,
        level: analysis.level,
        checks: analysis.checks,
        input: {
          metaTitle: seoInput.metaTitle,
          metaDescription: seoInput.metaDescription,
          slug: seoInput.slug,
          focusKeyword: seoInput.focusKeyword,
          isPost: seoInput.isPost,
          isCornerstone: seoInput.isCornerstone,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] validate error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
