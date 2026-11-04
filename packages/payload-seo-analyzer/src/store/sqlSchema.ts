/**
 * Schema of the SQL data store, as ordered migrations.
 *
 * The plugin applies these itself (`migrateSeoStore`), lazily on the store's first use in
 * each isolate/process, and records them in `seo_store_migrations`. Rules for new entries:
 * - append only; never edit an applied migration;
 * - every statement must be safe to run twice (`IF NOT EXISTS`, `INSERT OR IGNORE`…):
 *   two isolates can start the same migration at once.
 *
 * SQLite dialect (D1, `node:sqlite`, better-sqlite3, libSQL).
 */

export interface SeoStoreMigration {
  id: string
  statements: string[]
}

export const SEO_STORE_MIGRATIONS: readonly SeoStoreMigration[] = [
  {
    id: '0001_init',
    statements: [
      `CREATE TABLE IF NOT EXISTS seo_score_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        level TEXT,
        focus_keyword TEXT,
        word_count INTEGER,
        checks_summary TEXT,
        snapshot_date TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS seo_score_history_doc_idx ON seo_score_history (collection, document_id, snapshot_date)`,
      `CREATE INDEX IF NOT EXISTS seo_score_history_date_idx ON seo_score_history (snapshot_date)`,

      `CREATE TABLE IF NOT EXISTS seo_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        query TEXT NOT NULL DEFAULT '',
        clicks REAL NOT NULL DEFAULT 0,
        impressions REAL NOT NULL DEFAULT 0,
        ctr REAL NOT NULL DEFAULT 0,
        position REAL NOT NULL DEFAULT 0,
        date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'csv',
        UNIQUE (url, query, date)
      )`,
      `CREATE INDEX IF NOT EXISTS seo_performance_date_idx ON seo_performance (date)`,

      `CREATE TABLE IF NOT EXISTS seo_rank_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        page TEXT,
        position REAL NOT NULL,
        clicks REAL,
        impressions REAL,
        ctr REAL,
        property TEXT,
        date_key TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        UNIQUE (query, date_key)
      )`,
      `CREATE INDEX IF NOT EXISTS seo_rank_history_date_idx ON seo_rank_history (snapshot_date)`,

      `CREATE TABLE IF NOT EXISTS seo_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT '404',
        count INTEGER NOT NULL DEFAULT 1,
        last_seen TEXT NOT NULL,
        referrer TEXT,
        user_agent TEXT,
        ignored INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS seo_logs_last_seen_idx ON seo_logs (last_seen)`,
      `CREATE INDEX IF NOT EXISTS seo_logs_count_idx ON seo_logs (count)`,
    ],
  },
]
