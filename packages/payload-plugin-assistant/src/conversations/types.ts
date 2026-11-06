import type { ModelMessage, RunRecord, StreamChunk } from "@tanstack/ai";
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

/** What the Worker endpoint (#63) hands to the conversation for one turn. */
export interface TurnInput {
  threadId: string;
  /** Client-chosen (`X-Run-Id`) or minted by the endpoint. */
  runId: string;
  userKey: string;
  /** The request body as #63 defines it: new messages, `resume` decisions, the model id… */
  body: Record<string, unknown>;
  /**
   * The admin's `Cookie` and the admin request's `Origin`, forwarded to `POST /api/mcp` so every
   * tool call runs as that user, through Payload's own auth and CSRF checks. Held in memory for
   * the run only; never stored.
   */
  auth: { cookie: string; origin: string };
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
  /** Open (first writer becomes the owner) or re-open a conversation. */
  claim(userKey: string, threadId: string): Promise<ClaimResult>;
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
  /** The caller's conversations, newest first. */
  list(userKey: string, options?: Pick<SessionIndexListOptions, "limit" | "cursor" | "search" | "withArchived">): Promise<SessionIndexPage>;
  /** Set the title. `false` when not owned. */
  rename(userKey: string, threadId: string, title: string): Promise<boolean>;
  /** Delete the transcript, runs, approvals, stream logs and index entry. `false` when not owned. */
  remove(userKey: string, threadId: string): Promise<boolean>;
}


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
} as const;
