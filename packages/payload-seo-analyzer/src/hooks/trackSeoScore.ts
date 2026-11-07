/**
 * SEO Score tracking hook.
 * Automatically records a score snapshot after each document save.
 *
 * Usage (in plugin.ts):
 *   collection.hooks.afterChange = [
 *     ...(collection.hooks?.afterChange || []),
 *     createTrackSeoScoreHook(seoConfig),
 *   ]
 */

import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from 'payload'
import type { SeoConfig } from '../types.js'
import { analyzeDocument } from '../helpers/analyzeDocument.js'
import type { SeoWaitUntil } from '../cache.js'
import { payloadStoreResolver, type SeoDataStoreResolver } from '../store/index.js'

/** Minimum interval between snapshots in milliseconds (1 hour) */
const RATE_LIMIT_MS = 60 * 60 * 1000


export interface TrackSeoScoreOptions {
  /** Where snapshots are stored (default: the `seo-score-history` collection). */
  resolveStore?: SeoDataStoreResolver
  /** Keeps the snapshot write alive after the response (Workers' `waitUntil`). */
  waitUntil?: SeoWaitUntil
}

/** True when the newest snapshot is under an hour old. */
async function tooSoon(resolveStore: SeoDataStoreResolver, req: { payload: Parameters<SeoDataStoreResolver>[0] }, collection: string, documentId: string) {
  const [last] = await resolveStore(req.payload).scoreHistory.list({ collection, documentId, limit: 1 })
  const lastDate = last?.snapshotDate ? new Date(last.snapshotDate).getTime() : 0
  return Date.now() - lastDate < RATE_LIMIT_MS
}

export function createTrackSeoScoreHook(seoConfig?: SeoConfig, options: TrackSeoScoreOptions = {}): CollectionAfterChangeHook {
  const resolveStore = options.resolveStore ?? payloadStoreResolver
  return async ({ doc, collection, req }) => {
    // Fire-and-forget — don't block the save
    const doTrack = async () => {
      try {
        const collectionSlug =
          typeof collection === 'string' ? collection : collection?.slug
        if (!collectionSlug || !doc?.id) return

        // Rate limit: at most one snapshot per document per hour.
        if (await tooSoon(resolveStore, req, collectionSlug, String(doc.id))) return

        // The saved document, scored with the dashboard's config (SeoSettings merged in),
        // or the history drifts from the scores shown everywhere else.
        const { input: seoInput, analysis } = await analyzeDocument(req, { collection: collectionSlug, doc }, { seoConfig })
        const wordCount = analysis.stats.wordCount

        // Compute checks summary
        const checksSummary = {
          pass: analysis.checks.filter((c) => c.status === 'pass').length,
          warning: analysis.checks.filter((c) => c.status === 'warning').length,
          fail: analysis.checks.filter((c) => c.status === 'fail').length,
        }

        // Save snapshot
        await resolveStore(req.payload).scoreHistory.insert({
          documentId: String(doc.id),
          collection: collectionSlug,
          score: analysis.score,
          level: analysis.level,
          focusKeyword: seoInput.focusKeyword || '',
          wordCount,
          checksSummary,
          snapshotDate: new Date().toISOString(),
        })

        // (Caches are invalidated by the dedicated hook in hooks/invalidateSeoCaches.ts,
        // which runs on every save regardless of this rate limit or of score history.)
      } catch (error) {
        // Fire-and-forget: log but never block the save
        req.payload.logger.error(`[seo] trackSeoScore error: ${error instanceof Error ? error.message : 'unknown'}`)
      }
    }

    // Don't block the save. On Workers, `waitUntil` keeps the write alive after the response.
    if (options.waitUntil) options.waitUntil(doTrack())
    else void doTrack()

    return doc
  }
}

/**
 * SEO Score tracking hook for Globals.
 * Same fire-and-forget pattern as the collection variant, but uses
 * `global.slug` and stores `collection: 'global:<slug>'` as discriminator.
 */
export function createTrackSeoScoreGlobalHook(seoConfig?: SeoConfig, options: TrackSeoScoreOptions = {}): GlobalAfterChangeHook {
  const resolveStore = options.resolveStore ?? payloadStoreResolver
  return async ({ doc, global, req }) => {
    // Fire-and-forget — don't block the save
    const doTrack = async () => {
      try {
        const globalSlug = global?.slug
        if (!globalSlug) return

        const discriminator = `global:${globalSlug}`

        // For globals there is no per-document id, use the slug as documentId
        const documentId = globalSlug

        // Rate limit: at most one snapshot per document per hour.
        if (await tooSoon(resolveStore, req, discriminator, documentId)) return

        const { input: seoInput, analysis } = await analyzeDocument(req, { global: globalSlug, doc }, { seoConfig })
        const wordCount = analysis.stats.wordCount

        // Compute checks summary
        const checksSummary = {
          pass: analysis.checks.filter((c) => c.status === 'pass').length,
          warning: analysis.checks.filter((c) => c.status === 'warning').length,
          fail: analysis.checks.filter((c) => c.status === 'fail').length,
        }

        // Save snapshot
        await resolveStore(req.payload).scoreHistory.insert({
          documentId,
          collection: discriminator,
          score: analysis.score,
          level: analysis.level,
          focusKeyword: seoInput.focusKeyword || '',
          wordCount,
          checksSummary,
          snapshotDate: new Date().toISOString(),
        })

        // (Caches are invalidated by the dedicated hook in hooks/invalidateSeoCaches.ts,
        // which runs on every save regardless of this rate limit or of score history.)
      } catch (error) {
        // Fire-and-forget: log but never block the save
        req.payload.logger.error(`[seo] trackSeoScoreGlobal error: ${error instanceof Error ? error.message : 'unknown'}`)
      }
    }

    // Don't block the save. On Workers, `waitUntil` keeps the write alive after the response.
    if (options.waitUntil) options.waitUntil(doTrack())
    else void doTrack()

    return doc
  }
}
