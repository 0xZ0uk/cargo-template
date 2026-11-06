import type { StreamChunk, StreamDurability } from "@tanstack/ai";
import { capJsonSize } from "../conversations/caps";
import { all, first, fromJson, run, toJson, type SqlStorageLike } from "./sql";

export const STREAM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_stream_logs (
    run_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_stream_entries (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    chunk TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  )`,
];

const OFFSET_PREFIX = "do1:";

export function encodeOffset(runId: string, seq: number): string {
  return `${OFFSET_PREFIX}${encodeURIComponent(runId)}:${seq}`;
}

export function decodeOffset(offset: string): { runId: string; seq: number } {
  const separator = offset.lastIndexOf(":");
  if (!offset.startsWith(OFFSET_PREFIX) || separator <= OFFSET_PREFIX.length) {
    throw new Error(`Invalid stream offset: ${offset}`);
  }
  const seq = Number(offset.slice(separator + 1));
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invalid stream offset: ${offset}`);
  return { runId: decodeURIComponent(offset.slice(OFFSET_PREFIX.length, separator)), seq };
}

/** The run id an offset names, or `null` for the from-start sentinels and garbage. */
export function runIdOfOffset(offset: string | null): string | null {
  if (!offset || offset === "-1" || offset === "now") return null;
  try {
    return decodeOffset(offset).runId;
  } catch {
    return null;
  }
}

/**
 * In-memory coordination for one Durable Object instance: which runs have a live producer
 * here, and the readers parked on each run. Never persisted: after a restart no producer is
 * live, which is exactly what makes an unfinished log detectable as orphaned.
 */
export class StreamHub {
  readonly producers = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();
  /** Set by `closeAll()`: the conversation was deleted, every reader ends. */
  closed = false;

  wait(runId: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) return resolve();
      const set = this.waiters.get(runId) ?? new Set();
      this.waiters.set(runId, set);
      const done = () => {
        set.delete(done);
        if (set.size === 0) this.waiters.delete(runId);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      set.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  wake(runId: string): void {
    for (const wake of [...(this.waiters.get(runId) ?? [])]) wake();
  }

  /** End this hub for good (the conversation was deleted): forget every producer, release every reader. */
  closeAll(): void {
    this.closed = true;
    this.producers.clear();
    for (const runId of [...this.waiters.keys()]) this.wake(runId);
  }
}

export interface SqlStreamOptions {
  runId: string;
  /** The resume offset from the request (`Last-Event-ID` / `?offset`), or `null` for a producer. */
  offset: string | null;
  /** Events larger than this are shrunk before they are stored. */
  maxChunkBytes: number;
}

function runErrorChunk(message: string, code: string): StreamChunk {
  return { type: "RUN_ERROR", timestamp: Date.now(), message, code, error: { message, code } } as unknown as StreamChunk;
}

/**
 * `StreamDurability` over the conversation Durable Object's SQLite. A producer (`chat()`
 * piped through `toServerSentEventsResponse`) appends every event before it is delivered;
 * a reconnect with `Last-Event-ID` reads the log from that offset and tails it until the
 * producer closes it. Offsets are `do1:<runId>:<seq>`, opaque to the client.
 *
 * Readers and the producer live in the same object, so tailing is an in-memory wake-up, not
 * polling. A log that is still open while no producer is live in this instance (the object
 * restarted mid-run, e.g. on a deploy) is sealed with a `RUN_ERROR` on first read, so a
 * reconnect ends instead of hanging.
 */
export function sqlStreamDurability(storage: SqlStorageLike, hub: StreamHub, options: SqlStreamOptions): StreamDurability {
  const { runId, offset: resumeOffset, maxChunkBytes } = options;
  if (!runId || /[\r\n]/.test(runId)) throw new Error(`Invalid runId: ${JSON.stringify(runId)}`);

  const log = () =>
    first<{ complete: number }>(storage, `SELECT complete FROM assistant_stream_logs WHERE run_id = ?`, runId);
  const ensureLog = () =>
    run(storage, `INSERT INTO assistant_stream_logs (run_id, created_at) VALUES (?, ?) ON CONFLICT (run_id) DO NOTHING`, runId, Date.now());
  const tail = () =>
    Number(first<{ seq: number | null }>(storage, `SELECT MAX(seq) AS seq FROM assistant_stream_entries WHERE run_id = ?`, runId)?.seq ?? 0);

  const appendNow = (chunks: StreamChunk[]): string[] =>
    storage.transactionSync(() => {
      ensureLog();
      let seq = tail();
      return chunks.map((chunk) => {
        seq += 1;
        run(
          storage,
          `INSERT INTO assistant_stream_entries (run_id, seq, chunk) VALUES (?, ?, ?)`,
          runId,
          seq,
          toJson(capJsonSize(chunk, maxChunkBytes))
        );
        return encodeOffset(runId, seq);
      });
    });

  const closeNow = () => {
    ensureLog();
    run(storage, `UPDATE assistant_stream_logs SET complete = 1, completed_at = ? WHERE run_id = ? AND complete = 0`, Date.now(), runId);
  };

  return {
    resumeFrom: () => resumeOffset,
    append: async (chunks) => {
      const offsets = appendNow(chunks);
      hub.wake(runId);
      return offsets;
    },
    close: async () => {
      closeNow();
      hub.wake(runId);
    },
    snapshot: async () =>
      all<{ seq: number; chunk: string }>(
        storage,
        `SELECT seq, chunk FROM assistant_stream_entries WHERE run_id = ? ORDER BY seq`,
        runId
      ).map((row) => ({ offset: encodeOffset(runId, Number(row.seq)), chunk: fromJson<StreamChunk>(row.chunk) })),
    read: async function* (offset, signal) {
      let threshold: number;
      if (offset === "-1") threshold = 0;
      else if (offset === "now") threshold = tail();
      else {
        const decoded = decodeOffset(offset);
        if (decoded.runId !== runId) {
          throw new Error(`Stream offset belongs to run ${JSON.stringify(decoded.runId)}, not ${JSON.stringify(runId)}`);
        }
        threshold = decoded.seq;
      }
      if (hub.closed) return;
      if (!log() && !hub.producers.has(runId)) {
        throw new Error(`Unknown or expired stream run: ${JSON.stringify(runId)}`);
      }
      const current = log();
      if (current && !current.complete && !hub.producers.has(runId)) {
        // Orphaned: its producer died with a previous instance. Seal it so readers terminate.
        appendNow([runErrorChunk("The run was interrupted (the conversation restarted). Send the message again.", "producer_lost")]);
        closeNow();
      }
      for (;;) {
        // The conversation was deleted while we waited: its tables are gone, end here.
        if (hub.closed) return;
        // Read `complete` BEFORE the rows, synchronously: if it was set, every entry already is.
        const complete = Boolean(log()?.complete);
        const rows = all<{ seq: number; chunk: string }>(
          storage,
          `SELECT seq, chunk FROM assistant_stream_entries WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT 256`,
          runId,
          threshold
        );
        for (const row of rows) {
          threshold = Number(row.seq);
          yield { offset: encodeOffset(runId, threshold), chunk: fromJson<StreamChunk>(row.chunk) };
        }
        if (rows.length > 0) continue;
        if (complete || signal?.aborted) return;
        await hub.wait(runId, signal);
      }
    },
  };
}

/** Drop the logs of runs that finished more than `olderThanMs` ago. Reconnects only need recent runs. */
export function pruneStreamLogs(storage: SqlStorageLike, olderThanMs: number, now = Date.now()): void {
  const cutoff = now - olderThanMs;
  storage.transactionSync(() => {
    run(
      storage,
      `DELETE FROM assistant_stream_entries WHERE run_id IN
         (SELECT run_id FROM assistant_stream_logs WHERE complete = 1 AND completed_at <= ?)`,
      cutoff
    );
    run(storage, `DELETE FROM assistant_stream_logs WHERE complete = 1 AND completed_at <= ?`, cutoff);
  });
}
