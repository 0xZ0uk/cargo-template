import type { SessionIndexEntry } from "@tanstack/ai-persistence";
import { dayBefore, entryUsage, USAGE_RETENTION_DAYS, type UsageAmount, type UsageSnapshot } from "../usage";
import { first, fromJson, nextCounter, run, toJson, type SqlStorageLike } from "./sql";

/**
 * Daily usage per user (#68), in the user's index object, next to their conversation list. One
 * row per UTC day (pruned after {@link USAGE_RETENTION_DAYS}); the conversation's running total
 * lives on its index entry (`metadata.costUsd` / `metadata.tokens`), so the list shows it with no
 * fan-out to the conversation objects.
 */
export const USAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_usage (
    tenant_id TEXT NOT NULL,
    day TEXT NOT NULL,
    tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, day)
  )`,
];

/**
 * Add one model call's usage, atomically (one SQLite transaction in a single-writer object): the
 * day's row, and the conversation's index entry when it still exists (a deleted conversation's
 * spend still counts towards the day). The entry write bumps its revision, so a rename racing it
 * retries instead of overwriting the total.
 */
export function addUsage(
  storage: SqlStorageLike,
  input: { tenantId: string; threadId?: string; day: string; amount: UsageAmount }
): void {
  const { tenantId, threadId, day, amount } = input;
  storage.transactionSync(() => {
    run(
      storage,
      `INSERT INTO assistant_usage (tenant_id, day, tokens, cost_usd, calls) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (tenant_id, day) DO UPDATE SET
         tokens = tokens + excluded.tokens, cost_usd = cost_usd + excluded.cost_usd, calls = calls + 1`,
      tenantId,
      day,
      amount.tokens,
      amount.costUsd
    );
    run(storage, `DELETE FROM assistant_usage WHERE tenant_id = ? AND day < ?`, tenantId, dayBefore(day, USAGE_RETENTION_DAYS));
    if (!threadId) return;
    const row = first<{ json: string }>(
      storage,
      `SELECT json FROM assistant_sessions WHERE tenant_id = ? AND thread_id = ?`,
      tenantId,
      threadId
    );
    if (!row) return;
    const entry = fromJson<SessionIndexEntry>(row.json);
    const current = entryUsage(entry) ?? { costUsd: 0, tokens: 0 };
    const next: SessionIndexEntry = {
      ...entry,
      metadata: { ...entry.metadata, costUsd: current.costUsd + amount.costUsd, tokens: current.tokens + amount.tokens },
    };
    run(
      storage,
      `UPDATE assistant_sessions SET revision = ?, json = ? WHERE tenant_id = ? AND thread_id = ?`,
      nextCounter(storage, "sessions"),
      toJson(next),
      tenantId,
      threadId
    );
  });
}

/** The user's usage on `day`, and the conversation's running total when `threadId` is given. */
export function readUsage(storage: SqlStorageLike, input: { tenantId: string; day: string; threadId?: string }): UsageSnapshot {
  const { tenantId, day, threadId } = input;
  const row = first<{ tokens: number; cost_usd: number }>(
    storage,
    `SELECT tokens, cost_usd FROM assistant_usage WHERE tenant_id = ? AND day = ?`,
    tenantId,
    day
  );
  const snapshot: UsageSnapshot = { day, costUsd: Number(row?.cost_usd ?? 0), tokens: Number(row?.tokens ?? 0) };
  if (threadId === undefined) return snapshot;
  const entry = first<{ json: string }>(
    storage,
    `SELECT json FROM assistant_sessions WHERE tenant_id = ? AND thread_id = ?`,
    tenantId,
    threadId
  );
  return { ...snapshot, conversation: entry ? entryUsage(fromJson<SessionIndexEntry>(entry.json)) : null };
}
