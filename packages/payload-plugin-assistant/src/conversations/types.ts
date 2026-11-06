import type { ModelMessage, RunAgentResumeItem, RunRecord, StreamChunk } from "@tanstack/ai";
import type {
  ChatWithInterruptsPersistence,
  InterruptRecord,
  SessionIndexListOptions,
  SessionIndexPage,
} from "@tanstack/ai-persistence";

/**
 * Who owns a conversation: `<auth collection>:<user id>`. The collection is part of the key so
 * two auth collections with overlapping ids (when a custom `access` admits both) never share
 * conversations. Derived server-side from `req.user`, never from the client.
 */
export function userKeyOf(user: { collection?: string; id: string | number }): string {
  return `${user.collection ?? "users"}:${String(user.id)}`;
}

/**
 * Everything a turn needs that only the Worker knows, resolved per request by the endpoint and
 * sent along with the turn: plain data, because the turn runs in another object (the
 * conversation's Durable Object) that has neither the plugin's options nor `req`.
 */
export interface TurnSettings {
  /** OpenRouter model id, already checked against the allowlist. */
  model: string;
  /** The OpenRouter key. Held in memory for the run only; never stored or logged. */
  apiKey: string;
  /** The full system prompt (site, collections, conventions, the app's `instructions`). */
  systemPrompt: string;
  /** Most model calls in the run (`maxIterations`). */
  maxSteps: number;
  /** Most tool calls in the run (the Worker invocation limit). Absent: `DEFAULT_MAX_TOOL_CALLS`. */
  maxToolCalls?: number;
  /** Compaction budget: older turns are cleared or dropped past this many (estimated) tokens. */
  maxContextTokens: number;
  /** Absolute URL of plugin-mcp's `POST /api/mcp`. */
  mcpEndpoint: string;
  /**
   * The tools the app's `toolFilter` admitted, by name, when it has one (evaluated on the Worker,
   * where the function lives). Absent: every tool after the built-in filter.
   */
  toolNames?: string[];
  /** OpenRouter attribution headers (`HTTP-Referer`, `X-OpenRouter-Title`). */
  httpReferer: string;
  appTitle: string;
  /**
   * Use the scripted test model instead of OpenRouter. Set by the endpoint only when the app
   * turned `testModel` on and the request was made to a loopback host (`usesTestModel`).
   */
  testModel?: boolean;
}

/** The body of a turn, as the endpoint validated it. `TurnInput.body` carries this. */
export interface ChatTurnBody {
  /** The new user message (one), or none on a resume. The stored transcript is the history. */
  messages: ModelMessage[];
  /** Approval decisions: `{ interruptId, status: 'resolved', payload: { approved } }` per interrupt. */
  resume?: RunAgentResumeItem[];
  settings: TurnSettings;
}

/** What the Worker endpoint (#63) hands to the conversation for one turn. */
export interface TurnInput {
  threadId: string;
  /** Client-chosen (`X-Run-Id`) or minted by the endpoint. */
  runId: string;
  userKey: string;
  /** The turn as #63 defines it: a {@link ChatTurnBody} (test runners may pass anything). */
  body: Record<string, unknown>;
  /**
   * The admin's `Cookie` and the admin request's `Origin`, forwarded to `POST /api/mcp` so every
   * tool call runs as that user, through Payload's own auth and CSRF checks. Held in memory for
   * the run only; never stored.
   */
  auth: { cookie: string; origin: string };
  /** The conversation's title when this turn creates it (the first message, cut). */
  title?: string;
}

/** What a turn runner gets inside the conversation (Durable Object, or the in-memory fallback). */
export interface TurnContext {
  input: TurnInput;
  /** The conversation's stores (`messages` capped), for `withPersistence(persistence)`. */
  persistence: ChatWithInterruptsPersistence;
  /**
   * The `fetch` for the MCP transport (#61's injectable dispatcher). In the Durable Object it
   * goes through the Worker's own service binding (`ASSISTANT_SELF`) with `auth` applied.
   */
  mcpFetch: typeof fetch;
  /** Aborted only by an explicit stop, never by a client disconnect. */
  signal: AbortSignal;
}

/**
 * The chat turn (#63): `chat({ …, threadId, runId, middleware: [withPersistence(persistence)] })`.
 * The conversation pipes the returned stream into its durable log and serves it as SSE.
 */
export type TurnRunner = (context: TurnContext) => AsyncIterable<StreamChunk>;

/** What the admin UI loads when it opens a conversation. */
export interface ConversationTranscript {
  threadId: string;
  messages: ModelMessage[];
  /** Pending approvals, oldest first (the binding metadata stays server-side). */
  pendingInterrupts: InterruptRecord[];
  /** The live run to rejoin with `GET …?runId=…` (`Last-Event-ID: -1` replays it from the start). */
  activeRun: RunRecord | null;
}

export type ClaimResult = { ok: true; created: boolean } | { ok: false };

/**
 * One backend for the endpoint, two implementations: Durable Objects on Workers
 * (`durableObjectConversations`, from `./do`) and memory for Node (`memoryConversations`).
 *
 * Every method takes the caller's `userKey` and checks ownership itself: a conversation id
 * alone is never access. A conversation another user owns answers like a missing one.
 */
export interface ConversationBackend {
  /** Open (first writer becomes the owner) or re-open a conversation. `title` is used when it is created. */
  claim(userKey: string, threadId: string, title?: string): Promise<ClaimResult>;
  /** The transcript, or `null` when the conversation is missing or not the caller's. */
  transcript(userKey: string, threadId: string): Promise<ConversationTranscript | null>;
  /**
   * Start a turn. Claims the conversation, then answers with the run's SSE stream. The run lives
   * in the conversation, not in this request: a closed tab doesn't stop it. 404 when not owned.
   */
  startTurn(input: TurnInput): Promise<Response>;
  /**
   * Rejoin a run from its log (`Last-Event-ID` header or `?offset`, plus `X-Run-Id` / `?runId`).
   * Never starts a model call or an MCP client. 404 when not owned.
   */
  join(userKey: string, threadId: string, request: Request): Promise<Response>;
  /**
   * Stop a live run (the user pressed Stop): its `chat()` is aborted, it ends with a `RUN_ERROR`
   * whose `code` is `"stopped"`, and its run record is `aborted`. `false` when the run isn't
   * live here or the conversation isn't the caller's. A closed tab never stops a run; this does.
   */
  stop(userKey: string, threadId: string, runId: string): Promise<boolean>;
  /**
   * The conversation for the admin UI, as TanStack's `reconstructChat` builds it (the body
   * `useChat`'s `hydrate()` expects): `{ messages: UIMessage[], activeRun, interrupts, page? }`.
   * `request` carries the optional `?limit=` / `?before=` paging. A missing conversation, or one
   * another user owns, answers the empty transcript (200), like a new conversation.
   */
  hydrate(userKey: string, threadId: string, request: Request): Promise<Response>;
  /** The caller's conversations, newest first. */
  list(userKey: string, options?: Pick<SessionIndexListOptions, "limit" | "cursor" | "search" | "withArchived">): Promise<SessionIndexPage>;
  /** Set the title. `false` when not owned. */
  rename(userKey: string, threadId: string, title: string): Promise<boolean>;
  /** Delete the transcript, runs, approvals, stream logs and index entry. `false` when not owned. */
  remove(userKey: string, threadId: string): Promise<boolean>;
}


/** The hydration body of a conversation that doesn't exist (or isn't the caller's): a new conversation. */
export const EMPTY_HYDRATION = { messages: [], activeRun: null, interrupts: null } as const;

/** Headers of the Worker → Durable Object protocol (internal; the stub is only reachable from the Worker). */
export const DO_HEADERS = {
  user: "X-Assistant-User",
  thread: "X-Assistant-Thread",
  runId: "X-Run-Id",
} as const;

/** Paths of the Worker → Durable Object protocol. The host is ignored. */
export const DO_ROUTES = {
  turn: "https://assistant.internal/turn",
  join: "https://assistant.internal/join",
  hydrate: "https://assistant.internal/hydrate",
} as const;
