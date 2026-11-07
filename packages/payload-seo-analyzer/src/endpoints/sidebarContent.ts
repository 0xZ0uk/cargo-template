/**
 * POST <basePath>/sidebar-content: what the sidebar scores, read on the server.
 *
 * Body: `{ collection, data }` or `{ global, data }`, where `data` is the edit form's values
 * (form state reduced to a document). Query: `?locale=` like any Payload REST call.
 *
 * Returns `{ input, config }`:
 * - `input`: the full `SeoInput`. In form state, uploads, authors, `reference` links and
 *   reusable sections are plain IDs, and a collection's `extractContent` function only exists
 *   here. This endpoint populates `data` the way `/validate` reads a saved document
 *   (`depth: 1`, through Payload's own `afterRead` field traversal, so relations, rich-text
 *   uploads and internal links, field hooks and field read access all behave like a
 *   `findByID`), then maps it with `documentInput`, the mapping every server analysis uses.
 * - `config`: the effective config, `loadMergedConfig` as `/validate` loads it (the plugin's
 *   rules, weights, local-SEO slugs, site URL, routes and thresholds, with the saved settings
 *   on top), minus what can't travel as JSON (`clientSeoConfig`).
 *
 * The sidebar scores `analyzeSeo(input, config)`, which is what `/validate` computes for the
 * same values. It returns the input rather than the analysis so the sidebar can keep scoring
 * locally as the editor types (see `useSidebarContent`).
 *
 * Population always runs with the caller's access (`overrideAccess: false`): the IDs come
 * from the client, so a panel user can't read a document they couldn't open. Relations are
 * loaded through `req.payloadDataLoader`, which belongs to this request (batched, nothing
 * shared between requests).
 */
import {
  afterReadTraverseFields,
  getDataLoader,
  type JsonObject,
  type PayloadHandler,
  type SanitizedCollectionConfig,
  type SanitizedGlobalConfig,
} from 'payload'

import { documentInput, type DocumentTarget } from '../helpers/analyzeDocument.js'
import { isSeoPanelUser } from '../helpers/isAdmin.js'
import { loadMergedConfig } from '../helpers/loadMergedConfig.js'
import { parseJsonBody } from '../helpers/parseBody.js'
import { clientSeoConfig } from '../helpers/seoConfig.js'
import type { SeoConfig, SeoInput } from '../types.js'

/** What `/sidebar-content` answers. */
export interface SidebarContentResponse {
  input: SeoInput
  config: SeoConfig
}

/** Same depth as `/validate`'s `findByID`. */
const SIDEBAR_DEPTH = 1

/**
 * Populates `doc` in place like a `depth: 1` read: Payload's `afterRead` (not exported) is
 * this traversal plus the loop below that drains its promises.
 */
async function populateLikeRead(
  req: Parameters<PayloadHandler>[0],
  target: DocumentTarget,
  doc: JsonObject,
): Promise<JsonObject> {
  const collection: SanitizedCollectionConfig | null =
    'collection' in target ? (req.payload.collections[target.collection]?.config ?? null) : null
  const global: SanitizedGlobalConfig | null =
    'global' in target ? (req.payload.config.globals.find((g) => g.slug === target.global) ?? null) : null
  const fields = collection?.fields ?? global?.fields
  if (!fields) return doc
  if (!req.payloadDataLoader) req.payloadDataLoader = getDataLoader(req)

  const fieldPromises: Promise<void>[] = []
  const populationPromises: Promise<void>[] = []
  afterReadTraverseFields({
    collection,
    context: req.context ?? {},
    currentDepth: 1,
    depth: Math.min(SIDEBAR_DEPTH, req.payload.config.maxDepth ?? SIDEBAR_DEPTH),
    doc,
    draft: false,
    fallbackLocale: req.fallbackLocale ?? null,
    fieldDepth: 0,
    fieldPromises,
    fields,
    findMany: false,
    // The form already holds one locale's values: hoisting `{ [locale]: value }` would read
    // `layout.en` off the blocks array and drop it.
    flattenLocales: false,
    global,
    locale: req.locale ?? null,
    overrideAccess: false,
    parentIndexPath: '',
    parentIsLocalized: false,
    parentPath: '',
    parentSchemaPath: '',
    populationPromises,
    req,
    showHiddenFields: false,
    siblingDoc: doc,
  })

  let iterations = 0
  while (fieldPromises.length > 0 || populationPromises.length > 0) {
    await Promise.all(fieldPromises.splice(0, fieldPromises.length))
    await Promise.all(populationPromises.splice(0, populationPromises.length))
    if (++iterations >= 100) throw new Error('afterRead promise loop did not settle')
  }
  return doc
}

/** The populated form's input and the effective config, as `/validate` would use them. */
export async function readSidebarContent(
  req: Parameters<PayloadHandler>[0],
  target: DocumentTarget,
  data: JsonObject,
  seoConfig?: SeoConfig,
): Promise<SidebarContentResponse> {
  const [doc, { config }] = await Promise.all([
    populateLikeRead(req, target, data),
    loadMergedConfig(req.payload, seoConfig),
  ])
  return { input: documentInput(req.payload, doc, target, config), config: clientSeoConfig(config) }
}

export function createSidebarContentHandler(
  collections: string[],
  globals: string[] = [],
  seoConfig?: SeoConfig,
): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const body = await parseJsonBody(req)
      let target: DocumentTarget
      if (typeof body.global === 'string') {
        if (!globals.includes(body.global) || !req.payload.config.globals.some((g) => g.slug === body.global)) {
          return Response.json({ error: 'Global not allowed' }, { status: 403 })
        }
        target = { global: body.global }
      } else {
        const collection = typeof body.collection === 'string' ? body.collection : ''
        if (!collections.includes(collection) || !req.payload.collections[collection]) {
          return Response.json({ error: 'Collection not allowed' }, { status: 403 })
        }
        target = { collection }
      }
      const data = body.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return Response.json({ error: 'Missing data' }, { status: 400 })
      }
      return Response.json(await readSidebarContent(req, target, data as JsonObject, seoConfig))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] sidebar-content error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
