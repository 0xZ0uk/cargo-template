import type { PayloadRequest } from "payload";
import { DEFAULT_APP_TITLE, DEFAULT_MAX_CONTEXT_TOKENS, DEFAULT_MAX_STEPS, DEFAULT_RETENTION_DAYS, PLUGIN_NAME } from "../constants";
import type {
  AssistantAccess,
  AssistantContext,
  AssistantModel,
  AssistantPluginOptions,
  AssistantToolInfo,
  ConversationIndexNamespace,
  ConversationNamespace,
} from "../types/options";
import { resolveCaps, type ConversationCaps } from "../conversations/caps";
import { OPENROUTER_PROVIDER } from "./provider";

const PREFIX = `[${PLUGIN_NAME}]`;

export { OPENROUTER_PROVIDER };

export type ConversationStorage =
  | { kind: "memory"; retentionMs: number; caps: ConversationCaps }
  | {
      kind: "durable-object";
      namespace: ConversationNamespace;
      index: ConversationIndexNamespace;
      retentionMs: number;
      caps: ConversationCaps;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeConversations(options: AssistantPluginOptions["conversations"]): ConversationStorage {
  const retentionDays = options?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (typeof retentionDays !== "number" || !Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(`${PREFIX} "conversations.retentionDays" must be a positive number (got ${String(retentionDays)}).`);
  }
  const retentionMs = Math.round(retentionDays * DAY_MS);
  const caps = resolveCaps(options?.caps, PREFIX);
  const { namespace, index } = options ?? {};
  if (!namespace && !index) return { kind: "memory", retentionMs, caps };
  if (!namespace || !index) {
    throw new Error(
      `${PREFIX} "conversations.namespace" and "conversations.index" go together (AssistantConversation and AssistantConversationIndex).`
    );
  }
  return { kind: "durable-object", namespace, index, retentionMs, caps };
}

export interface NormalizedAssistantOptions {
  /** `false` when `apiKey` is missing (and `testModel` is off): schema and admin shape stay the same, the assistant says "not configured". */
  configured: boolean;
  access: AssistantAccess;
  models: AssistantModel[];
  defaultModel: string;
  apiKey: string;
  instructions: string | ((context: AssistantContext) => string | Promise<string>) | undefined;
  maxSteps: number;
  maxContextTokens: number;
  appTitle: string;
  toolFilter: ((tool: AssistantToolInfo) => boolean) | undefined;
  conversations: ConversationStorage;
  rateLimit: ((req: PayloadRequest) => boolean | Promise<boolean>) | undefined;
  openRouter: { provider: typeof OPENROUTER_PROVIDER };
  /** Scripted test model for loopback requests (`usesTestModel`). */
  testModel: boolean;
}

/**
 * Only users of the admin auth collection, matching Payload's own admin gate. `Boolean(user)`
 * would admit a session on any other auth collection (front-office customers, members), which
 * could then spend the OpenRouter credit.
 */
export const defaultAccess: AssistantAccess = ({ user, req }) => {
  const adminCollection = req?.payload?.config?.admin?.user;
  return Boolean(user) && typeof adminCollection === "string" && user.collection === adminCollection;
};

/**
 * Validates and fills in defaults. Throws on programmer errors (a bad allowlist, a bad
 * `maxSteps`), which should fail the build; a missing `apiKey` only warns, so `generate:*`,
 * `migrate:create` and tests run before secrets exist.
 */
export function normalizeOptions(options: AssistantPluginOptions): NormalizedAssistantOptions {
  const { models } = options;
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error(`${PREFIX} "models" must list at least one model ({ id, label }).`);
  }
  const seen = new Set<string>();
  for (const model of models) {
    if (!model || typeof model.id !== "string" || model.id.trim() === "") {
      throw new Error(`${PREFIX} every entry of "models" needs a non-empty "id".`);
    }
    if (seen.has(model.id)) {
      throw new Error(`${PREFIX} duplicate model id "${model.id}" in "models".`);
    }
    seen.add(model.id);
  }

  const defaultModel = options.defaultModel ?? models[0]!.id;
  if (!seen.has(defaultModel)) {
    throw new Error(`${PREFIX} "defaultModel" "${defaultModel}" is not one of the ids in "models".`);
  }

  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new Error(`${PREFIX} "maxSteps" must be a positive integer (got ${String(maxSteps)}).`);
  }

  const maxContextTokens = options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  if (!Number.isInteger(maxContextTokens) || maxContextTokens < 1000) {
    throw new Error(`${PREFIX} "maxContextTokens" must be an integer of at least 1000 (got ${String(maxContextTokens)}).`);
  }

  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const testModel = options.testModel === true;
  if (testModel) {
    console.warn(`${PREFIX} "testModel" is on: turns sent to localhost use a scripted test model, not OpenRouter. Tests only.`);
  } else if (!apiKey) {
    console.warn(
      `${PREFIX} "apiKey" is missing: the assistant is not configured. The endpoint and the admin view stay registered and report that.`
    );
  }

  return {
    // The view's notice. With `testModel` the endpoints still check per request (`configuredFor`).
    configured: apiKey !== "" || testModel,
    access: options.access ?? defaultAccess,
    models,
    defaultModel,
    apiKey,
    instructions: options.instructions,
    maxSteps,
    maxContextTokens,
    appTitle: options.appTitle?.trim() || DEFAULT_APP_TITLE,
    toolFilter: options.toolFilter,
    conversations: normalizeConversations(options.conversations),
    rateLimit: options.rateLimit,
    openRouter: { provider: OPENROUTER_PROVIDER },
    testModel,
  };
}
