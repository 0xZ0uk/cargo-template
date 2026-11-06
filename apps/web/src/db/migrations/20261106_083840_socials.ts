import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`social_posts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`idempotency_key\` text NOT NULL,
  	\`source_hash\` text NOT NULL,
  	\`platform\` text NOT NULL,
  	\`source_kind\` text NOT NULL,
  	\`source_id\` text NOT NULL,
  	\`title\` text,
  	\`body\` text,
  	\`alt_text\` text,
  	\`image_url\` text,
  	\`link\` text,
  	\`destination_id\` text,
  	\`destination_label\` text,
  	\`destination_meta\` text,
  	\`status\` text DEFAULT 'queued' NOT NULL,
  	\`platform_publication_status\` text,
  	\`external_id\` text,
  	\`external_url\` text,
  	\`published_at\` text,
  	\`last_attempted_at\` text,
  	\`attempts\` numeric DEFAULT 0,
  	\`last_error\` text,
  	\`scheduled_at\` text,
  	\`queued_job_id\` text,
  	\`next_retry_at\` text,
  	\`published_by_id\` integer,
  	\`meta\` text,
  	\`insights_snapshot\` text,
  	\`insights_fetched_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`published_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`social_posts_idempotency_key_idx\` ON \`social_posts\` (\`idempotency_key\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_source_hash_idx\` ON \`social_posts\` (\`source_hash\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_platform_idx\` ON \`social_posts\` (\`platform\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_source_kind_idx\` ON \`social_posts\` (\`source_kind\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_source_id_idx\` ON \`social_posts\` (\`source_id\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_destination_id_idx\` ON \`social_posts\` (\`destination_id\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_status_idx\` ON \`social_posts\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_external_id_idx\` ON \`social_posts\` (\`external_id\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_scheduled_at_idx\` ON \`social_posts\` (\`scheduled_at\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_next_retry_at_idx\` ON \`social_posts\` (\`next_retry_at\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_published_by_idx\` ON \`social_posts\` (\`published_by_id\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_updated_at_idx\` ON \`social_posts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_created_at_idx\` ON \`social_posts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`social_posts_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`social_posts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`social_posts_rels_order_idx\` ON \`social_posts_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_rels_parent_idx\` ON \`social_posts_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_rels_path_idx\` ON \`social_posts_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`social_posts_rels_users_id_idx\` ON \`social_posts_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`social_templates_applies_to\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`social_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`social_templates_applies_to_order_idx\` ON \`social_templates_applies_to\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_applies_to_parent_idx\` ON \`social_templates_applies_to\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`social_templates\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`source_kind\` text DEFAULT 'page' NOT NULL,
  	\`is_default\` integer DEFAULT false,
  	\`description\` text,
  	\`enabled\` integer DEFAULT true,
  	\`templates_pinterest_title\` text,
  	\`templates_pinterest_description\` text,
  	\`templates_pinterest_alt_text\` text,
  	\`templates_pinterest_hashtags\` text,
  	\`templates_instagram_caption\` text,
  	\`templates_facebook_message\` text,
  	\`templates_gbp_summary\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`social_templates_name_idx\` ON \`social_templates\` (\`name\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_source_kind_idx\` ON \`social_templates\` (\`source_kind\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_is_default_idx\` ON \`social_templates\` (\`is_default\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_updated_at_idx\` ON \`social_templates\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_created_at_idx\` ON \`social_templates\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`social_templates_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`social_templates\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`social_templates_rels_order_idx\` ON \`social_templates_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_rels_parent_idx\` ON \`social_templates_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_rels_path_idx\` ON \`social_templates_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`social_templates_rels_users_id_idx\` ON \`social_templates_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`soc_conn_pin_scopes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`socials_connections\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`soc_conn_pin_scopes_order_idx\` ON \`soc_conn_pin_scopes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`soc_conn_pin_scopes_parent_id_idx\` ON \`soc_conn_pin_scopes\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`soc_conn_ig_scopes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`socials_connections\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`soc_conn_ig_scopes_order_idx\` ON \`soc_conn_ig_scopes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`soc_conn_ig_scopes_parent_id_idx\` ON \`soc_conn_ig_scopes\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`soc_conn_fb_scopes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`socials_connections\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`soc_conn_fb_scopes_order_idx\` ON \`soc_conn_fb_scopes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`soc_conn_fb_scopes_parent_id_idx\` ON \`soc_conn_fb_scopes\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`soc_conn_gbp_scopes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`value\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`socials_connections\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`soc_conn_gbp_scopes_order_idx\` ON \`soc_conn_gbp_scopes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`soc_conn_gbp_scopes_parent_id_idx\` ON \`soc_conn_gbp_scopes\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`socials_connections\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`pinterest_state_connected\` integer DEFAULT false,
  	\`pinterest_state_account_id\` text,
  	\`pinterest_state_account_label\` text,
  	\`pinterest_state_access_token_expires_at\` text,
  	\`pinterest_state_refresh_token_expires_at\` text,
  	\`pinterest_state_last_error\` text,
  	\`pinterest_state_last_refreshed_at\` text,
  	\`pinterest_access_token_version\` numeric DEFAULT 1,
  	\`pinterest_access_token_iv\` text,
  	\`pinterest_access_token_ciphertext\` text,
  	\`pinterest_access_token_auth_tag\` text,
  	\`pinterest_refresh_token_version\` numeric DEFAULT 1,
  	\`pinterest_refresh_token_iv\` text,
  	\`pinterest_refresh_token_ciphertext\` text,
  	\`pinterest_refresh_token_auth_tag\` text,
  	\`pinterest_extra\` text,
  	\`instagram_state_connected\` integer DEFAULT false,
  	\`instagram_state_account_id\` text,
  	\`instagram_state_account_label\` text,
  	\`instagram_state_access_token_expires_at\` text,
  	\`instagram_state_refresh_token_expires_at\` text,
  	\`instagram_state_last_error\` text,
  	\`instagram_state_last_refreshed_at\` text,
  	\`instagram_access_token_version\` numeric DEFAULT 1,
  	\`instagram_access_token_iv\` text,
  	\`instagram_access_token_ciphertext\` text,
  	\`instagram_access_token_auth_tag\` text,
  	\`instagram_refresh_token_version\` numeric DEFAULT 1,
  	\`instagram_refresh_token_iv\` text,
  	\`instagram_refresh_token_ciphertext\` text,
  	\`instagram_refresh_token_auth_tag\` text,
  	\`instagram_extra\` text,
  	\`facebook_state_connected\` integer DEFAULT false,
  	\`facebook_state_account_id\` text,
  	\`facebook_state_account_label\` text,
  	\`facebook_state_access_token_expires_at\` text,
  	\`facebook_state_refresh_token_expires_at\` text,
  	\`facebook_state_last_error\` text,
  	\`facebook_state_last_refreshed_at\` text,
  	\`facebook_access_token_version\` numeric DEFAULT 1,
  	\`facebook_access_token_iv\` text,
  	\`facebook_access_token_ciphertext\` text,
  	\`facebook_access_token_auth_tag\` text,
  	\`facebook_refresh_token_version\` numeric DEFAULT 1,
  	\`facebook_refresh_token_iv\` text,
  	\`facebook_refresh_token_ciphertext\` text,
  	\`facebook_refresh_token_auth_tag\` text,
  	\`facebook_extra\` text,
  	\`gbp_state_connected\` integer DEFAULT false,
  	\`gbp_state_account_id\` text,
  	\`gbp_state_account_label\` text,
  	\`gbp_state_access_token_expires_at\` text,
  	\`gbp_state_refresh_token_expires_at\` text,
  	\`gbp_state_last_error\` text,
  	\`gbp_state_last_refreshed_at\` text,
  	\`gbp_access_token_version\` numeric DEFAULT 1,
  	\`gbp_access_token_iv\` text,
  	\`gbp_access_token_ciphertext\` text,
  	\`gbp_access_token_auth_tag\` text,
  	\`gbp_refresh_token_version\` numeric DEFAULT 1,
  	\`gbp_refresh_token_iv\` text,
  	\`gbp_refresh_token_ciphertext\` text,
  	\`gbp_refresh_token_auth_tag\` text,
  	\`gbp_extra\` text,
  	\`last_boards_refresh_at\` text,
  	\`updated_at\` text,
  	\`created_at\` text
  );
  `)
  await db.run(sql`CREATE TABLE \`socials_connections_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`socials_connections\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`socials_connections_rels_order_idx\` ON \`socials_connections_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`socials_connections_rels_parent_idx\` ON \`socials_connections_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`socials_connections_rels_path_idx\` ON \`socials_connections_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`socials_connections_rels_users_id_idx\` ON \`socials_connections_rels\` (\`users_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`social_posts_id\` integer REFERENCES social_posts(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`social_templates_id\` integer REFERENCES social_templates(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_social_posts_id_idx\` ON \`payload_locked_documents_rels\` (\`social_posts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_social_templates_id_idx\` ON \`payload_locked_documents_rels\` (\`social_templates_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`social_posts\`;`)
  await db.run(sql`DROP TABLE \`social_posts_rels\`;`)
  await db.run(sql`DROP TABLE \`social_templates_applies_to\`;`)
  await db.run(sql`DROP TABLE \`social_templates\`;`)
  await db.run(sql`DROP TABLE \`social_templates_rels\`;`)
  await db.run(sql`DROP TABLE \`soc_conn_pin_scopes\`;`)
  await db.run(sql`DROP TABLE \`soc_conn_ig_scopes\`;`)
  await db.run(sql`DROP TABLE \`soc_conn_fb_scopes\`;`)
  await db.run(sql`DROP TABLE \`soc_conn_gbp_scopes\`;`)
  await db.run(sql`DROP TABLE \`socials_connections\`;`)
  await db.run(sql`DROP TABLE \`socials_connections_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`pages_id\` integer,
  	\`sections_id\` integer,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`folders_id\` integer,
  	\`tags_id\` integer,
  	\`seo_settings_id\` integer,
  	\`seo_redirects_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pages_id\`) REFERENCES \`pages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sections_id\`) REFERENCES \`sections\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`folders_id\`) REFERENCES \`folders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`seo_settings_id\`) REFERENCES \`seo_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`seo_redirects_id\`) REFERENCES \`seo_redirects\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "pages_id", "sections_id", "users_id", "media_id", "folders_id", "tags_id", "seo_settings_id", "seo_redirects_id") SELECT "id", "order", "parent_id", "path", "pages_id", "sections_id", "users_id", "media_id", "folders_id", "tags_id", "seo_settings_id", "seo_redirects_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pages_id_idx\` ON \`payload_locked_documents_rels\` (\`pages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_sections_id_idx\` ON \`payload_locked_documents_rels\` (\`sections_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_folders_id_idx\` ON \`payload_locked_documents_rels\` (\`folders_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tags_id_idx\` ON \`payload_locked_documents_rels\` (\`tags_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_seo_settings_id_idx\` ON \`payload_locked_documents_rels\` (\`seo_settings_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_seo_redirects_id_idx\` ON \`payload_locked_documents_rels\` (\`seo_redirects_id\`);`)
}
