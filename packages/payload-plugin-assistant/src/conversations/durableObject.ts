import {
  defineAIPersistence,
  defineInterruptStore,
  defineMessageStore,
  defineMetadataStore,
  defineRunStore,
  defineSessionIndexStore,
  type ChatWithInterruptsPersistence,
  type MetadataStore,
  type SessionIndexKey,
  type SessionIndexStore,
} from "@tanstack/ai-persistence";
import type { RunStore } from "@tanstack/ai";
import type { ConversationCaps } from "./caps";
import {
  DO_HEADERS,
  DO_ROUTES,
  type ClaimResult,
  type ConversationBackend,
  type ConversationTranscript,
  type TurnInput,
} from "./types";

/*
 * Worker-side view of the two Durable Object classes. Structural types only (no
 * `@cloudflare/workers-types`, no `cloudflare:workers`), so this module is safe in the
 * endpoint's lazy chunk and in Node. A real `DurableObjectNamespace<AssistantConversation>`
 * is assignable.
 */

/** A conversation stub: the RPC methods of `AssistantConversation` this side calls. */
export interface ConversationStubLike {
  fetch(input: any, init?: any): Promise<any>;
  claim(input: any): Promise<any>;
  transcript(userKey: string): Promise<any>;
  destroy(userKey: string): Promise<any>;
  stop(userKey: string, runId: string): Promise<any>;
  store(name: any, method: string, args: unknown[]): Promise<any>;
}

/** An index stub: the RPC methods of `AssistantConversationIndex`. */
export interface IndexStubLike {
  call(method: any, args: unknown[]): Promise<any>;
}

export interface NamespaceLike<Stub> {
  idFromName(name: string): any;
  get(id: any): Stub;
}

/**
 * The four chat stores of ONE conversation object, over RPC. Store methods don't all carry a
 * thread id (`runs.get(runId)`, `interrupts.resolve(id)`), so the persistence is bound to one
 * stub rather than routed per call. `chat()` itself never uses this (it runs inside the object
 * with direct SQLite access); it serves Worker-side reads and the conformance suite.
 */
export function conversationPersistence(stub: ConversationStubLike): ChatWithInterruptsPersistence & {
  stores: { metadata: MetadataStore };
} {
  const call =
    (name: string, method: string) =>
    (...args: unknown[]) =>
      stub.store(name, method, args);
  const methods = <T>(name: string, list: string[]) =>
    Object.fromEntries(list.map((method) => [method, call(name, method)])) as T;
  return defineAIPersistence({
    stores: {
      messages: defineMessageStore(methods("messages", ["loadThread", "saveThread"])),
      runs: defineRunStore(
        methods<RunStore>("runs", [
          "createOrResume",
          "update",
          "get",
          "findActiveRun",
          "listByThread",
          "listByParentRun",
          "listReclaimable",
        ])
      ),
      interrupts: defineInterruptStore(
        methods("interrupts", [
          "create",
          "resolve",
          "cancel",
          "commitBatch",
          "get",
          "list",
          "listPending",
          "listByRun",
          "listPendingByRun",
        ])
      ),
      metadata: defineMetadataStore(methods("metadata", ["get", "set", "delete", "getVersioned", "setIf"])),
    },
  });
}

/**
 * `SessionIndexStore` routed to one index object per tenant (`idFromName(tenantId ?? "")`).
 * The plugin always passes the user key as `tenantId`, so each user's list is one object.
 */
export function durableSessionIndexStore(namespace: NamespaceLike<IndexStubLike>): SessionIndexStore {
  const stub = (tenantId: string | undefined) => namespace.get(namespace.idFromName(tenantId ?? ""));
  const keyed =
    (method: string) =>
    (key: SessionIndexKey | { tenantId?: string }) =>
      stub(key.tenantId).call(method, [key]);
  return defineSessionIndexStore({
    get: keyed("get"),
    getVersioned: keyed("getVersioned"),
    upsert: keyed("upsert"),
    upsertIf: (input) => stub(input.entry.tenantId).call("upsertIf", [input]),
    list: (options = {}) => stub(options.tenantId).call("list", [options]),
    delete: keyed("delete"),
  } as SessionIndexStore);
}

export interface DurableObjectConversationsOptions {
  conversations: NamespaceLike<ConversationStubLike>;
  index: NamespaceLike<IndexStubLike>;
  /** Idle time before a conversation is deleted. */
  retentionMs: number;
  caps: ConversationCaps;
}

/**
 * The endpoint's backend on Workers. Each call checks ownership in the conversation object
 * (`claim` / `transcript` / `destroy` and the `fetch` routes all compare the stored owner with
 * the user key the endpoint derived from `req.user`).
 */
export function durableObjectConversations(options: DurableObjectConversationsOptions): ConversationBackend {
  const { conversations, retentionMs, caps } = options;
  const sessions = durableSessionIndexStore(options.index);
  const stub = (threadId: string) => conversations.get(conversations.idFromName(threadId));
  const claim = (userKey: string, threadId: string, title?: string): Promise<ClaimResult> =>
    stub(threadId).claim({ threadId, userKey, retentionMs, caps, ...(title ? { title } : {}) });

  return {
    claim,
    transcript: (userKey, threadId) => stub(threadId).transcript(userKey) as Promise<ConversationTranscript | null>,
    async startTurn(input: TurnInput) {
      const claimed = await claim(input.userKey, input.threadId, input.title);
      if (!claimed.ok) return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
      // The object answers with the run's SSE stream; returning it proxies the stream as is.
      return stub(input.threadId).fetch(DO_ROUTES.turn, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [DO_HEADERS.user]: input.userKey,
          [DO_HEADERS.thread]: input.threadId,
          [DO_HEADERS.runId]: input.runId,
          Cookie: input.auth.cookie,
          Origin: input.auth.origin,
        },
        body: JSON.stringify(input.body),
      }) as Promise<Response>;
    },
    join(userKey, threadId, request) {
      const url = new URL(request.url);
      const target = new URL(DO_ROUTES.join);
      for (const key of ["offset", "runId"]) {
        const value = url.searchParams.get(key);
        if (value !== null) target.searchParams.set(key, value);
      }
      const headers: Record<string, string> = { [DO_HEADERS.user]: userKey, [DO_HEADERS.thread]: threadId };
      for (const name of ["Last-Event-ID", DO_HEADERS.runId]) {
        const value = request.headers.get(name);
        if (value !== null) headers[name] = value;
      }
      return stub(threadId).fetch(target.toString(), { method: "GET", headers, signal: request.signal }) as Promise<Response>;
    },
    stop: (userKey, threadId, runId) => stub(threadId).stop(userKey, runId) as Promise<boolean>,
    hydrate(userKey, threadId, request) {
      const target = new URL(DO_ROUTES.hydrate);
      for (const [key, value] of new URL(request.url).searchParams) {
        if (key === "limit" || key === "before") target.searchParams.set(key, value);
      }
      return stub(threadId).fetch(target.toString(), {
        method: "GET",
        headers: { [DO_HEADERS.user]: userKey, [DO_HEADERS.thread]: threadId },
      }) as Promise<Response>;
    },
    list: (userKey, listOptions = {}) =>
      sessions.list({ ...listOptions, tenantId: userKey, memberId: userKey, parentThreadId: null }),
    async rename(userKey, threadId, title) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await sessions.getVersioned({ tenantId: userKey, threadId });
        if (!current || !current.entry.members.some((m) => m.userId === userKey && m.role === "owner")) return false;
        const result = await sessions.upsertIf({
          entry: { ...current.entry, title, updatedAt: Date.now() },
          revision: current.revision,
        });
        if (result.ok) return true;
      }
      throw new Error("[payload-plugin-assistant] rename lost three write races in a row");
    },
    // The conversation object checks the owner, deletes its data and its index entry.
    remove: (userKey, threadId) => stub(threadId).destroy(userKey) as Promise<boolean>,
  };
}
