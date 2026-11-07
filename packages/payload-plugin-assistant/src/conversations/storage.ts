import type { StreamDurability } from "@tanstack/ai";
import type { ChatWithInterruptsPersistence, SessionIndexEntry, SessionIndexKey } from "@tanstack/ai-persistence";
import type { UsageAmount } from "../usage";
import type { ConversationCaps } from "./caps";

/*
 * The seam under the conversation lifecycle (`Conversation`, ./conversation.ts): what a place to
 * keep ONE conversation must provide. Two adapters: SQLite in the conversation's Durable Object
 * (`sqliteConversationStorage`, src/do/sqlConversation.ts) and process memory for Node
 * (`memoryConversationStorage`, ./memory.ts). Everything above it (ownership, the run lifecycle,
 * fencing, usage, audit, retention) is written once, in `Conversation`.
 */

/** The conversation's own row: who owns it, when it was last active, its retention and caps. */
export interface ConversationRecord {
  threadId: string;
  owner: string;
  createdAt: number;
  lastActive: number;
  /** Delete the conversation after this long without activity. */
  retentionMs: number;
  caps: Partial<ConversationCaps>;
}

/** One conversation's storage. Unclaimed (no record) until the first `create`. */
export interface ConversationStorage {
  /** The record, or `undefined` while the conversation is unclaimed. */
  record(): ConversationRecord | undefined;
  /**
   * Store `record` unless one exists (insert-if-absent, so two racing claims can't both win), and
   * answer the record now stored. Synchronous: the owner check right after can't be raced.
   */
  create(record: ConversationRecord): ConversationRecord;
  /** Change the stored record's activity, retention or caps. A no-op while unclaimed. */
  update(patch: Partial<Pick<ConversationRecord, "lastActive" | "retentionMs" | "caps">>): void;
  /**
   * The four chat stores, raw: the lifecycle caps and fences them for a run. Each store method
   * does its writes before its first `await`, so the fence's check and the write are one step.
   */
  readonly persistence: ChatWithInterruptsPersistence;
  /** Whether `runId` was ever accepted here: live, logged, in the runs store or in the ledger. */
  runIdUsed(runId: string): boolean;
  /** Add `runId` to the ledger of accepted run ids (kept for the conversation's lifetime). */
  reserveRunId(runId: string, at: number): void;
  /**
   * The producer's log for a new run. Its `close` marks the log complete, so readers end.
   * Events larger than `maxChunkBytes` are shrunk before they are stored.
   */
  openLog(runId: string, maxChunkBytes: number): StreamDurability;
  /** A reader of `runId`'s log from `offset`, or `null` when that run has no log here. */
  readLog(runId: string, offset: string, maxChunkBytes: number): StreamDurability | null;
  /** The run id an offset of this storage's logs names, or `null` (sentinels, garbage). */
  runIdOfOffset(offset: string): string | null;
  /** Drop the logs of runs that finished before `cutoff`. Reconnects only need recent runs. */
  pruneLogs(cutoff: number): void;
  /** Delete everything and end every reader. The conversation is unclaimed afterwards. */
  clear(): Promise<void>;
  /** Call `Conversation.expire()` at `at` (the Durable Object's alarm). Memory sweeps lazily instead. */
  schedule(at: number): Promise<void>;
}

/**
 * The owners' conversation lists and usage, as the lifecycle writes them: the per-user index
 * Durable Object on Workers, process memory in Node. Always keyed by the owner (`tenantId`).
 */
export interface ConversationIndex {
  /** Add the entry of a conversation just created. */
  create(entry: SessionIndexEntry): Promise<void>;
  /** Drop a deleted conversation's entry. */
  remove(key: SessionIndexKey): Promise<void>;
  /** Bump `updatedAt` after a turn. A no-op for a missing entry. */
  touch(tenantId: string, threadId: string, updatedAt: number): Promise<void>;
  /**
   * Add one model call's usage to the user's UTC `day`, and to the conversation's entry when
   * `threadId` is given and the entry exists (#68).
   */
  addUsage(tenantId: string, threadId: string | undefined, day: string, amount: UsageAmount): Promise<void>;
}

/** What `Conversation.claim` takes: the conversation, its user, and the endpoint's retention and caps. */
export interface ClaimInput {
  threadId: string;
  userKey: string;
  /** Delete the conversation after this long without activity. */
  retentionMs: number;
  caps?: Partial<ConversationCaps>;
  title?: string;
}
