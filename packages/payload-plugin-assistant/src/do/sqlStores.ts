import type { ModelMessage, RunRecord, RunStore } from "@tanstack/ai";
import {
  defineAIPersistence,
  defineInterruptStore,
  defineMessageStore,
  defineMetadataStore,
  defineRunStore,
  type InterruptCommitEntry,
  type InterruptRecord,
  type InterruptStore,
  type MessageStore,
  type MetadataStore,
} from "@tanstack/ai-persistence";
import { all, COUNTERS_TABLE, first, fromJson, nextCounter, run, toJson, type SqlStorageLike } from "./sql";

/**
 * Schema of the conversation stores. Every statement is idempotent: it runs on every start of
 * the Durable Object and again after a retention purge (`deleteAll` drops the tables).
 *
 * The stores are faithful to `@tanstack/ai-persistence`'s contracts and nothing more: no caps,
 * no ownership. Caps wrap them (`withConversationCaps`), ownership is the Durable Object's job.
 * They keep a `thread_id` column although one Durable Object holds one conversation, so the
 * conformance suite (many threads, one store set) runs against them unchanged.
 */
export const CONVERSATION_SCHEMA = [
  COUNTERS_TABLE,
  `CREATE TABLE IF NOT EXISTS assistant_messages (
    thread_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (thread_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_runs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    parent_run_id TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    detached_since INTEGER,
    json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_runs_thread ON assistant_runs (thread_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_interrupts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    interrupt_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_interrupts_thread ON assistant_interrupts (thread_id, requested_at)`,
  `CREATE INDEX IF NOT EXISTS assistant_interrupts_run ON assistant_interrupts (run_id, requested_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_metadata (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (namespace, key)
  )`,
];

// --- messages -------------------------------------------------------------------------------

/** One row per message, so no single value nears SQLite's 2 MB limit. `saveThread` is a full replace. */
export function sqlMessageStore(storage: SqlStorageLike): MessageStore {
  const load = (threadId: string): ModelMessage[] =>
    all<{ json: string }>(storage, `SELECT json FROM assistant_messages WHERE thread_id = ? ORDER BY idx`, threadId).map(
      (row) => fromJson<ModelMessage>(row.json)
    );
  return defineMessageStore({
    loadThread: (async (threadId: string) => load(threadId)) as MessageStore["loadThread"],
    saveThread: async (threadId, messages) => {
      storage.transactionSync(() => {
        run(storage, `DELETE FROM assistant_messages WHERE thread_id = ?`, threadId);
        messages.forEach((message, idx) => {
          run(storage, `INSERT INTO assistant_messages (thread_id, idx, json) VALUES (?, ?, ?)`, threadId, idx, toJson(message));
        });
      });
    },
  });
}

// --- runs -----------------------------------------------------------------------------------

type RunRow = { json: string };
const toRun = (row: RunRow) => fromJson<RunRecord>(row.json);

function writeRun(storage: SqlStorageLike, record: RunRecord): void {
  run(
    storage,
    `UPDATE assistant_runs SET status = ?, parent_run_id = ?, detached_since = ?, json = ? WHERE run_id = ?`,
    record.status,
    record.parentRunId ?? null,
    record.detachedSince ?? null,
    toJson(record),
    record.runId
  );
}

export function sqlRunStore(storage: SqlStorageLike) {
  const get = (runId: string): RunRecord | null => {
    const row = first<RunRow>(storage, `SELECT json FROM assistant_runs WHERE run_id = ?`, runId);
    return row ? toRun(row) : null;
  };
  return defineRunStore({
    createOrResume: async (input: Parameters<RunStore["createOrResume"]>[0]) => {
      const existing = get(input.runId);
      if (existing) return existing;
      const record: RunRecord = {
        runId: input.runId,
        threadId: input.threadId,
        status: input.status ?? "running",
        startedAt: input.startedAt,
        ...(input.parentRunId !== undefined ? { parentRunId: input.parentRunId } : {}),
        ...(input.subagentRunId !== undefined ? { subagentRunId: input.subagentRunId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.activity !== undefined ? { activity: input.activity } : {}),
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...(input.principal !== undefined ? { principal: input.principal } : {}),
      };
      run(
        storage,
        `INSERT INTO assistant_runs (run_id, thread_id, parent_run_id, status, started_at, json)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO NOTHING`,
        record.runId,
        record.threadId,
        record.parentRunId ?? null,
        record.status,
        record.startedAt,
        toJson(record)
      );
      return get(input.runId) ?? record;
    },
    update: async (runId: string, patch: Parameters<RunStore["update"]>[1]) => {
      const existing = get(runId);
      if (!existing) return;
      // JSON drops `undefined`, so a patch field set to `undefined` (e.g. `detachedSince`) is removed.
      writeRun(storage, fromJson<RunRecord>(toJson({ ...existing, ...patch })));
    },
    get: async (runId: string) => get(runId),
    findActiveRun: async (threadId: string) => {
      const row = first<RunRow>(
        storage,
        `SELECT json FROM assistant_runs WHERE thread_id = ? AND status = 'running'
         ORDER BY started_at DESC, seq DESC LIMIT 1`,
        threadId
      );
      return row ? toRun(row) : null;
    },
    listByThread: async (threadId: string) =>
      all<RunRow>(storage, `SELECT json FROM assistant_runs WHERE thread_id = ? ORDER BY started_at, seq`, threadId).map(toRun),
    listByParentRun: async (parentRunId: string) =>
      all<RunRow>(
        storage,
        `SELECT json FROM assistant_runs WHERE parent_run_id = ? ORDER BY started_at, seq`,
        parentRunId
      ).map(toRun),
    listReclaimable: async ({ now, ttlMs }: { now: number; ttlMs: number }) =>
      all<RunRow>(
        storage,
        `SELECT json FROM assistant_runs
         WHERE status = 'running' AND detached_since IS NOT NULL AND detached_since <= ?
         ORDER BY started_at, seq`,
        now - ttlMs
      ).map(toRun),
  });
}

// --- interrupts -----------------------------------------------------------------------------

type InterruptRow = { json: string };
const toInterrupt = (row: InterruptRow) => fromJson<InterruptRecord>(row.json);

export function sqlInterruptStore(storage: SqlStorageLike): InterruptStore {
  const get = (interruptId: string): InterruptRecord | null => {
    const row = first<InterruptRow>(storage, `SELECT json FROM assistant_interrupts WHERE interrupt_id = ?`, interruptId);
    return row ? toInterrupt(row) : null;
  };
  const write = (record: InterruptRecord) =>
    run(
      storage,
      `UPDATE assistant_interrupts SET status = ?, json = ? WHERE interrupt_id = ?`,
      record.status,
      toJson(record),
      record.interruptId
    );
  const settle = (existing: InterruptRecord, entry: InterruptCommitEntry, resolvedAt: number) =>
    write(
      entry.status === "resolved"
        ? { ...existing, status: "resolved", resolvedAt, response: entry.response }
        : { ...existing, status: "cancelled", resolvedAt }
    );
  const list = (where: string, value: string) =>
    all<InterruptRow>(
      storage,
      `SELECT json FROM assistant_interrupts WHERE ${where} ORDER BY requested_at, seq`,
      value
    ).map(toInterrupt);

  return defineInterruptStore({
    create: async (record) => {
      // Insert-if-absent: a duplicate create never clobbers a resolved interrupt back to pending.
      const stored: InterruptRecord = { ...record, status: "pending" };
      run(
        storage,
        `INSERT INTO assistant_interrupts (interrupt_id, thread_id, run_id, status, requested_at, json)
         VALUES (?, ?, ?, 'pending', ?, ?) ON CONFLICT (interrupt_id) DO NOTHING`,
        record.interruptId,
        record.threadId,
        record.runId,
        record.requestedAt,
        toJson(stored)
      );
    },
    resolve: async (interruptId, response) => {
      const existing = get(interruptId);
      if (existing) settle(existing, { interruptId, status: "resolved", response }, Date.now());
    },
    cancel: async (interruptId) => {
      const existing = get(interruptId);
      if (existing) settle(existing, { interruptId, status: "cancelled" }, Date.now());
    },
    // All or nothing, in one SQLite transaction: a resume applies every approval or none.
    commitBatch: async (entries) => {
      storage.transactionSync(() => {
        const seen = new Set<string>();
        const resolvedAt = Date.now();
        for (const entry of entries) {
          if (seen.has(entry.interruptId)) {
            throw new Error(`Interrupt batch contains duplicate id: ${entry.interruptId}.`);
          }
          seen.add(entry.interruptId);
          const existing = get(entry.interruptId);
          if (!existing) throw new Error(`Interrupt batch references missing id: ${entry.interruptId}.`);
          if (existing.status !== "pending") {
            throw new Error(`Interrupt batch references non-pending id: ${entry.interruptId}.`);
          }
          settle(existing, entry, resolvedAt);
        }
      });
    },
    get: async (interruptId) => get(interruptId),
    list: async (threadId) => list("thread_id = ?", threadId),
    listPending: async (threadId) => list("thread_id = ? AND status = 'pending'", threadId),
    listByRun: async (runId) => list("run_id = ?", runId),
    listPendingByRun: async (runId) => list("run_id = ? AND status = 'pending'", runId),
  });
}

// --- metadata -------------------------------------------------------------------------------

export function sqlMetadataStore(storage: SqlStorageLike): MetadataStore {
  const read = (namespace: string, key: string) =>
    first<{ value: string; revision: number }>(
      storage,
      `SELECT value, revision FROM assistant_metadata WHERE namespace = ? AND key = ?`,
      namespace,
      key
    );
  const write = (namespace: string, key: string, value: unknown): string => {
    const revision = nextCounter(storage, "metadata");
    run(
      storage,
      `INSERT INTO assistant_metadata (namespace, key, value, revision) VALUES (?, ?, ?, ?)
       ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, revision = excluded.revision`,
      namespace,
      key,
      toJson(value),
      revision
    );
    return String(revision);
  };
  return defineMetadataStore({
    get: async (namespace, key) => {
      const row = read(namespace, key);
      return row ? fromJson(row.value) : null;
    },
    set: async (namespace, key, value) => {
      write(namespace, key, value);
    },
    delete: async (namespace, key) => {
      run(storage, `DELETE FROM assistant_metadata WHERE namespace = ? AND key = ?`, namespace, key);
    },
    getVersioned: async (namespace, key) => {
      const row = read(namespace, key);
      return row ? { value: fromJson(row.value), revision: String(row.revision) } : null;
    },
    setIf: async (namespace, key, value, expectedRevision) =>
      storage.transactionSync(() => {
        const current = read(namespace, key);
        const currentRevision = current ? String(current.revision) : null;
        if (currentRevision !== expectedRevision) return { ok: false as const, reason: "conflict" as const };
        return { ok: true as const, revision: write(namespace, key, value) };
      }),
  });
}

/** The four chat stores over one Durable Object's SQLite. `interrupts` needs `runs`, so both are here. */
export function sqlConversationPersistence(storage: SqlStorageLike) {
  return defineAIPersistence({
    stores: {
      messages: sqlMessageStore(storage),
      runs: sqlRunStore(storage),
      interrupts: sqlInterruptStore(storage),
      metadata: sqlMetadataStore(storage),
    },
  });
}

export type ConversationPersistence = ReturnType<typeof sqlConversationPersistence>;
