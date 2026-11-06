/**
 * POST <basePath>/sidebar-content: the sidebar's content, read on the server.
 *
 * Body: `{ collection, data }`, where `data` is the edit form's values (form state reduced
 * to a document). Query: `?locale=` like any Payload REST call.
 *
 * In form state, uploads, `reference` links and reusable sections are plain IDs, and a
 * collection's `extractContent` function only exists here. This endpoint populates `data`
 * the way `/validate` reads a saved document (`depth: 1`, through Payload's own `afterRead`
 * field traversal, so relations, rich-text uploads and internal links, field hooks and field
 * read access all behave like a `findByID`), then maps it with `contentInputFromDoc`, the
 * mapping `buildSeoInputFromDoc` uses. The sidebar merges the result into its input, so the
 * live score sees what `/validate` sees.
 *
 * Population always runs with the caller's access (`overrideAccess: false`): the IDs come
 * from the client, so a panel user can't read a document they couldn't open. Relations are
 * loaded through `req.payloadDataLoader`, which belongs to this request (batched, nothing
 * shared between requests).
 */
import { afterReadTraverseFields, getDataLoader, type JsonObject, type PayloadHandler } from 'payload'

import { contentInputFromDoc, type DocContentInput } from '../helpers/docContentInput.js'
import { isSeoPanelUser } from '../helpers/isAdmin.js'
import { parseJsonBody } from '../helpers/parseBody.js'

/** Same depth as `/validate`'s `findByID`. */
const SIDEBAR_DEPTH = 1

/**
 * Populates `doc` in place like a `depth: 1` read: Payload's `afterRead` (not exported) is
 * this traversal plus the loop below that drains its promises.
 */
async function populateLikeRead(
  req: Parameters<PayloadHandler>[0],
  collectionSlug: string,
  doc: JsonObject,
): Promise<JsonObject> {
  const collection = req.payload.collections[collectionSlug]?.config
  if (!collection) return doc
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
    fields: collection.fields,
    findMany: false,
    // The form already holds one locale's values: hoisting `{ [locale]: value }` would read
    // `layout.en` off the blocks array and drop it.
    flattenLocales: false,
    global: null,
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

/**
 * What the sidebar needs from the populated document. When a collection extractor ran, the
 * raw `blocks` are left out: `blockContent` replaces them and they would double the payload.
 */
export async function readSidebarContent(
  req: Parameters<PayloadHandler>[0],
  collection: string,
  data: JsonObject,
): Promise<DocContentInput> {
  const doc = await populateLikeRead(req, collection, data)
  const content = contentInputFromDoc(doc, collection, { extractors: req.payload })
  return content.blockContent ? { ...content, blocks: undefined } : content
}

export function createSidebarContentHandler(collections: string[]): PayloadHandler {
  return async (req) => {
    try {
      if (!isSeoPanelUser(req)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const body = await parseJsonBody(req)
      const collection = typeof body.collection === 'string' ? body.collection : ''
      if (!collections.includes(collection) || !req.payload.collections[collection]) {
        return Response.json({ error: 'Collection not allowed' }, { status: 403 })
      }
      const data = body.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return Response.json({ error: 'Missing data' }, { status: 400 })
      }
      return Response.json(await readSidebarContent(req, collection, data as JsonObject))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      req.payload.logger.error(`[seo] sidebar-content error: ${message}`)
      return Response.json({ error: message }, { status: 500 })
    }
  }
}
