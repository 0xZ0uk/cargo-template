import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// A/B runs end instead of being deleted (@cargo/payload-plugin-ab): `endedAt` on
// `ab-experiments`. ADD / DROP COLUMN only, never a rebuild of `ab_experiments` (on D1 a
// rebuild runs the ON DELETE actions of the tables referencing it; see AGENTS.md). Existing
// rows are open runs, which is what they were.

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`ab_experiments\` ADD \`ended_at\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`ab_experiments\` DROP COLUMN \`ended_at\`;`)
}
