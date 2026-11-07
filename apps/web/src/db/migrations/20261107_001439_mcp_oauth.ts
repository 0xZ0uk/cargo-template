import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`mcp_oauth_clients\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`client_id\` text NOT NULL,
  	\`client_name\` text NOT NULL,
  	\`redirect_uris\` text NOT NULL,
  	\`authorized_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`mcp_oauth_clients_client_id_idx\` ON \`mcp_oauth_clients\` (\`client_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_clients_updated_at_idx\` ON \`mcp_oauth_clients\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_clients_created_at_idx\` ON \`mcp_oauth_clients\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`mcp_oauth_clients_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`mcp_oauth_clients\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`mcp_oauth_clients_rels_order_idx\` ON \`mcp_oauth_clients_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_clients_rels_parent_idx\` ON \`mcp_oauth_clients_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_clients_rels_path_idx\` ON \`mcp_oauth_clients_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_clients_rels_users_id_idx\` ON \`mcp_oauth_clients_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`mcp_oauth_connections\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`client_name\` text NOT NULL,
  	\`user_id\` integer,
  	\`client_id\` integer,
  	\`redirect_uri\` text NOT NULL,
  	\`resource\` text NOT NULL,
  	\`last_used_at\` text,
  	\`expires_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`client_id\`) REFERENCES \`mcp_oauth_clients\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_user_idx\` ON \`mcp_oauth_connections\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_client_idx\` ON \`mcp_oauth_connections\` (\`client_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_expires_at_idx\` ON \`mcp_oauth_connections\` (\`expires_at\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_updated_at_idx\` ON \`mcp_oauth_connections\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_created_at_idx\` ON \`mcp_oauth_connections\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`mcp_oauth_connections_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`mcp_oauth_connections\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_rels_order_idx\` ON \`mcp_oauth_connections_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_rels_parent_idx\` ON \`mcp_oauth_connections_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_rels_path_idx\` ON \`mcp_oauth_connections_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_connections_rels_users_id_idx\` ON \`mcp_oauth_connections_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`mcp_oauth_tokens\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`hash\` text NOT NULL,
  	\`kind\` text NOT NULL,
  	\`connection_id\` integer,
  	\`user_id\` integer,
  	\`client_id\` integer,
  	\`expires_at\` text NOT NULL,
  	\`code_challenge\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`connection_id\`) REFERENCES \`mcp_oauth_connections\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`client_id\`) REFERENCES \`mcp_oauth_clients\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`mcp_oauth_tokens_hash_idx\` ON \`mcp_oauth_tokens\` (\`hash\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_connection_idx\` ON \`mcp_oauth_tokens\` (\`connection_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_user_idx\` ON \`mcp_oauth_tokens\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_client_idx\` ON \`mcp_oauth_tokens\` (\`client_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_expires_at_idx\` ON \`mcp_oauth_tokens\` (\`expires_at\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_updated_at_idx\` ON \`mcp_oauth_tokens\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_created_at_idx\` ON \`mcp_oauth_tokens\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`mcp_oauth_tokens_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`mcp_oauth_tokens\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_rels_order_idx\` ON \`mcp_oauth_tokens_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_rels_parent_idx\` ON \`mcp_oauth_tokens_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_rels_path_idx\` ON \`mcp_oauth_tokens_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`mcp_oauth_tokens_rels_users_id_idx\` ON \`mcp_oauth_tokens_rels\` (\`users_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Children first: on D1, dropping a table that rows still reference fails.
  await db.run(sql`DROP TABLE \`mcp_oauth_tokens_rels\`;`)
  await db.run(sql`DROP TABLE \`mcp_oauth_tokens\`;`)
  await db.run(sql`DROP TABLE \`mcp_oauth_connections_rels\`;`)
  await db.run(sql`DROP TABLE \`mcp_oauth_connections\`;`)
  await db.run(sql`DROP TABLE \`mcp_oauth_clients_rels\`;`)
  await db.run(sql`DROP TABLE \`mcp_oauth_clients\`;`)
}
