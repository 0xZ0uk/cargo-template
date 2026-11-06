import type { PayloadRequest } from "payload";
import type { AssistantAuditSink } from "../audit";
import type { ConversationCaps } from "../conversations/caps";
import type { RedactionMap } from "../redaction";
import type { AssistantBudget } from "../usage";

/** A model the assistant may use. The list is an allowlist: requests naming another id are refused. */
export interface AssistantModel {
  /** OpenRouter model id, e.g. `deepseek/deepseek-v4.1-flash`. */
  id: string;
  /** Name shown in the model picker. */
  label: string;
}

/** What `instructions` and `toolFilter` get to see about the request. */
export interface AssistantContext {
  req: PayloadRequest;
}

/** An MCP tool as the assistant sees it, for `toolFilter`. */
export interface AssistantToolInfo {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [key: string]: unknown };
}

/**
 * A conversation Durable Object stub, structurally: `fetch` plus the RPC methods of
 * `AssistantConversation` the endpoint calls. Declared here so the plugin needs no
 * `@cloudflare/workers-types`; a real `DurableObjectNamespace<AssistantConversation>` is assignable.
 */
export interface ConversationStub {
  fetch(input: any, init?: any): Promise<any>;
  claim(input: any): Promise<any>;
  transcript(userKey: string): Promise<any>;
  destroy(userKey: string): Promise<any>;
  stop(userKey: string, runId: string): Promise<any>;
  store(name: any, method: string, args: unknown[]): Promise<any>;
}

/** The conversation Durable Object namespace, structurally (`env.ASSISTANT_CONVERSATIONS`). */
export interface ConversationNamespace {
  idFromName(name: string): any;
  get(id: any): ConversationStub;
}

/** A per-user index Durable Object stub, structurally (`AssistantConversationIndex`). */
export interface ConversationIndexStub {
  call(method: any, args: unknown[]): Promise<any>;
  usage(tenantId: string, day: string, threadId?: string): Promise<any>;
}

/** The index Durable Object namespace, structurally (`env.ASSISTANT_INDEX`). */
export interface ConversationIndexNamespace {
  idFromName(name: string): any;
  get(id: any): ConversationIndexStub;
}

export interface AssistantConversationsOptions {
  /**
   * The `AssistantConversation` Durable Object namespace. `chat()` runs inside the
   * conversation's Durable Object, so a run survives a closed tab and a reconnect is a log
   * read. Omit the whole `conversations.namespace`/`index` pair for the in-memory fallback
   * (Node dev and tests): conversations live in the process and are lost on restart.
   */
  namespace?: ConversationNamespace;
  /** The `AssistantConversationIndex` namespace: one index object per user. Required with `namespace`. */
  index?: ConversationIndexNamespace;
  /** Delete a conversation after this many days without activity. Default 30. */
  retentionDays?: number;
  /** Size limits per conversation. See `ConversationCaps` for the defaults. */
  caps?: Partial<ConversationCaps>;
}

/** What `access` gets to decide with. `user` is always set: anonymous requests never reach it. */
export interface AssistantAccessArgs {
  req: PayloadRequest;
  user: NonNullable<PayloadRequest["user"]>;
}

export type AssistantAccess = (args: AssistantAccessArgs) => boolean | Promise<boolean>;

export interface AssistantPluginOptions {
  /** `false` returns the config untouched. Default `true`. */
  enabled?: boolean;
  /**
   * Who may use the assistant, for the chat endpoint (403) and the admin view (redirect to
   * `admin.routes.unauthorized`). Default: users of the admin auth collection
   * (`user.collection === config.admin.user`), the same gate as Payload's admin panel; a
   * session on another auth collection is refused. Payload's own access still applies to every
   * tool call, as the same user.
   */
  access?: AssistantAccess;
  /** The model allowlist. At least one entry, unique ids. */
  models: AssistantModel[];
  /** Id of the model preselected in the picker. Default: the first of `models`. */
  defaultModel?: string;
  /**
   * OpenRouter API key. Passed in: the plugin never reads `process.env`. Without it the plugin
   * warns and stays unconfigured (the endpoint and the admin view still exist, and say so).
   */
  apiKey: string | undefined;
  /** System prompt, or a function building it per request. */
  instructions?: string | ((context: AssistantContext) => string | Promise<string>);
  /** Most model calls in one run (each tool round trip is one). Default 10. */
  maxSteps?: number;
  /**
   * Compaction budget: when the transcript sent to the model passes this many estimated tokens,
   * old tool results are cleared, then the oldest turns dropped. Default 64,000. The stored
   * transcript is not changed.
   */
  maxContextTokens?: number;
  /** OpenRouter attribution title (`X-OpenRouter-Title`). Default "Payload admin assistant". */
  appTitle?: string;
  /** Which MCP tools the model may see. Default: all of them. */
  toolFilter?: (tool: AssistantToolInfo) => boolean;
  /** Where conversations live. Default: in memory. */
  conversations?: AssistantConversationsOptions;
  /** Return `false` to answer 429. Called per chat turn (send or resume), after `access`, before any model call. */
  rateLimit?: (req: PayloadRequest) => boolean | Promise<boolean>;
  /**
   * **Tests only.** Answer turns with a scripted model instead of OpenRouter (see the README,
   * "Test model"): no key, no network, `/tool <name> <JSON>` in a message calls that tool. Only
   * requests made to a loopback host (`localhost`, 127.0.0.1, ::1) use it; any other request
   * still needs `apiKey`, so a deployed Worker can't be switched to it. Default `false`.
   */
  testModel?: boolean;
  /**
   * Daily allowance per user (#68), counted from the cost OpenRouter reports for each model call
   * and reset at midnight UTC. A turn (send or approval) is refused with 402 `budget_exceeded`
   * before the model is called once a cap is reached; a run already going may overshoot it.
   * Default `{ dailyCostUsd: 5 }`; `false` turns budgets off.
   */
  budget?: AssistantBudget | false;
  /**
   * Fields the model never sees (#68): collection or global slug → dotted paths
   * (`{ customers: ['phone', 'address.street'] }`). Arrays and blocks rows are walked. Added to the
   * defaults: every auth collection hides `DEFAULT_AUTH_REDACTIONS` (email, API key, sessions,
   * hash, salt, reset and verification tokens, lockout state). Applied to tool results before the
   * model sees them, to the stored transcript and to the approval cards' current values.
   */
  redact?: RedactionMap;
  /**
   * Where applied writes are reported (#68), one event per write, no content. Used where the turn
   * runs in this process (the in-memory backend); the conversation Durable Object takes its sink
   * from `auditSink()`, which the app overrides (see the README, "Audit log"). Typically
   * `analyticsEngineAuditSink(env.ASSISTANT_AUDIT)` in both places.
   */
  audit?: AssistantAuditSink;
}
