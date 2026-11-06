import {
  defineSessionIndexStore,
  type SessionIndexEntry,
  type SessionIndexKey,
  type SessionIndexStore,
} from "@tanstack/ai-persistence";
import { all, COUNTERS_TABLE, first, fromJson, nextCounter, run, toJson, type SqlStorageLike } from "./sql";

export const SESSION_INDEX_SCHEMA = [
  COUNTERS_TABLE,
  `CREATE TABLE IF NOT EXISTS assistant_sessions (
    tenant_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (tenant_id, thread_id)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_sessions_order ON assistant_sessions (tenant_id, updated_at DESC, thread_id)`,
];

const utf8 = new TextEncoder();
function compareUtf8(left: string, right: string): number {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return a.length - b.length;
}

/** Newest `updatedAt` first, then `threadId` in UTF-8 byte order; the cursor follows the same order. */
const bySessionOrder = (a: Pick<SessionIndexEntry, "updatedAt" | "threadId">, b: Pick<SessionIndexEntry, "updatedAt" | "threadId">) =>
  b.updatedAt - a.updatedAt || compareUtf8(a.threadId, b.threadId);

function parseCursor(cursor: string) {
  const split = cursor.indexOf(":");
  const updatedAt = Number(cursor.slice(0, split));
  if (split <= 0 || !Number.isFinite(updatedAt)) throw new Error(`Invalid session index cursor: ${cursor}`);
  return { updatedAt, threadId: cursor.slice(split + 1) };
}

/**
 * `SessionIndexStore` over one Durable Object's SQLite. The plugin gives every user their own
 * index Durable Object (see `AssistantConversationIndex`), so a list is one small table scan
 * in one object. The table still keys on `(tenant_id, thread_id)` so the store keeps the
 * contract when a host routes several tenants to one object.
 */
export function sqlSessionIndexStore(storage: SqlStorageLike): SessionIndexStore {
  const read = (key: SessionIndexKey) =>
    first<{ json: string; revision: number }>(
      storage,
      `SELECT json, revision FROM assistant_sessions WHERE tenant_id = ? AND thread_id = ?`,
      key.tenantId ?? "",
      key.threadId
    );
  const write = (entry: SessionIndexEntry): string => {
    const revision = nextCounter(storage, "sessions");
    run(
      storage,
      `INSERT INTO assistant_sessions (tenant_id, thread_id, updated_at, revision, json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, thread_id) DO UPDATE SET
         updated_at = excluded.updated_at, revision = excluded.revision, json = excluded.json`,
      entry.tenantId ?? "",
      entry.threadId,
      entry.updatedAt,
      revision,
      toJson(entry)
    );
    return String(revision);
  };

  return defineSessionIndexStore({
    get: async (key) => {
      const row = read(key);
      return row ? fromJson<SessionIndexEntry>(row.json) : undefined;
    },
    getVersioned: async (key) => {
      const row = read(key);
      return row ? { entry: fromJson<SessionIndexEntry>(row.json), revision: String(row.revision) } : undefined;
    },
    upsert: async (entry) => {
      write(entry);
    },
    upsertIf: async ({ entry, revision }) =>
      storage.transactionSync(() => {
        const current = read(entry);
        if ((current ? String(current.revision) : null) !== revision) {
          return { ok: false as const, reason: "conflict" as const };
        }
        return { ok: true as const, revision: write(entry) };
      }),
    list: async (options = {}) => {
      const { limit, cursor, parentThreadId, memberId, search, harness } = options;
      const after = cursor === undefined ? undefined : parseCursor(cursor);
      const needle = search?.toLowerCase();
      const metadata = Object.entries(options.metadata ?? {});
      // Filters in JS: one user's index is small, and the filters (members, metadata, search)
      // are over JSON. SQLite only narrows to the tenant.
      const matching = all<{ json: string }>(
        storage,
        `SELECT json FROM assistant_sessions WHERE tenant_id = ?`,
        options.tenantId ?? ""
      )
        .map((row) => fromJson<SessionIndexEntry>(row.json))
        .filter(
          (entry) =>
            (options.withArchived === true || entry.archived !== true) &&
            (parentThreadId === undefined || (entry.parentThreadId ?? null) === parentThreadId) &&
            (memberId === undefined || entry.members.some((member) => member.userId === memberId)) &&
            (needle === undefined || (entry.title?.toLowerCase().includes(needle) ?? false)) &&
            (harness === undefined || entry.harness === harness) &&
            metadata.every(([key, value]) => entry.metadata?.[key] === value) &&
            (after === undefined || bySessionOrder(after, entry) < 0)
        )
        .sort(bySessionOrder);
      const page = limit === undefined ? matching : matching.slice(0, limit);
      const last = page.at(-1);
      const hasMore = limit !== undefined && matching.length > limit && last !== undefined;
      return {
        entries: page,
        ...(hasMore ? { cursor: `${last.updatedAt}:${last.threadId}`, truncated: true } : {}),
      };
    },
    delete: async (key) => {
      run(storage, `DELETE FROM assistant_sessions WHERE tenant_id = ? AND thread_id = ?`, key.tenantId ?? "", key.threadId);
    },
  });
}
