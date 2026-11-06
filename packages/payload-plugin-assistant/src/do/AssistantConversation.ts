import { DurableObject } from "cloudflare:workers";
import { resumeServerSentEventsResponse, toServerSentEventsResponse, type StreamDurability } from "@tanstack/ai";
import { reconstructChat, type SessionIndexEntry } from "@tanstack/ai-persistence";
import { DEFAULT_CONVERSATION_CAPS, withConversationCaps, type ConversationCaps } from "../conversations/caps";
import { missingSelfBinding, serviceBindingMcpFetch } from "../conversations/mcpTransport";
import { RunControl } from "../conversations/runControl";
import { DO_HEADERS, EMPTY_HYDRATION, type ClaimResult, type ConversationTranscript, type TurnInput, type TurnRunner } from "../conversations/types";
import type { AssistantConversationIndex } from "./AssistantConversationIndex";
import { fenceDurability, fencePersistence } from "./fence";
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

/**
 * Every run id `startTurn` accepted, for the conversation's lifetime: a run id is used once,
 * even after its stream log was pruned. One small row per turn; dropped with the conversation.
 */
const RUN_IDS_SCHEMA = `CREATE TABLE IF NOT EXISTS assistant_run_ids (
  run_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL
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

const notFound = () => Response.json({ error: "Not found", code: "not_found" }, { status: 404 });

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
  private hub = new StreamHub();
  private readonly controllers = new Map<string, RunControl>();
  private schemaReady = false;
  /**
   * Bumped by every purge. A run remembers the epoch it started in; its writes (stores, log,
   * activity, alarm) go through only while that is still the current one, so a run the
   * deletion aborted can't write its last events into the deleted (or a re-claimed) conversation.
   */
  private epoch = 0;

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
   * The chat turn: `createTurnRunner()` (OpenRouter, the Payload tools through `ASSISTANT_SELF`,
   * the settings the endpoint sent with the turn). A dynamic import in source; the `./do` bundle
   * inlines it (the Worker bundles the AI runtime for the endpoint anyway). Override it to swap
   * the adapter (the tests pass `fakeText()`); returning `null` answers 501.
   */
  protected async turnRunner(): Promise<TurnRunner | null> {
    const { createTurnRunner } = await import("../server/turn");
    return createTurnRunner();
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
    if (!this.owns(userKey)) {
      // Hydration of a conversation that isn't (yet) the caller's looks like a new one.
      return url.pathname === "/hydrate" && request.method === "GET" ? Response.json(EMPTY_HYDRATION) : notFound();
    }
    if (url.pathname === "/hydrate" && request.method === "GET") return this.hydrate(url);
    if (url.pathname === "/turn" && request.method === "POST") return this.startTurn(request, userKey, this.epoch);
    if (url.pathname === "/join" && request.method === "GET") return this.join(request);
    return notFound();
  }

  private async startTurn(request: Request, userKey: string, epoch: number): Promise<Response> {
    const live = () => this.epoch === epoch;
    const runner = await this.turnRunner();
    if (!runner) return Response.json({ error: "not implemented", code: "not_implemented" }, { status: 501 });
    const runId = request.headers.get(DO_HEADERS.runId) ?? "";
    if (!runId || /[\r\n]/.test(runId)) return Response.json({ error: "X-Run-Id required", code: "invalid_query" }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Deleted while we read the request: answer like any missing conversation.
    if (!live()) return notFound();
    if (!this.reserveRunId(runId)) {
      return Response.json({ error: "run id already used; rejoin it instead", code: "run_id_used" }, { status: 409 });
    }
    const meta = this.meta()!;
    const input: TurnInput = {
      threadId: meta.thread_id,
      runId,
      userKey,
      body,
      auth: { cookie: request.headers.get("Cookie") ?? "", origin: request.headers.get("Origin") ?? "" },
    };
    const caps = this.caps();
    pruneStreamLogs(this.storage, STREAM_LOG_TTL_MS);

    const control = new RunControl();
    this.controllers.set(runId, control);
    this.hub.producers.add(runId);
    const durability = this.producerLog(runId, caps.maxStreamChunkBytes, live);
    const stream = runner({
      input,
      persistence: withConversationCaps(fencePersistence(this.persistence, live), caps),
      mcpFetch: this.env.ASSISTANT_SELF
        ? serviceBindingMcpFetch({ fetcher: this.env.ASSISTANT_SELF, ...input.auth })
        : missingSelfBinding,
      signal: control.signal,
    });
    await this.touch();
    if (live()) await this.armAlarm();
    // Fresh run + durability: TanStack drains the stream into the log under its own controller.
    // The response is only a viewer; cancelling it (closed tab) detaches, the run goes on here.
    return toServerSentEventsResponse(stream, { durability: { adapter: durability }, abortController: control.pipe });
  }

  /** Stop a live run (the user pressed Stop). `false` when it isn't running here. */
  async stop(userKey: string, runId: string): Promise<boolean> {
    if (!this.owns(userKey)) return false;
    const control = this.controllers.get(runId);
    control?.stop();
    return Boolean(control);
  }

  /** `reconstructChat` over this conversation's stores: what `useChat`'s `hydrate()` reads. */
  private hydrate(url: URL): Promise<Response> {
    const target = new URL("https://assistant.internal/hydrate");
    target.searchParams.set("threadId", this.meta()!.thread_id);
    for (const key of ["limit", "before"]) {
      const value = url.searchParams.get(key);
      if (value !== null) target.searchParams.set(key, value);
    }
    return reconstructChat(this.persistence, new Request(target), { includeRuns: true });
  }

  private join(request: Request): Response {
    const url = new URL(request.url);
    const offset = request.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
    const runId = request.headers.get(DO_HEADERS.runId) ?? url.searchParams.get("runId") ?? runIdOfOffset(offset);
    if (!offset) return Response.json({ error: "Last-Event-ID or ?offset required", code: "invalid_query" }, { status: 400 });
    if (!runId || (!this.logExists(runId) && !this.hub.producers.has(runId))) return notFound();
    const adapter = sqlStreamDurability(this.storage, this.hub, {
      runId,
      offset,
      maxChunkBytes: this.caps().maxStreamChunkBytes,
    });
    return resumeServerSentEventsResponse({ adapter });
  }

  /**
   * The producer's log; closing it marks the run finished here and records the activity.
   * Fenced: after a purge it neither writes nor touches the (new) conversation's state.
   */
  private producerLog(runId: string, maxChunkBytes: number, live: () => boolean): StreamDurability {
    const inner = fenceDurability(sqlStreamDurability(this.storage, this.hub, { runId, offset: null, maxChunkBytes }), live);
    return {
      ...inner,
      close: async () => {
        try {
          await inner.close();
        } finally {
          // Even when the close failed, so no phantom producer keeps readers or the heartbeat alive.
          if (live()) {
            this.hub.producers.delete(runId);
            this.controllers.get(runId)?.done();
            this.controllers.delete(runId);
          }
        }
        if (!live()) return;
        await this.touch();
        if (live()) await this.armAlarm();
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

  /**
   * Delete every row, the alarm and the index entry. The object is empty (unclaimed) afterwards.
   * Live runs are aborted and fenced off first (the epoch), so nothing they write afterwards
   * lands; their readers end and their run ids are forgotten with the old hub.
   */
  private async purge(): Promise<void> {
    const meta = this.meta();
    this.epoch += 1;
    for (const control of this.controllers.values()) control.kill();
    this.controllers.clear();
    const hub = this.hub;
    this.hub = new StreamHub();
    hub.closeAll();
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
    for (const statement of [META_SCHEMA, RUN_IDS_SCHEMA, ...CONVERSATION_SCHEMA, ...STREAM_SCHEMA]) run(this.storage, statement);
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

  /**
   * Claim `runId` for a new turn; `false` if it was ever used in this conversation: live, in a
   * stream log, in the runs table or in the run-id ledger (which outlives the pruned logs).
   */
  private reserveRunId(runId: string): boolean {
    const used =
      this.hub.producers.has(runId) ||
      this.logExists(runId) ||
      Boolean(first(this.storage, `SELECT 1 AS found FROM assistant_runs WHERE run_id = ?`, runId)) ||
      Boolean(first(this.storage, `SELECT 1 AS found FROM assistant_run_ids WHERE run_id = ?`, runId));
    if (used) return false;
    run(this.storage, `INSERT INTO assistant_run_ids (run_id, started_at) VALUES (?, ?)`, runId, Date.now());
    return true;
  }

  private logExists(runId: string): boolean {
    return Boolean(first(this.storage, `SELECT 1 AS found FROM assistant_stream_logs WHERE run_id = ?`, runId));
  }

  private index(userKey: string) {
    const namespace = this.env.ASSISTANT_INDEX;
    return namespace ? namespace.get(namespace.idFromName(userKey)) : undefined;
  }
}
