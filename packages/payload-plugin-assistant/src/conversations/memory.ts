import { memoryStream, type StreamDurability } from "@tanstack/ai";
import { memoryPersistence, type SessionIndexEntry, type SessionIndexKey, type SessionIndexStore } from "@tanstack/ai-persistence";
import type { AssistantAuditSink } from "../audit";
import { dayBefore, entryUsage, USAGE_RETENTION_DAYS, type UsageAmount, type UsageSnapshot } from "../usage";
import { backendOver } from "./backendOver";
import { capJsonSize, DEFAULT_CONVERSATION_CAPS, type ConversationCaps } from "./caps";
import { Conversation, type TurnDependencies } from "./conversation";
import type { ConversationIndex, ConversationRecord, ConversationStorage } from "./storage";
import type { ConversationBackend, TurnInput, TurnRunner } from "./types";

export interface MemoryConversationsOptions {
  /** The chat turn (#63). Without it `startTurn` answers 501. */
  turnRunner?: TurnRunner;
  /**
   * The MCP dispatcher for a turn. In Node the endpoint passes an in-process fetch into
   * Payload's router (the spike's `handleEndpoints` path) with the admin's Cookie and Origin.
   */
  mcpFetch?: (auth: TurnInput["auth"]) => typeof fetch;
  retentionMs?: number;
  caps?: Partial<ConversationCaps>;
  /** Clock, for tests (retention and the usage day). */
  now?: () => number;
  /** Where turns report applied writes (#68): the plugin's `audit` option. */
  audit?: AssistantAuditSink;
  /**
   * The conversations themselves. Pass the same state to several backends (built with different
   * options) to share the data: `conversationBackend` keeps one per process. Default: a new one.
   */
  state?: MemoryConversationState;
}

/** The data of the memory backend, separate from its options (`createMemoryConversationState`). */
export interface MemoryConversationState {
  conversations: Map<string, MemoryConversation>;
  /** The owners' conversation lists (`tenantId` = user key). */
  sessions: SessionIndexStore;
  /** Daily usage per user (#68), keyed `<userKey> <day>`. */
  usage: Map<string, UsageAmount>;
}

/** One conversation of the memory backend: the shared lifecycle over its memory storage. */
export interface MemoryConversation {
  conversation: Conversation;
  storage: ConversationStorage;
}

export function createMemoryConversationState(): MemoryConversationState {
  return { conversations: new Map(), sessions: memoryPersistence().stores.sessions, usage: new Map() };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * The in-memory fallback for Node dev and tests: the same lifecycle as the Durable Objects
 * (`Conversation`), over process memory: `memoryPersistence()` stores per conversation and
 * `memoryStream` logs. Conversations vanish on restart. Retention is applied lazily, on the next
 * call after a conversation's deadline.
 */
export function memoryConversations(options: MemoryConversationsOptions = {}): ConversationBackend & {
  /** Drop idle conversations now (the Durable Object does this with an alarm). */
  sweep(): Promise<void>;
} {
  const now = options.now ?? Date.now;
  const state = options.state ?? createMemoryConversationState();
  const index = memoryConversationIndex(state);
  const dependencies: TurnDependencies = {
    turnRunner: options.turnRunner ?? null,
    mcpFetch: options.mcpFetch ?? (() => missingMcpFetch),
    ...(options.audit ? { audit: options.audit } : {}),
  };

  const sweep = async () => {
    for (const [threadId, entry] of state.conversations) {
      await entry.conversation.expire();
      if (!entry.storage.record() && !entry.conversation.running) state.conversations.delete(threadId);
    }
  };
  const conversationOf = (threadId: string): Conversation => {
    let entry = state.conversations.get(threadId);
    if (!entry) {
      const storage = memoryConversationStorage();
      entry = { storage, conversation: new Conversation({ storage, index, now }) };
      state.conversations.set(threadId, entry);
    }
    return entry.conversation;
  };

  const backend = backendOver({
    open(threadId) {
      const conversation = conversationOf(threadId);
      return {
        claim: (input) => conversation.claim(input),
        transcript: (userKey) => conversation.transcript(userKey),
        startTurn: (input) => conversation.startTurn(input, dependencies),
        join: async (userKey, request) => conversation.join(userKey, request),
        stop: async (userKey, runId) => conversation.stop(userKey, runId),
        hydrate: (userKey, request) => conversation.hydrate(userKey, request),
        destroy: (userKey) => conversation.destroy(userKey),
      };
    },
    sessions: state.sessions,
    usage: (userKey, day, threadId) => index.usage(userKey, day, threadId),
    retentionMs: options.retentionMs ?? 30 * DAY,
    caps: { ...DEFAULT_CONVERSATION_CAPS, ...options.caps },
    beforeEach: sweep,
  });
  return { ...backend, sweep };
}

/**
 * One conversation in process memory: its record, `memoryPersistence()` stores, the run-id
 * ledger and `memoryStream` logs. `memoryStream` keeps its logs in a process-global map keyed by
 * run id, so each claim gets a fresh key prefix: a run id reused in another conversation, or
 * after a delete, never meets an old log.
 */
export function memoryConversationStorage(): ConversationStorage {
  let record: ConversationRecord | undefined;
  let persistence = memoryPersistence();
  let ledger = new Set<string>();
  let prefix = `${crypto.randomUUID()}/`;
  /** Producer logs still open, closed by `clear()` so their readers end. */
  const producers = new Map<string, StreamDurability>();

  return {
    record: () => record,
    create(next) {
      record ??= { ...next };
      return record;
    },
    update(patch) {
      if (record) record = { ...record, ...patch };
    },
    get persistence() {
      return persistence;
    },
    runIdUsed: (runId) => ledger.has(runId),
    reserveRunId: (runId) => {
      ledger.add(runId);
    },
    openLog(runId, maxChunkBytes) {
      const inner = memoryStream({ runId: prefix + runId });
      producers.set(runId, inner);
      return {
        ...inner,
        append: (chunks) => inner.append(chunks.map((chunk) => capJsonSize(chunk, maxChunkBytes))),
        close: async () => {
          producers.delete(runId);
          await inner.close();
        },
      };
    },
    readLog(runId, offset) {
      if (!ledger.has(runId)) return null;
      return memoryStream({ runId: prefix + runId, offset });
    },
    runIdOfOffset(offset) {
      // `memory:v1:<encoded run id>:<seq>` (TanStack's format), where the run id carries our prefix.
      const match = /^memory:v1:(.+):\d+$/.exec(offset);
      if (!match) return null;
      try {
        const key = decodeURIComponent(match[1]!);
        return key.startsWith(prefix) ? key.slice(prefix.length) : null;
      } catch {
        return null;
      }
    },
    // `memoryStream` evicts finished logs itself, a few minutes after they complete.
    pruneLogs: () => {},
    async clear() {
      const open = [...producers.values()];
      producers.clear();
      record = undefined;
      persistence = memoryPersistence();
      ledger = new Set();
      prefix = `${crypto.randomUUID()}/`;
      await Promise.all(open.map((log) => log.close().catch(() => {})));
    },
    // Swept lazily: `memoryConversations` calls `expire()` before every call.
    schedule: async () => {},
  };
}

const usageKey = (userKey: string, day: string) => `${userKey} ${day}`;

/** The owners' lists and usage in process memory: the memory twin of `AssistantConversationIndex`. */
export function memoryConversationIndex(state: Pick<MemoryConversationState, "sessions" | "usage">): ConversationIndex & {
  usage(userKey: string, day: string, threadId?: string): Promise<UsageSnapshot>;
} {
  const { sessions, usage } = state;
  /** Change an entry with its revision, so concurrent writers (a rename, a usage write) don't overwrite each other. */
  const updateEntry = async (key: SessionIndexKey, change: (entry: SessionIndexEntry) => SessionIndexEntry) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await sessions.getVersioned(key);
      if (!current) return;
      if ((await sessions.upsertIf({ entry: change(current.entry), revision: current.revision })).ok) return;
    }
  };
  return {
    create: (entry) => sessions.upsert(entry),
    remove: (key) => sessions.delete(key),
    touch: (tenantId, threadId, updatedAt) => updateEntry({ tenantId, threadId }, (entry) => ({ ...entry, updatedAt })),
    async addUsage(tenantId, threadId, day, amount) {
      const key = usageKey(tenantId, day);
      const total = usage.get(key) ?? { costUsd: 0, tokens: 0 };
      usage.set(key, { costUsd: total.costUsd + amount.costUsd, tokens: total.tokens + amount.tokens });
      const oldest = usageKey(tenantId, dayBefore(day, USAGE_RETENTION_DAYS));
      for (const stored of usage.keys()) if (stored.startsWith(`${tenantId} `) && stored < oldest) usage.delete(stored);
      if (!threadId) return;
      await updateEntry({ tenantId, threadId }, (entry) => {
        const current = entryUsage(entry) ?? { costUsd: 0, tokens: 0 };
        return {
          ...entry,
          metadata: { ...entry.metadata, costUsd: current.costUsd + amount.costUsd, tokens: current.tokens + amount.tokens },
        };
      });
    },
    async usage(userKey, day, threadId) {
      const total = usage.get(usageKey(userKey, day)) ?? { costUsd: 0, tokens: 0 };
      const snapshot: UsageSnapshot = { day, ...total };
      if (threadId === undefined) return snapshot;
      return { ...snapshot, conversation: entryUsage(await sessions.get({ tenantId: userKey, threadId })) };
    },
  };
}

const missingMcpFetch: typeof fetch = (async () => {
  throw new Error("[payload-plugin-assistant] memoryConversations: no `mcpFetch` was given for the tools.");
}) as typeof fetch;
