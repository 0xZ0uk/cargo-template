import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

// Gives the document-lock references the ON DELETE the schema snapshot already has (#120).
//
// Drizzle drops the ON DELETE clause from `ALTER TABLE … ADD x_id integer REFERENCES …`, so the
// lock columns added that way (`pages_id`, `sections_id`, `seo_settings_id`, `seo_redirects_id`,
// `social_posts_id`, `social_templates_id`) were created without `ON DELETE cascade`. D1 enforces
// foreign keys, so deleting a document that is open in the admin (its edit lock row points at it)
// fails instead of removing the lock. The snapshot is unchanged: it always said `cascade`.
//
// SQLite can't alter a constraint, so the table is rebuilt. `payload_locked_documents_rels` is a
// leaf (no table references it), so dropping it runs no ON DELETE actions and nothing has to be
// copied aside (see AGENTS.md on D1 table rebuilds). Columns are listed by name because databases
// differ in column order (ALTER TABLE appends; some local databases were rebuilt earlier).

const TABLE = 'payload_locked_documents_rels'

// [column, referenced table] in the snapshot's order. `parent_id` is NOT NULL.
const REFERENCES: [string, string][] = [
  ['parent_id', 'payload_locked_documents'],
  ['pages_id', 'pages'],
  ['sections_id', 'sections'],
  ['users_id', 'users'],
  ['media_id', 'media'],
  ['folders_id', 'folders'],
  ['tags_id', 'tags'],
  ['seo_settings_id', 'seo_settings'],
  ['seo_redirects_id', 'seo_redirects'],
  ['ab_manifest_id', 'ab_manifest'],
  ['ab_experiments_id', 'ab_experiments'],
  ['social_posts_id', 'social_posts'],
  ['social_templates_id', 'social_templates'],
]

// The columns that had no ON DELETE on a database migrated from scratch. `down` puts them back
// that way, as the previous migrations left them.
const ADDED_WITHOUT_ON_DELETE = new Set([
  'pages_id',
  'sections_id',
  'seo_settings_id',
  'seo_redirects_id',
  'social_posts_id',
  'social_templates_id',
])

const COLUMNS = ['id', 'order', 'path', ...REFERENCES.map(([column]) => column)]

async function rebuild(db: MigrateUpArgs['db'], withOnDelete: (column: string) => boolean) {
  const foreignKeys = REFERENCES.map(
    ([column, target]) =>
      `FOREIGN KEY (\`${column}\`) REFERENCES \`${target}\`(\`id\`) ON UPDATE no action` +
      (withOnDelete(column) ? ' ON DELETE cascade' : ''),
  )
  const columnList = COLUMNS.map((column) => `"${column}"`).join(', ')

  await db.run(sql.raw(`DROP TABLE IF EXISTS \`__new_${TABLE}\`;`))
  await db.run(
    sql.raw(`CREATE TABLE \`__new_${TABLE}\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
${REFERENCES.slice(1)
  .map(([column]) => `  	\`${column}\` integer,`)
  .join('\n')}
${foreignKeys.map((fk) => `  	${fk}`).join(',\n')}
  );`),
  )
  await db.run(
    sql.raw(
      `INSERT INTO \`__new_${TABLE}\`(${columnList}) SELECT ${columnList} FROM \`${TABLE}\`;`,
    ),
  )
  await db.run(sql.raw(`DROP TABLE \`${TABLE}\`;`))
  await db.run(sql.raw(`ALTER TABLE \`__new_${TABLE}\` RENAME TO \`${TABLE}\`;`))

  await db.run(sql.raw(`CREATE INDEX \`${TABLE}_order_idx\` ON \`${TABLE}\` (\`order\`);`))
  await db.run(sql.raw(`CREATE INDEX \`${TABLE}_parent_idx\` ON \`${TABLE}\` (\`parent_id\`);`))
  await db.run(sql.raw(`CREATE INDEX \`${TABLE}_path_idx\` ON \`${TABLE}\` (\`path\`);`))
  for (const [column] of REFERENCES.slice(1)) {
    await db.run(
      sql.raw(`CREATE INDEX \`${TABLE}_${column}_idx\` ON \`${TABLE}\` (\`${column}\`);`),
    )
  }
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await rebuild(db, () => true)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await rebuild(db, (column) => !ADDED_WITHOUT_ON_DELETE.has(column))
}
