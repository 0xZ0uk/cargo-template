/**
 * Applies the SEO analyzer's data-store schema to the SEO_D1 database ahead of time.
 *
 *   pnpm seo-store:migrate          # local D1 in .wrangler/state (dev, preview, tests)
 *   pnpm seo-store:migrate:remote   # the real database (part of `pnpm run deploy`)
 *
 * Optional: the store also applies pending migrations on its first query in each isolate.
 * Running it here keeps that off the first request after a deploy. Idempotent: applied
 * migrations are recorded in `seo_store_migrations`. The SQL lives in the plugin
 * (`SEO_STORE_MIGRATIONS`); this app adds no tables to the main D1 for these features.
 */
import { migrateSeoStore } from '@shipment/payload-seo-analyzer'

import { cloudflareEnv } from '#cloudflare-runtime'

const target = process.env.PAYLOAD_MIGRATE_REMOTE === 'true' ? 'remote' : 'local'

try {
  const applied = await migrateSeoStore(cloudflareEnv.SEO_D1)
  console.log(
    applied.length
      ? `[seo-store] ${target} SEO_D1: applied ${applied.join(', ')}`
      : `[seo-store] ${target} SEO_D1: up to date`,
  )
  process.exit(0)
} catch (error) {
  console.error(`[seo-store] ${target} SEO_D1: migration failed`, error)
  process.exit(1)
}
