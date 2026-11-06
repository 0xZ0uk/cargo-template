import { memoryStream, resumeServerSentEventsResponse, toServerSentEventsResponse } from "@tanstack/ai";
import { memoryPersistence, reconstructChat } from "@tanstack/ai-persistence";
import { RunControl } from "./runControl";
import { DEFAULT_CONVERSATION_CAPS, withConversationCaps, type ConversationCaps } from "./caps";
import type { AssistantAuditSink } from "../audit";
import { utcDay, type UsageAmount } from "../usage";
import { DO_HEADERS, EMPTY_HYDRATION, type ConversationBackend, type TurnInput, type TurnRunner } from "./types";

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
  conversations: Map<string, Conversation>;
  sessions: ReturnType<typeof memoryPersistence>["stores"]["sessions"];
  /** Daily usage per user (#68), keyed `<userKey> <day>`. */
  usage: Map<string, UsageAmount>;
}

export function createMemoryConversationState(): MemoryConversationState {
  return { conversations: new Map(), sessions: memoryPersistence().stores.sessions, usage: new Map() };
}

const usageKey = (userKey: string, day: string) => `${userKey} ${day}`;

type Conversation = {
  owner: string;
  persistence: ReturnType<typeof memoryPersistence>;
  lastActive: number;
  controllers: Map<string, RunControl>;
  runIds: Set<string>;
};

const DAY = 24 * 60 * 60 * 1000;
const notFound = () => Response.json({ error: "Not found", code: "not_found" }, { status: 404 });

/**
 * The in-memory fallback for Node dev and tests: the same `ConversationBackend` as the Durable
 * Objects, with `memoryPersistence()` per conversation and `memoryStream` for reconnects.
 * Conversations live in the process and vanish on restart. Retention is applied lazily, on the
 * next call after a conversation's deadline.
 */
export function memoryConversations(options: MemoryConversationsOptions = {}): ConversationBackend & {
  /** Drop idle conversations now (the Durable Object does this with an alarm). */
  sweep(): void;
} {
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? 30 * DAY;
  const caps = { ...DEFAULT_CONVERSATION_CAPS, ...options.caps };
  const { conversations, sessions, usage } = options.state ?? createMemoryConversationState();

  /** One model call's usage: the user's day, then the conversation's running total on its entry. */
  const recordUsage = async (userKey: string, threadId: string, amount: UsageAmount) => {
    const key = usageKey(userKey, utcDay(now()));
    const day = usage.get(key) ?? { costUsd: 0, tokens: 0 };
    usage.set(key, { costUsd: day.costUsd + amount.costUsd, tokens: day.tokens + amount.tokens });
    const entry = await sessions.get({ tenantId: userKey, threadId });
    if (!entry) return;
    const metadata = (entry.metadata ?? {}) as { costUsd?: number; tokens?: number };
    await sessions.upsert({
      ...entry,
      metadata: { ...entry.metadata, costUsd: (metadata.costUsd ?? 0) + amount.costUsd, tokens: (metadata.tokens ?? 0) + amount.tokens },
    });
  };

  const sweep = () => {
    for (const [threadId, conversation] of conversations) {
      if (conversation.controllers.size === 0 && now() >= conversation.lastActive + retentionMs) {
        conversations.delete(threadId);
        void sessions.delete({ tenantId: conversation.owner, threadId });
      }
    }
  };
  const owned = (userKey: string, threadId: string) => {
    sweep();
    const conversation = conversations.get(threadId);
    return userKey !== "" && conversation?.owner === userKey ? conversation : undefined;
  };

  const backend: ConversationBackend & { sweep(): void } = {
    sweep,
    async claim(userKey, threadId, title) {
      sweep();
      if (!userKey) return { ok: false };
      const existing = conversations.get(threadId);
      if (existing) {
        if (existing.owner !== userKey) return { ok: false };
        existing.lastActive = now();
        return { ok: true, created: false };
      }
      const at = now();
      conversations.set(threadId, {
        owner: userKey,
        persistence: memoryPersistence(),
        lastActive: at,
        controllers: new Map(),
        runIds: new Set(),
      });
      await sessions.upsert({
        tenantId: userKey,
        threadId,
        members: [{ userId: userKey, role: "owner" }],
        harness: "payload-assistant",
        createdAt: at,
        updatedAt: at,
        ...(title ? { title } : {}),
      });
      return { ok: true, created: true };
    },
    async transcript(userKey, threadId) {
      const conversation = owned(userKey, threadId);
      if (!conversation) return null;
      const { messages, interrupts, runs } = conversation.persistence.stores;
      return {
        threadId,
        messages: await messages.loadThread(threadId),
        pendingInterrupts: await interrupts.listPending(threadId),
        activeRun: await runs.findActiveRun(threadId),
      };
    },
    async startTurn(input) {
      const claimed = await backend.claim(input.userKey, input.threadId, input.title);
      if (!claimed.ok) return notFound();
      if (!options.turnRunner) return Response.json({ error: "not implemented", code: "not_implemented" }, { status: 501 });
      const conversation = conversations.get(input.threadId)!;
      if (conversation.runIds.has(input.runId)) {
        return Response.json({ error: "run id already used; rejoin it instead", code: "run_id_used" }, { status: 409 });
      }
      conversation.runIds.add(input.runId);
      const control = new RunControl();
      conversation.controllers.set(input.runId, control);
      const stream = options.turnRunner({
        input,
        persistence: withConversationCaps(conversation.persistence, caps),
        mcpFetch: options.mcpFetch?.(input.auth) ?? missingMcpFetch,
        signal: control.signal,
        recordUsage: (amount) => recordUsage(input.userKey, input.threadId, amount),
        ...(options.audit ? { audit: options.audit } : {}),
      });
      const inner = memoryStream({ runId: input.runId });
      const adapter = {
        ...inner,
        close: async () => {
          await inner.close();
          control.done();
          conversation.controllers.delete(input.runId);
          conversation.lastActive = now();
        },
      };
      return toServerSentEventsResponse(stream, { durability: { adapter }, abortController: control.pipe });
    },
    async join(userKey, threadId, request) {
      const conversation = owned(userKey, threadId);
      if (!conversation) return notFound();
      const url = new URL(request.url);
      const offset = request.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
      const runId = request.headers.get(DO_HEADERS.runId) ?? url.searchParams.get("runId");
      if (!offset || !runId) return Response.json({ error: "Last-Event-ID and X-Run-Id required", code: "invalid_query" }, { status: 400 });
      if (!conversation.runIds.has(runId)) return notFound();
      return resumeServerSentEventsResponse({ adapter: memoryStream({ runId, offset }) });
    },
    async stop(userKey, threadId, runId) {
      const control = owned(userKey, threadId)?.controllers.get(runId);
      control?.stop();
      return Boolean(control);
    },
    async hydrate(userKey, threadId, request) {
      const conversation = owned(userKey, threadId);
      if (!conversation) return Response.json(EMPTY_HYDRATION);
      const url = new URL(request.url);
      url.searchParams.set("threadId", threadId);
      return reconstructChat(conversation.persistence, new Request(url, { headers: request.headers }), { includeRuns: true });
    },
    async list(userKey, listOptions = {}) {
      sweep();
      return sessions.list({ ...listOptions, tenantId: userKey, memberId: userKey, parentThreadId: null });
    },
    async rename(userKey, threadId, title) {
      if (!owned(userKey, threadId)) return false;
      const current = await sessions.get({ tenantId: userKey, threadId });
      if (!current) return false;
      await sessions.upsert({ ...current, title, updatedAt: now() });
      return true;
    },
    async remove(userKey, threadId) {
      const conversation = owned(userKey, threadId);
      if (!conversation) return false;
      for (const control of conversation.controllers.values()) control.kill();
      conversations.delete(threadId);
      await sessions.delete({ tenantId: userKey, threadId });
      return true;
    },
    async usage(userKey, day, threadId) {
      const total = usage.get(usageKey(userKey, day)) ?? { costUsd: 0, tokens: 0 };
      const snapshot = { day, ...total };
      if (threadId === undefined) return snapshot;
      const metadata = (await sessions.get({ tenantId: userKey, threadId }))?.metadata as { costUsd?: unknown; tokens?: unknown } | undefined;
      const has = metadata && (metadata.costUsd !== undefined || metadata.tokens !== undefined);
      return {
        ...snapshot,
        conversation: has
          ? { costUsd: typeof metadata.costUsd === "number" ? metadata.costUsd : 0, tokens: typeof metadata.tokens === "number" ? metadata.tokens : 0 }
          : null,
      };
    },
  };
  return backend;
}

const missingMcpFetch: typeof fetch = (async () => {
  throw new Error("[payload-plugin-assistant] memoryConversations: no `mcpFetch` was given for the tools.");
}) as typeof fetch;
