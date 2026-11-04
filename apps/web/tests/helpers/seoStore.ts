import { expect } from '@playwright/test'
import { cloudflareEnv } from '#cloudflare-runtime'

/**
 * The SEO analyzer keeps its time-series data in the second D1 database (`SEO_D1`), outside
 * Payload's collections, so deleting a page or a redirect doesn't remove what saving and
 * requesting it logged there. Specs call these to leave the local database as they found it.
 *
 * Two things about the local database: the plugin creates its tables on its first query, so on
 * a fresh one a spec that failed early may find none (nothing to clean, and it must not hide the
 * failure); and the dev server holds the same SQLite file open, so a write can hit
 * `SQLITE_BUSY` and is retried.
 */
const isMissingTable = (error: unknown) => /no such table/i.test(String((error as { cause?: unknown })?.cause ?? error))

const cleanUp = async (run: () => Promise<unknown>) => {
  await expect(async () => {
    try {
      await run()
    } catch (error) {
      if (!isMissingTable(error)) throw error
    }
  }).toPass({ timeout: 15_000 })
}

/** Drops the score snapshots that saving a document wrote (`scoreHistory`). */
export async function deleteScoreHistory(collection: string, documentId: number | string): Promise<void> {
  await cleanUp(() =>
    cloudflareEnv.SEO_D1.prepare('DELETE FROM seo_score_history WHERE collection = ? AND document_id = ?')
      .bind(collection, String(documentId))
      .run(),
  )
}

/** Drops the 404-log rows (`seoLogs`) that requesting these paths wrote. */
export async function deleteNotFoundLogs(paths: string[]): Promise<void> {
  const db = cloudflareEnv.SEO_D1
  await cleanUp(() =>
    db.batch(paths.map((path) => db.prepare('DELETE FROM seo_logs WHERE url = ?').bind(path.toLowerCase()))),
  )
}
