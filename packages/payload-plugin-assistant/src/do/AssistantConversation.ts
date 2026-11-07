import { DurableObject } from "cloudflare:workers";
import {
  Conversation,
  RUN_HEARTBEAT_MS,
  STREAM_LOG_TTL_MS,
  type AssistantConversationDependencies,
  type AssistantConversationDependenciesFactory,
  type TurnDependencies,
} from "../conversations/conversation";
import { durableConversationIndex } from "../conversations/durableObject";
import { missingSelfBinding, serviceBindingMcpFetch } from "../conversations/mcpTransport";
import type { ClaimInput } from "../conversations/storage";
import { DO_HEADERS, type ClaimResult, type ConversationTranscript, type TurnInput, type TurnRunner } from "../conversations/types";
import type { AssistantConversationIndex } from "./AssistantConversationIndex";
import { sqliteConversationStorage } from "./sqlConversation";

export { RUN_HEARTBEAT_MS, STREAM_LOG_TTL_MS };
export type { AssistantConversationDependencies, AssistantConversationDependenciesFactory, ClaimInput };

/** Bindings the conversation object reads from the Worker's `env`. Both are optional. */
export interface AssistantConversationEnv {
  /** The per-user index namespace, so retention and delete also remove the index entry. */
  ASSISTANT_INDEX?: DurableObjectNamespace<AssistantConversationIndex>;
  /** A service binding to this same Worker: the MCP transport for the tools (see the README). */
  ASSISTANT_SELF?: Fetcher;
}

/** The store methods reachable over RPC (`store(name, method, args)`), per store. */
const STORE_METHODS = {
  messages: ["loadThread", "saveThread"],
  runs: ["createOrResume", "update", "get", "findActiveRun", "listByThread", "listByParentRun", "listReclaimable"],
  interrupts: ["create", "resolve", "cancel", "commitBatch", "get", "list", "listPending", "listByRun", "listPendingByRun"],
  metadata: ["get", "set", "delete", "getVersioned", "setIf"],
} as const;
export type ConversationStoreName = keyof typeof STORE_METHODS;

const notFound = () => Response.json({ error: "Not found", code: "not_found" }, { status: 404 });

/**
 * One conversation: its transcript, runs, pending approvals and stream log in this object's
 * SQLite (`sqliteConversationStorage`), and the chat turn itself, which runs here so it outlives
 * the request that started it. The lifecycle (ownership, turns, fencing, usage, audit,
 * retention) is the shared `Conversation`; this class is its RPC surface and alarm.
 *
 * - **RPC**: `claim`, `isOwner`, `transcript`, `stop`, `destroy`, each checking the owner. The raw
 *   store RPC (`store`) is user-agnostic on purpose: the conformance suite drives it, and only
 *   the Worker can reach a stub.
 * - **Routes** (`fetch`, `DO_ROUTES`): `POST /turn` answers with the run's SSE; `GET /join`
 *   replays the log from `Last-Event-ID`; `GET /hydrate` is what `useChat`'s `hydrate()` reads.
 * - **Alarm**: a heartbeat while a run is live, otherwise the idle deadline, when the object
 *   deletes everything and its index entry.
 *
 * The app's turn dependencies (the audit sink) come from {@link assistantConversation}'s factory.
 */
export class AssistantConversation<Env extends AssistantConversationEnv = AssistantConversationEnv> extends DurableObject<Env> {
  private readonly sqlite: ReturnType<typeof sqliteConversationStorage>;
  private readonly conversation: Conversation;
  private readonly makeDependencies: AssistantConversationDependenciesFactory<Env> | undefined;
  private dependencies: Promise<TurnDependencies> | undefined;

  constructor(ctx: DurableObjectState, env: Env, dependencies?: AssistantConversationDependenciesFactory<Env>) {
    super(ctx, env);
    this.makeDependencies = dependencies;
    this.sqlite = sqliteConversationStorage(ctx.storage);
    // No producer survives a restart: a run still marked `running` lost its driver.
    this.sqlite.failOrphanedRuns(Date.now());
    const index = env.ASSISTANT_INDEX;
    this.conversation = new Conversation({
      storage: this.sqlite,
      ...(index ? { index: durableConversationIndex(index) } : {}),
    });
  }

  // --- ownership & conversation lifecycle ---------------------------------------------------

  /** Open the conversation for `userKey`: the first caller becomes the owner. */
  async claim(input: ClaimInput): Promise<ClaimResult> {
    return this.conversation.claim(input);
  }

  /** Whether `userKey` owns this conversation. An unclaimed conversation has no owner. */
  async isOwner(userKey: string): Promise<boolean> {
    return this.conversation.isOwner(userKey);
  }

  /** The transcript for its owner, `null` for anyone else (and for a conversation that doesn't exist). */
  async transcript(userKey: string): Promise<ConversationTranscript | null> {
    return this.conversation.transcript(userKey);
  }

  /** Stop a live run (the user pressed Stop). `false` when it isn't running here. */
  async stop(userKey: string, runId: string): Promise<boolean> {
    return this.conversation.stop(userKey, runId);
  }

  /** Delete everything, for its owner. Kills a live run first. */
  async destroy(userKey: string): Promise<boolean> {
    return this.conversation.destroy(userKey);
  }

  // --- raw stores (user-agnostic; conformance and Worker-side reads) -------------------------

  /** `@tanstack/ai-persistence` store call over RPC: `store("messages", "loadThread", [threadId])`. */
  async store(name: ConversationStoreName, method: string, args: unknown[]): Promise<unknown> {
    const allowed = STORE_METHODS[name] as readonly string[] | undefined;
    if (!allowed || !allowed.includes(method)) throw new Error(`Unknown store method: ${name}.${method}`);
    const store = this.sqlite.persistence.stores[name] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    return await store[method]!(...args);
  }

  // --- routes --------------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userKey = request.headers.get(DO_HEADERS.user) ?? "";
    if (url.pathname === "/hydrate" && request.method === "GET") return this.conversation.hydrate(userKey, request);
    if (url.pathname === "/join" && request.method === "GET") return this.conversation.join(userKey, request);
    if (url.pathname === "/turn" && request.method === "POST") {
      if (!this.conversation.isOwner(userKey)) return notFound();
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const dependencies = await this.turnDependencies();
      const input: TurnInput = {
        // The conversation's own thread id replaces this one.
        threadId: request.headers.get(DO_HEADERS.thread) ?? "",
        runId: request.headers.get(DO_HEADERS.runId) ?? "",
        userKey,
        body,
        auth: { cookie: request.headers.get("Cookie") ?? "", origin: request.headers.get("Origin") ?? "" },
      };
      // The owner is checked again there, after the awaits: a delete in between answers 404.
      return this.conversation.startTurn(input, dependencies);
    }
    return notFound();
  }

  // --- retention -----------------------------------------------------------------------------

  override async alarm(): Promise<void> {
    await this.conversation.expire();
  }

  // --- helpers -------------------------------------------------------------------------------

  /** The app's dependencies (once per instance), the default turn runner, and the MCP transport. */
  private turnDependencies(): Promise<TurnDependencies> {
    this.dependencies ??= (async () => {
      const app = this.makeDependencies?.(this.env) ?? {};
      const turnRunner = app.turnRunner !== undefined ? app.turnRunner : await defaultTurnRunner();
      const self = this.env.ASSISTANT_SELF;
      return {
        turnRunner,
        mcpFetch: (auth) => (self ? serviceBindingMcpFetch({ fetcher: self, ...auth }) : missingSelfBinding),
        ...(app.audit ? { audit: app.audit } : {}),
      };
    })();
    return this.dependencies;
  }
}

/**
 * `createTurnRunner()`: a dynamic import in source; the `./do` bundle inlines it (the Worker
 * bundles the AI runtime for the endpoint anyway).
 */
async function defaultTurnRunner(): Promise<TurnRunner> {
  const { createTurnRunner } = await import("../server/turn");
  return createTurnRunner();
}

/**
 * The conversation class with the app's turn dependencies, built from `env` by `dependencies`:
 * what the Worker entry exports under the binding's class name (`AssistantConversation`), in
 * place of the plain class.
 *
 * ```ts
 * export const AssistantConversation = assistantConversation<Cloudflare.Env>((env) => ({
 *   audit: analyticsEngineAuditSink(env.ASSISTANT_AUDIT),
 * }))
 * export type AssistantConversation = InstanceType<typeof AssistantConversation>
 * ```
 */
export function assistantConversation<Env>(
  dependencies: AssistantConversationDependenciesFactory<Env>
): new (ctx: DurableObjectState, env: Env & AssistantConversationEnv) => AssistantConversation<Env & AssistantConversationEnv> {
  return class extends AssistantConversation<Env & AssistantConversationEnv> {
    constructor(ctx: DurableObjectState, env: Env & AssistantConversationEnv) {
      super(ctx, env, dependencies);
    }
  };
}
