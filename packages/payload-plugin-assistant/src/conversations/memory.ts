import { memoryStream, resumeServerSentEventsResponse, toServerSentEventsResponse } from "@tanstack/ai";
import { memoryPersistence } from "@tanstack/ai-persistence";
import { DEFAULT_CONVERSATION_CAPS, withConversationCaps, type ConversationCaps } from "./caps";
import { DO_HEADERS, type ConversationBackend, type TurnInput, type TurnRunner } from "./types";

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
  /** Clock, for tests. */
  now?: () => number;
}

type Conversation = {
  owner: string;
  persistence: ReturnType<typeof memoryPersistence>;
  lastActive: number;
  controllers: Map<string, AbortController>;
  runIds: Set<string>;
};

const DAY = 24 * 60 * 60 * 1000;
const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

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
  const conversations = new Map<string, Conversation>();
  const sessions = memoryPersistence().stores.sessions;

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
    async claim(userKey, threadId) {
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
      const claimed = await backend.claim(input.userKey, input.threadId);
      if (!claimed.ok) return notFound();
      if (!options.turnRunner) return Response.json({ error: "not implemented" }, { status: 501 });
      const conversation = conversations.get(input.threadId)!;
      if (conversation.runIds.has(input.runId)) {
        return Response.json({ error: "run id already used; rejoin it instead" }, { status: 409 });
      }
      conversation.runIds.add(input.runId);
      const controller = new AbortController();
      conversation.controllers.set(input.runId, controller);
      const stream = options.turnRunner({
        input,
        persistence: withConversationCaps(conversation.persistence, caps),
        mcpFetch: options.mcpFetch?.(input.auth) ?? missingMcpFetch,
        signal: controller.signal,
      });
      const inner = memoryStream({ runId: input.runId });
      const adapter = {
        ...inner,
        close: async () => {
          await inner.close();
          conversation.controllers.delete(input.runId);
          conversation.lastActive = now();
        },
      };
      return toServerSentEventsResponse(stream, { durability: { adapter }, abortController: controller });
    },
    async join(userKey, threadId, request) {
      const conversation = owned(userKey, threadId);
      if (!conversation) return notFound();
      const url = new URL(request.url);
      const offset = request.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
      const runId = request.headers.get(DO_HEADERS.runId) ?? url.searchParams.get("runId");
      if (!offset || !runId) return Response.json({ error: "Last-Event-ID and X-Run-Id required" }, { status: 400 });
      if (!conversation.runIds.has(runId)) return notFound();
      return resumeServerSentEventsResponse({ adapter: memoryStream({ runId, offset }) });
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
      for (const controller of conversation.controllers.values()) controller.abort();
      conversations.delete(threadId);
      await sessions.delete({ tenantId: userKey, threadId });
      return true;
    },
  };
  return backend;
}

const missingMcpFetch: typeof fetch = (async () => {
  throw new Error("[payload-plugin-assistant] memoryConversations: no `mcpFetch` was given for the tools.");
}) as typeof fetch;
