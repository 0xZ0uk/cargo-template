/**
 * The slice of a Durable Object's storage the SQLite stores use. Structural, so the stores
 * themselves import nothing from `cloudflare:workers` and a `DurableObjectStorage` is assignable.
 */
export interface SqlCursorLike {
  toArray(): Array<Record<string, unknown>>;
}

export interface SqlStorageLike {
  sql: { exec(query: string, ...bindings: unknown[]): SqlCursorLike };
  /** Runs `fn` in one SQLite transaction: a throw rolls back every write in it. */
  transactionSync<T>(fn: () => T): T;
}

export function all<T>(storage: SqlStorageLike, query: string, ...bindings: unknown[]): T[] {
  return storage.sql.exec(query, ...bindings).toArray() as T[];
}

export function first<T>(storage: SqlStorageLike, query: string, ...bindings: unknown[]): T | undefined {
  return all<T>(storage, query, ...bindings)[0];
}

export function run(storage: SqlStorageLike, query: string, ...bindings: unknown[]): void {
  // `exec` is lazy for reads but writes run eagerly; draining keeps both cases identical.
  storage.sql.exec(query, ...bindings).toArray();
}

/** JSON for a column. `undefined` (a legal `unknown` value) is stored as `null`. */
export function toJson(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

export function fromJson<T>(text: unknown): T {
  return JSON.parse(String(text)) as T;
}

/** Next value of a named counter, persisted, so a revision never repeats (also after a delete). */
export function nextCounter(storage: SqlStorageLike, name: string): number {
  const row = first<{ value: number }>(
    storage,
    `INSERT INTO assistant_counters (name, value) VALUES (?, 1)
     ON CONFLICT (name) DO UPDATE SET value = value + 1
     RETURNING value`,
    name
  );
  return Number(row!.value);
}

export const COUNTERS_TABLE = `CREATE TABLE IF NOT EXISTS assistant_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
)`;
