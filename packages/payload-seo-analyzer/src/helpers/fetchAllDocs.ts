/**
 * Fetch all documents from target collections + globals in a uniform format.
 * Reused by audit, cannibalization, linkGraph, keywordResearch, etc.
 */

import type { Payload, SelectType } from 'payload'
import { isExcludedDoc, withExclusionSelect, type DocExclusion } from './excludeDocs.js'

export type DocSourceType = 'collection' | 'global'

export interface FetchedDoc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any
  sourceType: DocSourceType
  sourceSlug: string
}

export interface FetchAllDocsOptions {
  collections: string[]
  globals?: string[]
  /**
   * Hard cap on the TOTAL number of collection docs loaded into memory (across all
   * collections). Defaults to env `SEO_FETCH_MAX_DOCS` or 5000. Bounds memory while
   * paginating through everything below the cap (no silent 500-doc truncation).
   */
  maxDocs?: number
  /** @deprecated alias for `maxDocs` — kept for backwards compatibility. */
  limit?: number
  /** Depth for population (default: 1) */
  depth?: number
  /**
   * Restrict the fields read from the database, e.g. `{ title: true, meta: { description: true } }`
   * (see `buildSelect` for a projection limited to fields the collections have).
   * Callers that only need a few scalar fields should pass this: without it every
   * document is loaded whole, Lexical trees included.
   * Applied best-effort — see the select-less retry below.
   */
  select?: SelectType
  /**
   * The host's exclusion (`docExclusion(seoConfig)`): matching collection documents are left
   * out (they don't count against `maxDocs`), and `select` is widened to the fields it reads.
   */
  exclude?: DocExclusion
}

/** Page size for the internal paginated reads. */
const PAGE_SIZE = 200

/**
 * Fetch all documents from the specified collections and globals.
 * Returns a unified array of { doc, sourceType, sourceSlug }.
 *
 * Paginates through every page (up to `maxDocs`) instead of a single capped
 * `find({ limit, pagination: false })` — the old behaviour silently dropped docs
 * beyond 500, producing false "orphan"/"broken link" results on larger sites.
 */
export async function fetchAllDocs(
  payload: Payload,
  options: FetchAllDocsOptions,
): Promise<FetchedDoc[]> {
  const { collections, globals = [], depth = 1, exclude } = options
  const maxDocs = options.maxDocs ?? options.limit ?? (Number(process.env.SEO_FETCH_MAX_DOCS) || 5000)
  const results: FetchedDoc[] = []
  let reachedCap = false

  // Fetch from collections (paginated)
  for (const collectionSlug of collections) {
    if (reachedCap) break
    const select = withExclusionSelect(payload, [collectionSlug], options.select, exclude)
    try {
      let page = 1
      let hasNextPage = true
      while (hasNextPage && !reachedCap) {
        let result
        try {
          try {
            result = await payload.find({
              collection: collectionSlug,
              limit: PAGE_SIZE,
              page,
              depth,
              overrideAccess: true,
              ...(select ? { select } : {}),
            })
          } catch (selectErr) {
            // A `select` naming a field this collection does not have would make
            // the whole collection look absent (the outer catch swallows page-1
            // errors), silently dropping it from the analysis. Retry without the
            // projection rather than lose the documents.
            if (!select) throw selectErr
            payload.logger?.warn(
              `[seo] fetchAllDocs: select rejected on « ${collectionSlug} », retrying without projection.`,
            )
            result = await payload.find({
              collection: collectionSlug,
              limit: PAGE_SIZE,
              page,
              depth,
              overrideAccess: true,
            })
          }
        } catch (err) {
          // An error on page 1 means "collection missing" — the tolerated case, handled
          // by the outer catch. An error on page 2 or later is something else: the
          // collection exists, documents were already read, and pagination breaks midway.
          //
          // The outer catch used to swallow both alike. The partial result then came back
          // as if it were complete — and the analyses built on it (orphan pages, broken
          // links, cannibalization) flagged as problematic documents that were simply
          // never loaded. A wrong report is worse than no report: people act on it.
          if (page === 1) throw err
          payload.logger?.error(
            `[seo] fetchAllDocs: pagination interrupted on "${collectionSlug}" at page ${page} (${results.length} documents already read). INCOMPLETE result — analyses unreliable for this collection. ${err instanceof Error ? err.message : err}`,
          )
          break
        }
        for (const doc of result.docs) {
          if (isExcludedDoc(exclude, doc, collectionSlug)) continue
          results.push({ doc, sourceType: 'collection', sourceSlug: collectionSlug })
          if (results.length >= maxDocs) {
            reachedCap = true
            break
          }
        }
        hasNextPage = !!result.hasNextPage
        page++
      }
    } catch {
      // Collection might not exist — skip
    }
  }

  if (reachedCap) {
    payload.logger?.warn(
      `[seo] fetchAllDocs reached the ${maxDocs}-doc cap — results may be incomplete. Raise it via SEO_FETCH_MAX_DOCS.`,
    )
  }

  // Fetch from globals
  for (const globalSlug of globals) {
    try {
      const doc = await payload.findGlobal({
        slug: globalSlug,
        depth,
        overrideAccess: true,
      })
      if (doc) {
        results.push({ doc, sourceType: 'global', sourceSlug: globalSlug })
      }
    } catch {
      // Global might not exist — skip
    }
  }

  return results
}
