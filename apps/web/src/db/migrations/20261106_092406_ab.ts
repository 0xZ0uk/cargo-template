import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// A/B testing (@cargo/payload-plugin-ab): the `ab-manifest` and `ab-experiments` collections,
// and `_abVariantOf` / `_abPassPercentage` on pages and their versions.
//
// Hand-edited from `migrate:create`:
// - The new columns are added with ALTER TABLE … ADD, never a rebuild of `pages` / `_pages_v`
//   (on D1 a rebuild runs the ON DELETE actions of every table referencing them; see AGENTS.md).
// - Drizzle drops the ON DELETE clause from ADD COLUMN … REFERENCES. The snapshot has
//   `set null` for `_abvariantof_id` (and `cascade` for the locked-documents columns); without
//   it D1, which enforces foreign keys, refuses to delete an original page that has variants.
// - `down` drops the columns and indexes instead of rebuilding the tables.

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`ab_manifest\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`variants\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`ab_manifest_key_idx\` ON \`ab_manifest\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`ab_manifest_updated_at_idx\` ON \`ab_manifest\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`ab_manifest_created_at_idx\` ON \`ab_manifest\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`ab_manifest_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`ab_manifest\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`ab_manifest_rels_order_idx\` ON \`ab_manifest_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`ab_manifest_rels_parent_idx\` ON \`ab_manifest_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`ab_manifest_rels_path_idx\` ON \`ab_manifest_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`ab_manifest_rels_users_id_idx\` ON \`ab_manifest_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`ab_experiments\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`manifest_key\` text NOT NULL,
  	\`parent_doc_id\` text NOT NULL,
  	\`parent_collection\` text NOT NULL,
  	\`locale\` text,
  	\`started_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`ab_experiments_manifest_key_idx\` ON \`ab_experiments\` (\`manifest_key\`);`)
  await db.run(sql`CREATE INDEX \`ab_experiments_updated_at_idx\` ON \`ab_experiments\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`ab_experiments_created_at_idx\` ON \`ab_experiments\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`ab_experiments_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`ab_experiments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`ab_experiments_rels_order_idx\` ON \`ab_experiments_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`ab_experiments_rels_parent_idx\` ON \`ab_experiments_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`ab_experiments_rels_path_idx\` ON \`ab_experiments_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`ab_experiments_rels_users_id_idx\` ON \`ab_experiments_rels\` (\`users_id\`);`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`_abpasspercentage\` numeric;`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`_abvariantof_id\` integer REFERENCES pages(id) ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`pages__abvariantof_idx\` ON \`pages\` (\`_abvariantof_id\`);`)
  await db.run(sql`ALTER TABLE \`_pages_v\` ADD \`version__abpasspercentage\` numeric;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` ADD \`version__abvariantof_id\` integer REFERENCES pages(id) ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_version__abvariantof_idx\` ON \`_pages_v\` (\`version__abvariantof_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`ab_manifest_id\` integer REFERENCES ab_manifest(id) ON DELETE cascade;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`ab_experiments_id\` integer REFERENCES ab_experiments(id) ON DELETE cascade;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ab_manifest_id_idx\` ON \`payload_locked_documents_rels\` (\`ab_manifest_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ab_experiments_id_idx\` ON \`payload_locked_documents_rels\` (\`ab_experiments_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`payload_locked_documents_rels_ab_experiments_id_idx\`;`)
  await db.run(sql`DROP INDEX \`payload_locked_documents_rels_ab_manifest_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`ab_experiments_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`ab_manifest_id\`;`)
  await db.run(sql`DROP INDEX \`_pages_v_version_version__abvariantof_idx\`;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` DROP COLUMN \`version__abvariantof_id\`;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` DROP COLUMN \`version__abpasspercentage\`;`)
  await db.run(sql`DROP INDEX \`pages__abvariantof_idx\`;`)
  await db.run(sql`ALTER TABLE \`pages\` DROP COLUMN \`_abvariantof_id\`;`)
  await db.run(sql`ALTER TABLE \`pages\` DROP COLUMN \`_abpasspercentage\`;`)
  await db.run(sql`DROP TABLE \`ab_experiments_rels\`;`)
  await db.run(sql`DROP TABLE \`ab_experiments\`;`)
  await db.run(sql`DROP TABLE \`ab_manifest_rels\`;`)
  await db.run(sql`DROP TABLE \`ab_manifest\`;`)
}
