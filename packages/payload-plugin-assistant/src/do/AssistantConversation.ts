import { DurableObject } from "cloudflare:workers";
import { resumeServerSentEventsResponse, toServerSentEventsResponse, type StreamDurability } from "@tanstack/ai";
import type { SessionIndexEntry } from "@tanstack/ai-persistence";
import { DEFAULT_CONVERSATION_CAPS, withConversationCaps, type ConversationCaps } from "../conversations/caps";
import { missingSelfBinding, serviceBindingMcpFetch } from "../conversations/mcpTransport";
import { DO_HEADERS, type ClaimResult, type ConversationTranscript, type TurnInput, type TurnRunner } from "../conversations/types";
import type { AssistantConversationIndex } from "./AssistantConversationIndex";
import { first, run, type SqlStorageLike } from "./sql";
import { CONVERSATION_SCHEMA, sqlConversationPersistence, type ConversationPersistence } from "./sqlStores";
import { pruneStreamLogs, runIdOfOffset, sqlStreamDurability, STREAM_SCHEMA, StreamHub } from "./sqlStream";

/** Bindings the conversation object reads from the Worker's `env`. Both are optional. */
export interface AssistantConversationEnv {
  /** The per-user index namespace, so retention and delete also remove the index entry. */
  ASSISTANT_INDEX?: DurableObjectNamespace<AssistantConversationIndex>;
  /** A service binding to this same Worker: the MCP transport for the tools (see the README). */
  ASSISTANT_SELF?: Fetcher;
}

export interface ClaimInput {
  threadId: string;
  userKey: string;
  /** Delete the conversation after this long without activity. */
  retentionMs: number;
  caps?: Partial<ConversationCaps>;
  title?: string;
}

/** The store methods reachable over RPC (`store(name, method, args)`), per store. */
const STORE_METHODS = {
  messages: ["loadThread", "saveThread"],
  runs: ["createOrResume", "update", "get", "findActiveRun", "listByThread", "listByParentRun", "listReclaimable"],
  interrupts: ["create", "resolve", "cancel", "commitBatch", "get", "list", "listPending", "listByRun", "listPendingByRun"],
  metadata: ["get", "set", "delete", "getVersioned", "setIf"],
} as const;
export type ConversationStoreName = keyof typeof STORE_METHODS;

const META_SCHEMA = `CREATE TABLE IF NOT EXISTS assistant_conversation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  thread_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  retention_ms INTEGER NOT NULL,
  caps TEXT NOT NULL
)`;

type Meta = {
  thread_id: string;
  owner: string;
  created_at: number;
  last_active: number;
  retention_ms: number;
  caps: string;
};

/** How long a finished run's stream log is kept for reconnects. */
export const STREAM_LOG_TTL_MS = 60 * 60 * 1000;
/** While a run is live, an alarm fires this often so the object always has an event in flight. */
export const RUN_HEARTBEAT_MS = 30 * 1000;

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

/**
 * One conversation: its transcript, runs, pending approvals and stream log, in this object's
 * SQLite; and the chat turn itself, which runs here so it outlives the request that started it.
 *
 * - **Ownership.** The first `claim` writes the owner (insert-if-absent, so two racing users
 *   can't both get it). Every user-facing entry (`claim`, `transcript`, `destroy`, `fetch`)
 *   checks it. The raw store RPC (`store`) is user-agnostic on purpose: the conformance suite
 *   drives it, and only the Worker can reach a stub.
 * - **Turns** (`fetch`, routes in `DO_ROUTES`): `POST /turn` pipes the turn runner's stream into
 *   the durable log and answers with SSE; `GET /join` replays the log from `Last-Event-ID`.
 * - **Retention.** One alarm: a heartbeat while a run is live, otherwise the idle deadline
 *   (`last_active + retention`), when the object deletes everything and its index entry.
 */
export class AssistantConversation<Env extends AssistantConversationEnv = AssistantConversationEnv> extends DurableObject<Env> {
  protected readonly storage: SqlStorageLike;
  protected readonly persistence: ConversationPersistence;
  private readonly hub = new StreamHub();
  private readonly controllers = new Map<string, AbortController>();
  private schemaReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = { sql: ctx.storage.sql, transactionSync: (fn) => ctx.storage.transactionSync(fn) };
    this.persistence = sqlConversationPersistence(this.storage);
    this.ensureSchema();
    // No producer survives a restart: a run still marked `running` lost its driver.
    run(
      this.storage,
      `UPDATE assistant_runs SET status = 'failed',
         json = json_set(json, '$.status', 'failed', '$.finishedAt', ?, '$.error', json('{"message":"The conversation restarted during the run.","code":"producer_lost"}'))
       WHERE status = 'running'`,
      Date.now()
    );
  }

  /**
   * The chat turn. Override in #63 (or a test) to return `chat(...)`; `null` answers 501.
   * Load the AI runtime lazily here so the object's cold start stays small.
   */
  protected async turnRunner(): Promise<TurnRunner | null> {
    return null;
  }

  // --- ownership & conversation lifecycle ---------------------------------------------------

  /** Open the conversation for `userKey`: the first caller becomes the owner. */
  async claim(input: ClaimInput): Promise<ClaimResult> {
    this.ensureSchema();
    const now = Date.now();
    const caps = JSON.stringify(input.caps ?? {});
    const existed = Boolean(this.meta());
    run(
      this.storage,
      `INSERT INTO assistant_conversation (id, thread_id, owner, created_at, last_active, retention_ms, caps)
       VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      input.threadId,
      input.userKey,
      now,
      now,
      input.retentionMs,
      caps
    );
    const meta = this.meta()!;
    if (meta.owner !== input.userKey || meta.thread_id !== input.threadId) return { ok: false };
    run(
      this.storage,
      `UPDATE assistant_conversation SET last_active = ?, retention_ms = ?, caps = ? WHERE id = 1`,
      now,
      input.retentionMs,
      caps
    );
    await this.armAlarm();
    if (!existed) {
      await this.index(input.userKey)?.call("upsert", [
        {
          tenantId: input.userKey,
          threadId: input.threadId,
          members: [{ userId: input.userKey, role: "owner" }],
          harness: "payload-assistant",
          createdAt: now,
          updatedAt: now,
          ...(input.title ? { title: input.title } : {}),
        } satisfies SessionIndexEntry,
      ]);
    }
    return { ok: true, created: !existed };
  }

  /** Whether `userKey` owns this conversation. An unclaimed conversation has no owner. */
  async isOwner(userKey: string): Promise<boolean> {
    return this.owns(userKey);
  }

  /** The transcript for its owner, `null` for anyone else (and for a conversation that doesn't exist). */
  async transcript(userKey: string): Promise<ConversationTranscript | null> {
    if (!this.owns(userKey)) return null;
    const threadId = this.meta()!.thread_id;
    const { messages, interrupts, runs } = this.persistence.stores;
    return {
      threadId,
      messages: await messages.loadThread(threadId),
      pendingInterrupts: await interrupts.listPending(threadId),
      activeRun: await runs.findActiveRun(threadId),
    };
  }

  /** Delete everything, for its owner. Stops a live run first. */
  async destroy(userKey: string): Promise<boolean> {
    if (!this.owns(userKey)) return false;
    await this.purge();
    return true;
  }

  // --- raw stores (user-agnostic; conformance and Worker-side reads) -------------------------

  /** `@tanstack/ai-persistence` store call over RPC: `store("messages", "loadThread", [threadId])`. */
  async store(name: ConversationStoreName, method: string, args: unknown[]): Promise<unknown> {
    this.ensureSchema();
    const allowed = STORE_METHODS[name] as readonly string[] | undefined;
    if (!allowed || !allowed.includes(method)) throw new Error(`Unknown store method: ${name}.${method}`);
    const store = this.persistence.stores[name] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    return await store[method]!(...args);
  }

  // --- turns ---------------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userKey = request.headers.get(DO_HEADERS.user) ?? "";
    // The owner check runs again here, so a join can never skip it.
    if (!this.owns(userKey)) return notFound();
    if (url.pathname === "/turn" && request.method === "POST") return this.startTurn(request, userKey);
    if (url.pathname === "/join" && request.method === "GET") return this.join(request);
    return notFound();
  }

  private async startTurn(request: Request, userKey: string): Promise<Response> {
    const runner = await this.turnRunner();
    if (!runner) return Response.json({ error: "not implemented" }, { status: 501 });
    const runId = request.headers.get(DO_HEADERS.runId) ?? "";
    if (!runId || /[\r\n]/.test(runId)) return Response.json({ error: "X-Run-Id required" }, { status: 400 });
    if (this.hub.producers.has(runId) || this.logExists(runId)) {
      return Response.json({ error: "run id already used; rejoin it instead" }, { status: 409 });
    }
    const meta = this.meta()!;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const input: TurnInput = {
      threadId: meta.thread_id,
      runId,
      userKey,
      body,
      auth: { cookie: request.headers.get("Cookie") ?? "", origin: request.headers.get("Origin") ?? "" },
    };
    const caps = this.caps();
    pruneStreamLogs(this.storage, STREAM_LOG_TTL_MS);

    const controller = new AbortController();
    this.controllers.set(runId, controller);
    this.hub.producers.add(runId);
    const durability = this.producerLog(runId, caps.maxStreamChunkBytes);
    const stream = runner({
      input,
      persistence: withConversationCaps(this.persistence, caps),
      mcpFetch: this.env.ASSISTANT_SELF
        ? serviceBindingMcpFetch({ fetcher: this.env.ASSISTANT_SELF, ...input.auth })
        : missingSelfBinding,
      signal: controller.signal,
    });
    await this.touch();
    await this.armAlarm();
    // Fresh run + durability: TanStack drains the stream into the log under its own controller.
    // The response is only a viewer; cancelling it (closed tab) detaches, the run goes on here.
    return toServerSentEventsResponse(stream, { durability: { adapter: durability }, abortController: controller });
  }

  /** Stop a live run (the user pressed Stop). `false` when it isn't running here. */
  async stop(userKey: string, runId: string): Promise<boolean> {
    if (!this.owns(userKey)) return false;
    const controller = this.controllers.get(runId);
    controller?.abort();
    return Boolean(controller);
  }

  private join(request: Request): Response {
    const url = new URL(request.url);
    const offset = request.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
    const runId = request.headers.get(DO_HEADERS.runId) ?? url.searchParams.get("runId") ?? runIdOfOffset(offset);
    if (!offset) return Response.json({ error: "Last-Event-ID or ?offset required" }, { status: 400 });
    if (!runId || (!this.logExists(runId) && !this.hub.producers.has(runId))) return notFound();
    const adapter = sqlStreamDurability(this.storage, this.hub, {
      runId,
      offset,
      maxChunkBytes: this.caps().maxStreamChunkBytes,
    });
    return resumeServerSentEventsResponse({ adapter });
  }

  /** The producer's log; closing it marks the run finished here and records the activity. */
  private producerLog(runId: string, maxChunkBytes: number): StreamDurability {
    const inner = sqlStreamDurability(this.storage, this.hub, { runId, offset: null, maxChunkBytes });
    return {
      ...inner,
      close: async () => {
        await inner.close();
        this.hub.producers.delete(runId);
        this.controllers.delete(runId);
        await this.touch();
        await this.armAlarm();
      },
    };
  }

  // --- retention -----------------------------------------------------------------------------

  override async alarm(): Promise<void> {
    this.ensureSchema();
    const meta = this.meta();
    if (!meta) return;
    if (this.hub.producers.size === 0 && Date.now() >= meta.last_active + meta.retention_ms) {
      await this.purge();
      return;
    }
    pruneStreamLogs(this.storage, STREAM_LOG_TTL_MS);
    await this.armAlarm();
  }

  private async armAlarm(): Promise<void> {
    const meta = this.meta();
    if (!meta) return;
    const next = this.hub.producers.size > 0 ? Date.now() + RUN_HEARTBEAT_MS : meta.last_active + meta.retention_ms;
    await this.ctx.storage.setAlarm(next);
  }

  private async touch(): Promise<void> {
    const meta = this.meta();
    if (!meta) return;
    const now = Date.now();
    run(this.storage, `UPDATE assistant_conversation SET last_active = ? WHERE id = 1`, now);
    try {
      await this.index(meta.owner)?.touch(meta.owner, meta.thread_id, now);
    } catch (error) {
      console.error("[payload-plugin-assistant] index touch failed", error);
    }
  }

  /** Delete every row, the alarm and the index entry. The object is empty (unclaimed) afterwards. */
  private async purge(): Promise<void> {
    const meta = this.meta();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.schemaReady = false;
    if (meta) {
      try {
        await this.index(meta.owner)?.call("delete", [{ tenantId: meta.owner, threadId: meta.thread_id }]);
      } catch (error) {
        console.error("[payload-plugin-assistant] index delete failed", error);
      }
    }
  }

  // --- helpers -------------------------------------------------------------------------------

  private ensureSchema(): void {
    if (this.schemaReady) return;
    for (const statement of [META_SCHEMA, ...CONVERSATION_SCHEMA, ...STREAM_SCHEMA]) run(this.storage, statement);
    this.schemaReady = true;
  }

  private meta(): Meta | undefined {
    this.ensureSchema();
    return first<Meta>(this.storage, `SELECT * FROM assistant_conversation WHERE id = 1`);
  }

  private owns(userKey: string): boolean {
    return userKey !== "" && this.meta()?.owner === userKey;
  }

  private caps(): ConversationCaps {
    const stored = this.meta()?.caps;
    return { ...DEFAULT_CONVERSATION_CAPS, ...(stored ? (JSON.parse(stored) as Partial<ConversationCaps>) : {}) };
  }

  private logExists(runId: string): boolean {
    return Boolean(first(this.storage, `SELECT 1 AS found FROM assistant_stream_logs WHERE run_id = ?`, runId));
  }

  private index(userKey: string) {
    const namespace = this.env.ASSISTANT_INDEX;
    return namespace ? namespace.get(namespace.idFromName(userKey)) : undefined;
  }
}
