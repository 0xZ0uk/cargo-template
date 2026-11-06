/**
 * Schema.org JSON-LD Auto-Generator endpoint.
 * Thin HTTP wrapper around the pure `buildJsonLd` helper (`helpers/buildSchema.ts`), so the
 * admin preview and the frontend `<JsonLd>` render use identical structured data.
 *
 * Auto-detects schema type from collection/content, with optional override.
 *
 * NOTE: Rate limiting is not handled by this plugin. The consuming application
 * should implement rate limiting via its own middleware.
 */

import type { PayloadHandler } from 'payload'
import type { SeoConfig } from '../types.js'
import { readAccessOpts } from '../helpers/readAccess.js'
import { buildJsonLd, SCHEMA_TYPES, serializeJsonLd, type SchemaType } from '../helpers/buildSchema.js'
import { requestOrigin, resolveSiteUrl } from '../helpers/siteUrl.js'
import { isSeoPanelUser } from '../helpers/isAdmin.js'
import { loadMergedConfig } from '../helpers/loadMergedConfig.js'

export function createSchemaGeneratorHandler(
  targetCollections?: string[],
  seoConfig?: SeoConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const url = new URL(req.url || '', 'http://localhost')
      const collection = url.searchParams.get('collection')
      const id = url.searchParams.get('id')
      const typeOverrideRaw = url.searchParams.get('type')

      if (!collection || !id) {
        return Response.json({ error: 'Missing required query params: collection, id' }, { status: 400 })
      }

      // Validate type override BEFORE casting to SchemaType
      if (typeOverrideRaw !== null && !SCHEMA_TYPES.includes(typeOverrideRaw as SchemaType)) {
        return Response.json(
          { error: `Invalid schema type. Valid types: ${SCHEMA_TYPES.join(', ')}` },
          { status: 400 },
        )
      }
      const typeOverride = (typeOverrideRaw as SchemaType | null) || undefined

      // Validate collection against allowed target collections
      if (targetCollections && !targetCollections.includes(collection)) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
      }

      // Fetch the document
      let doc: Record<string, unknown>
      try {
        const result = await req.payload.findByID({ collection, id, depth: 1, ...readAccessOpts(req) })
        doc = result as Record<string, unknown>
      } catch {
        return Response.json({ error: `Document not found: ${collection}/${id}` }, { status: 404 })
      }

      // The site name (the plugin option, or the one set in the SEO settings) is what a
      // `meta.title` suffix is stripped by when the document has no title of its own.
      const { config } = await loadMergedConfig(req.payload, seoConfig)
      // Without a configured site URL, use the request's origin (like /breadcrumb), never
      // buildJsonLd's localhost default: the output is meant to be pasted into the site.
      const { type, jsonLd, warnings } = buildJsonLd(doc, {
        collection,
        type: typeOverride,
        siteUrl: resolveSiteUrl(seoConfig?.siteUrl, requestOrigin(req)),
        collectionRoutes: seoConfig?.collectionRoutes,
        siteName: config.siteName,
        extractors: req.payload,
      })

      return Response.json({
        type,
        jsonLd,
        // Set when `type` isn't what was asked for (e.g. a FAQPage with no Q&A to build it from).
        warnings,
        html: `<script type="application/ld+json">${serializeJsonLd(jsonLd, 2)}</script>`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] schema-generator error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
