import type { ConversationCaps } from "../conversations/caps";
import type { ConversationRecord, ConversationStorage } from "../conversations/storage";
import { first, run, type SqlStorageLike } from "./sql";
import { CONVERSATION_SCHEMA, sqlConversationPersistence } from "./sqlStores";
import { pruneStreamLogs, runIdOfOffset, sqlStreamDurability, STREAM_SCHEMA, StreamHub } from "./sqlStream";

/** The slice of `DurableObjectStorage` the conversation's storage uses. Structural, like `SqlStorageLike`. */
export interface DurableStorageLike {
  sql: SqlStorageLike["sql"];
  transactionSync<T>(fn: () => T): T;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}

const META_SCHEMA = `CREATE TABLE IF NOT EXISTS assistant_conversation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  thread_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  retention_ms INTEGER NOT NULL,
  caps TEXT NOT NULL
)`;

/**
 * Every run id `startTurn` accepted, for the conversation's lifetime: a run id is used once,
 * even after its stream log was pruned. One small row per turn; dropped with the conversation.
 */
const RUN_IDS_SCHEMA = `CREATE TABLE IF NOT EXISTS assistant_run_ids (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL
)`;

type MetaRow = {
  thread_id: string;
  owner: string;
  created_at: number;
  last_active: number;
  retention_ms: number;
  caps: string;
};

/**
 * One conversation in its Durable Object's SQLite: the record (`assistant_conversation`), the
 * four chat stores, the run-id ledger and the stream logs (tailed through an in-memory
 * {@link StreamHub}), and the object's alarm. The tables are the ones the object always had, so
 * existing conversations read as before.
 */
export function sqliteConversationStorage(durable: DurableStorageLike): ConversationStorage & {
  /** The SQL slice, for the raw store RPC and the tests. */
  readonly sql: SqlStorageLike;
  /** Fail every run still marked `running`: after a restart no producer is left to finish it. */
  failOrphanedRuns(now: number): void;
} {
  const storage: SqlStorageLike = { sql: durable.sql, transactionSync: (fn) => durable.transactionSync(fn) };
  const stores = sqlConversationPersistence(storage);
  let hub = new StreamHub();
  let schemaReady = false;

  const ensureSchema = () => {
    if (schemaReady) return;
    for (const statement of [META_SCHEMA, RUN_IDS_SCHEMA, ...CONVERSATION_SCHEMA, ...STREAM_SCHEMA]) run(storage, statement);
    schemaReady = true;
  };
  const logExists = (runId: string) =>
    Boolean(first(storage, `SELECT 1 AS found FROM assistant_stream_logs WHERE run_id = ?`, runId));

  const record = (): ConversationRecord | undefined => {
    ensureSchema();
    const row = first<MetaRow>(storage, `SELECT * FROM assistant_conversation WHERE id = 1`);
    if (!row) return undefined;
    return {
      threadId: row.thread_id,
      owner: row.owner,
      createdAt: Number(row.created_at),
      lastActive: Number(row.last_active),
      retentionMs: Number(row.retention_ms),
      caps: JSON.parse(row.caps || "{}") as Partial<ConversationCaps>,
    } satisfies ConversationRecord;
  };

  return {
    sql: storage,
    failOrphanedRuns(now) {
      ensureSchema();
      run(
        storage,
        `UPDATE assistant_runs SET status = 'failed',
           json = json_set(json, '$.status', 'failed', '$.finishedAt', ?, '$.error', json('{"message":"The conversation restarted during the run.","code":"producer_lost"}'))
         WHERE status = 'running'`,
        now
      );
    },
    record,
    create(next) {
      ensureSchema();
      run(
        storage,
        `INSERT INTO assistant_conversation (id, thread_id, owner, created_at, last_active, retention_ms, caps)
         VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        next.threadId,
        next.owner,
        next.createdAt,
        next.lastActive,
        next.retentionMs,
        JSON.stringify(next.caps)
      );
      return record()!;
    },
    update(patch) {
      ensureSchema();
      if (patch.lastActive !== undefined) run(storage, `UPDATE assistant_conversation SET last_active = ? WHERE id = 1`, patch.lastActive);
      if (patch.retentionMs !== undefined) run(storage, `UPDATE assistant_conversation SET retention_ms = ? WHERE id = 1`, patch.retentionMs);
      if (patch.caps !== undefined) run(storage, `UPDATE assistant_conversation SET caps = ? WHERE id = 1`, JSON.stringify(patch.caps));
    },
    get persistence() {
      ensureSchema();
      return stores;
    },
    runIdUsed(runId) {
      ensureSchema();
      return (
        hub.producers.has(runId) ||
        logExists(runId) ||
        Boolean(first(storage, `SELECT 1 AS found FROM assistant_runs WHERE run_id = ?`, runId)) ||
        Boolean(first(storage, `SELECT 1 AS found FROM assistant_run_ids WHERE run_id = ?`, runId))
      );
    },
    reserveRunId(runId, at) {
      ensureSchema();
      run(storage, `INSERT INTO assistant_run_ids (run_id, started_at) VALUES (?, ?)`, runId, at);
    },
    openLog(runId, maxChunkBytes) {
      ensureSchema();
      // The hub of this incarnation: after a `clear()` the run's close only touches the old one.
      const current = hub;
      current.producers.add(runId);
      const inner = sqlStreamDurability(storage, current, { runId, offset: null, maxChunkBytes });
      return {
        ...inner,
        close: async () => {
          try {
            await inner.close();
          } finally {
            current.producers.delete(runId);
          }
        },
      };
    },
    readLog(runId, offset, maxChunkBytes) {
      ensureSchema();
      if (!logExists(runId) && !hub.producers.has(runId)) return null;
      return sqlStreamDurability(storage, hub, { runId, offset, maxChunkBytes });
    },
    runIdOfOffset: (offset) => runIdOfOffset(offset),
    pruneLogs(cutoff) {
      ensureSchema();
      pruneStreamLogs(storage, 0, cutoff);
    },
    async clear() {
      const old = hub;
      hub = new StreamHub();
      old.closeAll();
      await durable.deleteAlarm();
      await durable.deleteAll();
      schemaReady = false;
    },
    schedule: (at) => durable.setAlarm(at),
  };
}

