/**
 * Usage budgets (#68): types and pure helpers shared by the endpoint, the turn runner, both
 * conversation backends and the admin UI. No runtime imports.
 */

/** A daily allowance per user. A cap left out is not enforced; `budget: false` turns both off. */
export interface AssistantBudget {
  /** Most OpenRouter cost (USD, as OpenRouter reports it) per user per UTC day. Default 5. */
  dailyCostUsd?: number;
  /** Most tokens (prompt + completion) per user per UTC day. Default: no token cap. */
  dailyTokens?: number;
}

/** What one model call (or a run, or a day) used. */
export interface UsageAmount {
  /** USD as OpenRouter reports it (`usage.cost`); 0 when the provider reported none. */
  costUsd: number;
  /** Prompt + completion tokens. */
  tokens: number;
}

/** A user's usage of one UTC day, and of one conversation when asked. */
export interface UsageSnapshot extends UsageAmount {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** The conversation's running total (all days), when a thread was asked for and is the caller's. */
  conversation?: UsageAmount | null;
}

/** `GET /api/assistant/usage` (and the `budget_exceeded` body's `usage`). */
export interface UsageResponse extends UsageSnapshot {
  /** The caps in force; `null` when budgets are off. */
  budget: AssistantBudget | null;
  /** What is left today, per cap (never negative); `null` for a cap that isn't set. */
  remaining: { costUsd: number | null; tokens: number | null };
  exceeded: boolean;
  /** When the day's usage resets: the next midnight UTC, ISO 8601. */
  resetsAt: string;
}

/** The default allowance: $5 per user per UTC day (the owner's decision, #68). */
export const DEFAULT_BUDGET: AssistantBudget = { dailyCostUsd: 5 };

/** How many days of daily usage rows the index object keeps. */
export const USAGE_RETENTION_DAYS = 35;

/** The UTC day of `now`, `YYYY-MM-DD`: the budget's key. */
export const utcDay = (now: number = Date.now()): string => new Date(now).toISOString().slice(0, 10);

/** The next midnight UTC after `now`, when the day's usage resets. */
export function nextUtcMidnight(now: number = Date.now()): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** The day `days` before `day` (both `YYYY-MM-DD`), for pruning. */
export function dayBefore(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * A conversation's running total, from its index entry's metadata (`metadata.costUsd` /
 * `metadata.tokens`), or `null` when it has none yet (or there is no entry).
 */
export function entryUsage(entry: { metadata?: unknown } | undefined): UsageAmount | null {
  const metadata = entry?.metadata as { costUsd?: unknown; tokens?: unknown } | undefined;
  if (!metadata || (metadata.costUsd === undefined && metadata.tokens === undefined)) return null;
  return {
    costUsd: typeof metadata.costUsd === "number" ? metadata.costUsd : 0,
    tokens: typeof metadata.tokens === "number" ? metadata.tokens : 0,
  };
}

/**
 * Normalise what a model call reports (TanStack's `UsageInfo`: `promptTokens`, `completionTokens`,
 * `totalTokens`, OpenRouter's `cost`) to an amount. Bad or missing numbers count as 0.
 */
export function usageAmountOf(usage: unknown): UsageAmount {
  const record = (usage ?? {}) as { totalTokens?: unknown; promptTokens?: unknown; completionTokens?: unknown; cost?: unknown };
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  const tokens = num(record.totalTokens) || num(record.promptTokens) + num(record.completionTokens);
  return { costUsd: num(record.cost), tokens: Math.round(tokens) };
}

/** Whether `used` reached a cap of `budget`. */
export function budgetExceeded(used: UsageAmount, budget: AssistantBudget | null): boolean {
  if (!budget) return false;
  return (
    (budget.dailyCostUsd !== undefined && used.costUsd >= budget.dailyCostUsd) ||
    (budget.dailyTokens !== undefined && used.tokens >= budget.dailyTokens)
  );
}

/** The usage endpoint's body from a snapshot and the caps. */
export function usageResponse(snapshot: UsageSnapshot, budget: AssistantBudget | null, now: number = Date.now()): UsageResponse {
  return {
    ...snapshot,
    budget,
    remaining: {
      costUsd: budget?.dailyCostUsd !== undefined ? Math.max(0, budget.dailyCostUsd - snapshot.costUsd) : null,
      tokens: budget?.dailyTokens !== undefined ? Math.max(0, budget.dailyTokens - snapshot.tokens) : null,
    },
    exceeded: budgetExceeded(snapshot, budget),
    resetsAt: nextUtcMidnight(now).toISOString(),
  };
}

/** `$0.0123` for small amounts, `$1.23` otherwise. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
