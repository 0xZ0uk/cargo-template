import { resumeServerSentEventsResponse, toServerSentEventsResponse, type StreamDurability } from "@tanstack/ai";
import { reconstructChat } from "@tanstack/ai-persistence";
import type { AssistantAuditSink } from "../audit";
import { utcDay, type UsageAmount } from "../usage";
import { DEFAULT_CONVERSATION_CAPS, withConversationCaps, type ConversationCaps } from "./caps";
import { fenceDurability, fencePersistence } from "./fence";
import { RunControl } from "./runControl";
import type { ClaimInput, ConversationIndex, ConversationRecord, ConversationStorage } from "./storage";
import { DO_HEADERS, EMPTY_HYDRATION, type ClaimResult, type ConversationTranscript, type TurnInput, type TurnRunner } from "./types";

/** How long a finished run's stream log is kept for reconnects. */
export const STREAM_LOG_TTL_MS = 60 * 60 * 1000;
/** While a run is live, the storage is woken this often, so a Durable Object always has an event in flight. */
export const RUN_HEARTBEAT_MS = 30 * 1000;

/**
 * What a turn needs that isn't plain JSON, from wherever the turn runs: the app's factory in the
 * Durable Object (`assistantConversation(factory)`), the plugin's options in Node.
 */
export interface TurnDependencies {
  /** The chat turn. `null`: 501. */
  turnRunner: TurnRunner | null;
  /** The MCP dispatcher for a turn, authenticated as the admin who started it. */
  mcpFetch: (auth: TurnInput["auth"]) => typeof fetch;
  /** Where the run reports each applied write (#68). Absent: no audit. */
  audit?: AssistantAuditSink;
}

/**
 * What the app gives the turns run in the conversation Durable Object (`assistantConversation(factory)`, from `./do`): everything that isn't plain JSON
 * (the endpoint sends the rest with each turn, as `settings`). All optional.
 */
export interface AssistantConversationDependencies {
  /** Where applied writes are reported (#68). Default: nowhere. */
  audit?: AssistantAuditSink;
  /**
   * The chat turn. Default: `createTurnRunner()` (OpenRouter, or the test model when the endpoint
   * set `settings.testModel`); the tests pass one with `fakeText()`. `null` answers 501.
   */
  turnRunner?: TurnRunner | null;
}

/** Builds the dependencies from the object's `env`, once per object instance. */
export type AssistantConversationDependenciesFactory<Env> = (env: Env) => AssistantConversationDependencies;

export interface ConversationOptions {
  storage: ConversationStorage;
  /** The owners' lists and usage. Absent (a Durable Object without `ASSISTANT_INDEX`): not indexed, usage not recorded. */
  index?: ConversationIndex;
  /** Clock, for tests (retention and the usage day). */
  now?: () => number;
}

const notFound = () => Response.json({ error: "Not found", code: "not_found" }, { status: 404 });

/**
 * One conversation's lifecycle, over a {@link ConversationStorage}: written once for the Durable
 * Object and for Node.
 *
 * - **Ownership.** The first `claim` writes the owner (insert-if-absent). Every user-facing
 *   method checks it; a conversation another user owns answers like a missing one.
 * - **Turns.** `startTurn` reserves the run id (409 when it was ever used), registers the run's
 *   {@link RunControl}, pipes the turn runner's stream into the storage's log and answers with
 *   SSE; the run lives here, not in the request. `join` replays the log from an offset.
 * - **Fencing.** Every purge bumps the epoch. A run remembers the epoch it started in; its writes
 *   (stores, log, activity, usage on the conversation) go through only while that is still the
 *   current one, so a run the deletion aborted can't write into the deleted (or a re-claimed)
 *   conversation.
 * - **Usage and audit.** Each model call's usage goes to the owner's index (their UTC day and the
 *   conversation's total); applied writes go to the turn dependencies' audit sink.
 * - **Retention.** `expire()` (the Durable Object's alarm, Node's lazy sweep) deletes a
 *   conversation idle past its retention, and otherwise re-schedules: a heartbeat while a run
 *   is live, the idle deadline when none is.
 */
export class Conversation {
  private readonly storage: ConversationStorage;
  private readonly index: ConversationIndex | undefined;
  private readonly now: () => number;
  private readonly controllers = new Map<string, RunControl>();
  private epoch = 0;

  constructor(options: ConversationOptions) {
    this.storage = options.storage;
    this.index = options.index;
    this.now = options.now ?? Date.now;
  }

  /** Whether a run is live here. */
  get running(): boolean {
    return this.controllers.size > 0;
  }

  // --- ownership ----------------------------------------------------------------------------

  /** Open the conversation for `userKey`: the first caller becomes the owner. */
  async claim(input: ClaimInput): Promise<ClaimResult> {
    if (!input.userKey) return { ok: false };
    const at = this.now();
    const caps = input.caps ?? {};
    const existed = Boolean(this.storage.record());
    const record = this.storage.create({
      threadId: input.threadId,
      owner: input.userKey,
      createdAt: at,
      lastActive: at,
      retentionMs: input.retentionMs,
      caps,
    });
    if (record.owner !== input.userKey || record.threadId !== input.threadId) return { ok: false };
    this.storage.update({ lastActive: at, retentionMs: input.retentionMs, caps });
    await this.schedule();
    if (!existed) {
      await this.index?.create({
        tenantId: input.userKey,
        threadId: input.threadId,
        members: [{ userId: input.userKey, role: "owner" }],
        harness: "payload-assistant",
        createdAt: at,
        updatedAt: at,
        ...(input.title ? { title: input.title } : {}),
      });
    }
    return { ok: true, created: !existed };
  }

  /** Whether `userKey` owns this conversation. An unclaimed conversation has no owner. */
  isOwner(userKey: string): boolean {
    return this.owned(userKey) !== undefined;
  }

  /** The transcript for its owner, `null` for anyone else (and for a conversation that doesn't exist). */
  async transcript(userKey: string): Promise<ConversationTranscript | null> {
    const record = this.owned(userKey);
    if (!record) return null;
    const { messages, interrupts, runs } = this.storage.persistence.stores;
    return {
      threadId: record.threadId,
      messages: await messages.loadThread(record.threadId),
      pendingInterrupts: await interrupts.listPending(record.threadId),
      activeRun: await runs.findActiveRun(record.threadId),
    };
  }

  /**
   * `reconstructChat` over the stores, for its owner: what `useChat`'s `hydrate()` reads.
   * `request` carries the optional `?limit=` / `?before=` paging. Anyone else gets the empty
   * transcript, like a new conversation.
   */
  async hydrate(userKey: string, request: Request): Promise<Response> {
    const record = this.owned(userKey);
    if (!record) return Response.json(EMPTY_HYDRATION);
    const target = new URL("https://assistant.internal/hydrate");
    target.searchParams.set("threadId", record.threadId);
    const url = new URL(request.url);
    for (const key of ["limit", "before"]) {
      const value = url.searchParams.get(key);
      if (value !== null) target.searchParams.set(key, value);
    }
    return reconstructChat(this.storage.persistence, new Request(target), { includeRuns: true });
  }

  /** Delete everything, for its owner. Kills live runs first. */
  async destroy(userKey: string): Promise<boolean> {
    if (!this.owned(userKey)) return false;
    await this.purge();
    return true;
  }

  // --- turns --------------------------------------------------------------------------------

  /**
   * Start a turn in a conversation `input.userKey` owns (claim it first): 404 when not owned,
   * 501 without a turn runner, 400 for a bad run id, 409 when the run id was ever used here.
   */
  async startTurn(input: TurnInput, dependencies: TurnDependencies): Promise<Response> {
    const record = this.owned(input.userKey);
    if (!record) return notFound();
    const runner = dependencies.turnRunner;
    if (!runner) return Response.json({ error: "not implemented", code: "not_implemented" }, { status: 501 });
    const { runId } = input;
    if (!runId || /[\r\n]/.test(runId)) return Response.json({ error: "X-Run-Id required", code: "invalid_query" }, { status: 400 });
    // From the owner check to the reservation nothing awaits, so a purge can't slip in between.
    if (this.storage.runIdUsed(runId)) {
      return Response.json({ error: "run id already used; rejoin it instead", code: "run_id_used" }, { status: 409 });
    }
    this.storage.reserveRunId(runId, this.now());
    const epoch = this.epoch;
    const live = () => this.epoch === epoch;
    const { threadId, owner } = record;
    const caps = capsOf(record);
    this.storage.pruneLogs(this.now() - STREAM_LOG_TTL_MS);

    const control = new RunControl();
    this.controllers.set(runId, control);
    const durability = this.producerLog(runId, caps.maxStreamChunkBytes, live);
    const stream = runner({
      input: { ...input, threadId },
      persistence: withConversationCaps(fencePersistence(this.storage.persistence, live), caps),
      mcpFetch: dependencies.mcpFetch(input.auth),
      signal: control.signal,
      // Inside the run, so a closed tab doesn't lose it.
      recordUsage: (amount) => this.recordUsage(owner, threadId, amount, live),
      ...(dependencies.audit ? { audit: dependencies.audit } : {}),
    });
    await this.activity(live);
    // Fresh run + durability: TanStack drains the stream into the log under its own controller.
    // The response is only a viewer; cancelling it (closed tab) detaches, the run goes on here.
    return toServerSentEventsResponse(stream, { durability: { adapter: durability }, abortController: control.pipe });
  }

  /**
   * Rejoin a run from its log: `Last-Event-ID` header or `?offset`, and the run from `X-Run-Id`,
   * `?runId` or the offset. Never starts a model call or an MCP client. 404 when not owned or
   * when the run has no log here.
   */
  join(userKey: string, request: Request): Response {
    const record = this.owned(userKey);
    if (!record) return notFound();
    const url = new URL(request.url);
    const offset = request.headers.get("Last-Event-ID") ?? url.searchParams.get("offset");
    if (!offset) return Response.json({ error: "Last-Event-ID or ?offset required", code: "invalid_query" }, { status: 400 });
    const runId = request.headers.get(DO_HEADERS.runId) ?? url.searchParams.get("runId") ?? this.storage.runIdOfOffset(offset);
    const adapter = runId ? this.storage.readLog(runId, offset, capsOf(record).maxStreamChunkBytes) : null;
    if (!adapter) return notFound();
    return resumeServerSentEventsResponse({ adapter });
  }

  /** Stop a live run (the user pressed Stop). `false` when it isn't running here or isn't the caller's. */
  stop(userKey: string, runId: string): boolean {
    if (!this.owned(userKey)) return false;
    const control = this.controllers.get(runId);
    control?.stop();
    return Boolean(control);
  }

  // --- retention ----------------------------------------------------------------------------

  /** Delete the conversation when it is idle past its retention; otherwise prune old logs and re-schedule. */
  async expire(): Promise<void> {
    const record = this.storage.record();
    if (!record) return;
    if (!this.running && this.now() >= record.lastActive + record.retentionMs) {
      await this.purge();
      return;
    }
    this.storage.pruneLogs(this.now() - STREAM_LOG_TTL_MS);
    await this.schedule();
  }

  // --- internals ----------------------------------------------------------------------------

  private owned(userKey: string): ConversationRecord | undefined {
    const record = this.storage.record();
    return userKey !== "" && record?.owner === userKey ? record : undefined;
  }

  /**
   * The producer's log, fenced; closing it marks the run finished here and records the activity.
   * After a purge it neither writes nor touches the (new) conversation's state.
   */
  private producerLog(runId: string, maxChunkBytes: number, live: () => boolean): StreamDurability {
    const inner = fenceDurability(this.storage.openLog(runId, maxChunkBytes), live);
    return {
      ...inner,
      close: async () => {
        try {
          await inner.close();
        } finally {
          // Even when the close failed, so no phantom run keeps the heartbeat alive.
          if (live()) {
            this.controllers.get(runId)?.done();
            this.controllers.delete(runId);
          }
        }
        await this.activity(live);
      },
    };
  }

  /** The conversation was active: its record, its index entry, the next wake-up. Fenced. */
  private async activity(live: () => boolean): Promise<void> {
    if (!live()) return;
    const record = this.storage.record();
    if (!record) return;
    const at = this.now();
    this.storage.update({ lastActive: at });
    try {
      await this.index?.touch(record.owner, record.threadId, at);
    } catch (error) {
      console.error("[payload-plugin-assistant] index touch failed", error);
    }
    if (live()) await this.schedule();
  }

  /**
   * One model call's usage → the owner's index: their UTC day always (a deleted conversation's
   * spend still counts), the conversation's total only while the run's epoch is current.
   */
  private async recordUsage(owner: string, threadId: string, amount: UsageAmount, live: () => boolean): Promise<void> {
    if (!this.index) {
      console.error("[payload-plugin-assistant] no conversation index (ASSISTANT_INDEX): usage is not recorded, so budgets can't apply");
      return;
    }
    await this.index.addUsage(owner, live() ? threadId : undefined, utcDay(this.now()), amount);
  }

  private async schedule(): Promise<void> {
    const record = this.storage.record();
    if (!record) return;
    await this.storage.schedule(this.running ? this.now() + RUN_HEARTBEAT_MS : record.lastActive + record.retentionMs);
  }

  /**
   * Delete everything and the index entry. Live runs are killed and fenced off first (the epoch),
   * so nothing they write afterwards lands; their readers end with the storage's `clear()`.
   */
  private async purge(): Promise<void> {
    const record = this.storage.record();
    this.epoch += 1;
    for (const control of this.controllers.values()) control.kill();
    this.controllers.clear();
    await this.storage.clear();
    if (!record) return;
    try {
      await this.index?.remove({ tenantId: record.owner, threadId: record.threadId });
    } catch (error) {
      console.error("[payload-plugin-assistant] index delete failed", error);
    }
  }
}

function capsOf(record: ConversationRecord): ConversationCaps {
  return { ...DEFAULT_CONVERSATION_CAPS, ...record.caps };
}
