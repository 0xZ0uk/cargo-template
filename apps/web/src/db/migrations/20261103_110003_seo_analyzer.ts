import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`pages_focus_keywords\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`keyword\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`pages_focus_keywords_order_idx\` ON \`pages_focus_keywords\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`pages_focus_keywords_parent_id_idx\` ON \`pages_focus_keywords\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`_pages_v_version_focus_keywords\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`keyword\` text,
  	\`_uuid\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`_pages_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_pages_v_version_focus_keywords_order_idx\` ON \`_pages_v_version_focus_keywords\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`_pages_v_version_focus_keywords_parent_id_idx\` ON \`_pages_v_version_focus_keywords\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`seo_settings_ignored_slugs\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`seo_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_settings_ignored_slugs_order_idx\` ON \`seo_settings_ignored_slugs\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_ignored_slugs_parent_id_idx\` ON \`seo_settings_ignored_slugs\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`seo_settings_disabled_rules\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`seo_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_settings_disabled_rules_order_idx\` ON \`seo_settings_disabled_rules\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_disabled_rules_parent_idx\` ON \`seo_settings_disabled_rules\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`seo_settings_sitemap_excluded_slugs\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`seo_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_settings_sitemap_excluded_slugs_order_idx\` ON \`seo_settings_sitemap_excluded_slugs\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_sitemap_excluded_slugs_parent_id_idx\` ON \`seo_settings_sitemap_excluded_slugs\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`seo_settings_sitemap_priority_overrides\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`slug_pattern\` text NOT NULL,
  	\`priority\` numeric NOT NULL,
  	\`changefreq\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`seo_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_settings_sitemap_priority_overrides_order_idx\` ON \`seo_settings_sitemap_priority_overrides\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_sitemap_priority_overrides_parent_id_idx\` ON \`seo_settings_sitemap_priority_overrides\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`seo_settings\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`site_name\` text,
  	\`thresholds_title_length_min\` numeric,
  	\`thresholds_title_length_max\` numeric,
  	\`thresholds_meta_desc_length_min\` numeric,
  	\`thresholds_meta_desc_length_max\` numeric,
  	\`thresholds_min_words_generic\` numeric,
  	\`thresholds_min_words_post\` numeric,
  	\`thresholds_keyword_density_min\` numeric,
  	\`thresholds_keyword_density_max\` numeric,
  	\`thresholds_flesch_score_pass\` numeric,
  	\`thresholds_slug_max_length\` numeric,
  	\`sitemap_default_changefreq\` text DEFAULT 'weekly',
  	\`sitemap_default_priority\` numeric,
  	\`robots_custom_rules\` text,
  	\`breadcrumb_enabled\` integer DEFAULT true,
  	\`breadcrumb_home_label\` text DEFAULT 'Accueil',
  	\`breadcrumb_separator\` text DEFAULT '>',
  	\`breadcrumb_show_on_home\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_settings_updated_at_idx\` ON \`seo_settings\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_created_at_idx\` ON \`seo_settings\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`seo_settings_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`seo_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_settings_rels_order_idx\` ON \`seo_settings_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_rels_parent_idx\` ON \`seo_settings_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_rels_path_idx\` ON \`seo_settings_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_rels_users_id_idx\` ON \`seo_settings_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`seo_redirects\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`from\` text NOT NULL,
  	\`to\` text NOT NULL,
  	\`type\` text DEFAULT '301',
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_redirects_from_idx\` ON \`seo_redirects\` (\`from\`);`)
  await db.run(sql`CREATE INDEX \`seo_redirects_updated_at_idx\` ON \`seo_redirects\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`seo_redirects_created_at_idx\` ON \`seo_redirects\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`seo_redirects_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`seo_redirects\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`seo_redirects_rels_order_idx\` ON \`seo_redirects_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`seo_redirects_rels_parent_idx\` ON \`seo_redirects_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`seo_redirects_rels_path_idx\` ON \`seo_redirects_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`seo_redirects_rels_users_id_idx\` ON \`seo_redirects_rels\` (\`users_id\`);`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`is_cornerstone\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`pages\` ADD \`focus_keyword\` text;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` ADD \`version_is_cornerstone\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` ADD \`version_focus_keyword\` text;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`seo_settings_id\` integer REFERENCES seo_settings(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`seo_redirects_id\` integer REFERENCES seo_redirects(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_seo_settings_id_idx\` ON \`payload_locked_documents_rels\` (\`seo_settings_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_seo_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`seo_redirects_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`pages_focus_keywords\`;`)
  await db.run(sql`DROP TABLE \`_pages_v_version_focus_keywords\`;`)
  await db.run(sql`DROP TABLE \`seo_settings_ignored_slugs\`;`)
  await db.run(sql`DROP TABLE \`seo_settings_disabled_rules\`;`)
  await db.run(sql`DROP TABLE \`seo_settings_sitemap_excluded_slugs\`;`)
  await db.run(sql`DROP TABLE \`seo_settings_sitemap_priority_overrides\`;`)
  await db.run(sql`DROP TABLE \`seo_settings\`;`)
  await db.run(sql`DROP TABLE \`seo_settings_rels\`;`)
  await db.run(sql`DROP TABLE \`seo_redirects\`;`)
  await db.run(sql`DROP TABLE \`seo_redirects_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`pages_id\` integer,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`folders_id\` integer,
  	\`tags_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pages_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`folders_id\`) REFERENCES \`folders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "pages_id", "users_id", "media_id", "folders_id", "tags_id") SELECT "id", "order", "parent_id", "path", "pages_id", "users_id", "media_id", "folders_id", "tags_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_folders_id_idx\` ON \`payload_locked_documents_rels\` (\`folders_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tags_id_idx\` ON \`payload_locked_documents_rels\` (\`tags_id\`);`)
  await db.run(sql`ALTER TABLE \`pages\` DROP COLUMN \`is_cornerstone\`;`)
  await db.run(sql`ALTER TABLE \`pages\` DROP COLUMN \`focus_keyword\`;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` DROP COLUMN \`version_is_cornerstone\`;`)
  await db.run(sql`ALTER TABLE \`_pages_v\` DROP COLUMN \`version_focus_keyword\`;`)
}
