import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_seo_settings\` (
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
  	\`breadcrumb_home_label\` text,
  	\`breadcrumb_separator\` text DEFAULT '>',
  	\`breadcrumb_show_on_home\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`INSERT INTO \`__new_seo_settings\`("id", "site_name", "thresholds_title_length_min", "thresholds_title_length_max", "thresholds_meta_desc_length_min", "thresholds_meta_desc_length_max", "thresholds_min_words_generic", "thresholds_min_words_post", "thresholds_keyword_density_min", "thresholds_keyword_density_max", "thresholds_flesch_score_pass", "thresholds_slug_max_length", "sitemap_default_changefreq", "sitemap_default_priority", "robots_custom_rules", "breadcrumb_enabled", "breadcrumb_home_label", "breadcrumb_separator", "breadcrumb_show_on_home", "updated_at", "created_at") SELECT "id", "site_name", "thresholds_title_length_min", "thresholds_title_length_max", "thresholds_meta_desc_length_min", "thresholds_meta_desc_length_max", "thresholds_min_words_generic", "thresholds_min_words_post", "thresholds_keyword_density_min", "thresholds_keyword_density_max", "thresholds_flesch_score_pass", "thresholds_slug_max_length", "sitemap_default_changefreq", "sitemap_default_priority", "robots_custom_rules", "breadcrumb_enabled", "breadcrumb_home_label", "breadcrumb_separator", "breadcrumb_show_on_home", "updated_at", "created_at" FROM \`seo_settings\`;`)
  await db.run(sql`DROP TABLE \`seo_settings\`;`)
  await db.run(sql`ALTER TABLE \`__new_seo_settings\` RENAME TO \`seo_settings\`;`)
  // This site's analysis locale is English, so a stored 'Accueil' is the old column default,
  // not a choice. Empty lets the plugin use the locale's label ("Home").
  await db.run(sql`UPDATE \`seo_settings\` SET \`breadcrumb_home_label\` = NULL WHERE \`breadcrumb_home_label\` = 'Accueil';`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`seo_settings_updated_at_idx\` ON \`seo_settings\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_created_at_idx\` ON \`seo_settings\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_seo_settings\` (
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
  await db.run(sql`INSERT INTO \`__new_seo_settings\`("id", "site_name", "thresholds_title_length_min", "thresholds_title_length_max", "thresholds_meta_desc_length_min", "thresholds_meta_desc_length_max", "thresholds_min_words_generic", "thresholds_min_words_post", "thresholds_keyword_density_min", "thresholds_keyword_density_max", "thresholds_flesch_score_pass", "thresholds_slug_max_length", "sitemap_default_changefreq", "sitemap_default_priority", "robots_custom_rules", "breadcrumb_enabled", "breadcrumb_home_label", "breadcrumb_separator", "breadcrumb_show_on_home", "updated_at", "created_at") SELECT "id", "site_name", "thresholds_title_length_min", "thresholds_title_length_max", "thresholds_meta_desc_length_min", "thresholds_meta_desc_length_max", "thresholds_min_words_generic", "thresholds_min_words_post", "thresholds_keyword_density_min", "thresholds_keyword_density_max", "thresholds_flesch_score_pass", "thresholds_slug_max_length", "sitemap_default_changefreq", "sitemap_default_priority", "robots_custom_rules", "breadcrumb_enabled", "breadcrumb_home_label", "breadcrumb_separator", "breadcrumb_show_on_home", "updated_at", "created_at" FROM \`seo_settings\`;`)
  await db.run(sql`DROP TABLE \`seo_settings\`;`)
  await db.run(sql`ALTER TABLE \`__new_seo_settings\` RENAME TO \`seo_settings\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`seo_settings_updated_at_idx\` ON \`seo_settings\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`seo_settings_created_at_idx\` ON \`seo_settings\` (\`created_at\`);`)
}
