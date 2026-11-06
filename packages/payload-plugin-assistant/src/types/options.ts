import type { PayloadRequest } from "payload";

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
 * A Durable Object stub, structurally. Declared here so the plugin needs no
 * `@cloudflare/workers-types`; a real `DurableObjectNamespace` is assignable.
 */
export interface ConversationStub {
  fetch(input: any, init?: any): Promise<any>;
}

/** A Durable Object namespace, structurally (`env.ASSISTANT` on a Worker). */
export interface ConversationNamespace {
  idFromName(name: string): any;
  get(id: any): ConversationStub;
}

export interface AssistantConversationsOptions {
  /**
   * The Durable Object namespace that holds the conversations. `chat()` runs inside the
   * conversation's Durable Object, so a run survives a closed tab and a reconnect is a log
   * read. Omit it for the in-memory fallback (Node dev and tests): conversations live in
   * the process and are lost on restart.
   */
  namespace: ConversationNamespace;
}

export interface AssistantPluginOptions {
  /** `false` returns the config untouched. Default `true`. */
  enabled?: boolean;
  /**
   * Who may use the assistant. Default: any signed-in user (`Boolean(user)`). Payload's own
   * access still applies to every tool call, as the same user.
   */
  access?: (user: PayloadRequest["user"]) => boolean | Promise<boolean>;
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
  /** Most model/tool round trips in one run. Default 10. */
  maxSteps?: number;
  /** Which MCP tools the model may see. Default: all of them. */
  toolFilter?: (tool: AssistantToolInfo) => boolean;
  /** Where conversations live. Default: in memory. */
  conversations?: AssistantConversationsOptions;
  /** Return `false` to answer 429. Checked after `access`, before any model call. */
  rateLimit?: (req: PayloadRequest) => boolean | Promise<boolean>;
}
