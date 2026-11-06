import type { PayloadRequest } from "payload";
import { DEFAULT_MAX_STEPS, PLUGIN_NAME } from "../constants";
import type {
  AssistantContext,
  AssistantModel,
  AssistantPluginOptions,
  AssistantToolInfo,
  ConversationNamespace,
} from "../types/options";

const PREFIX = `[${PLUGIN_NAME}]`;

/**
 * OpenRouter provider routing, applied to every request: drafts reach the model, so providers
 * that log or train on prompts are excluded and the model's parameters must be honoured.
 *
 * The keys MUST be camelCase. The SDK serialises them to `require_parameters` and
 * `data_collection`; the snake_case spelling is silently dropped by its schema, which would
 * send drafts to any provider. (#63 asserts the serialised request body.)
 */
export const OPENROUTER_PROVIDER = {
  requireParameters: true,
  dataCollection: "deny",
} as const;

export type ConversationStorage =
  | { kind: "memory" }
  | { kind: "durable-object"; namespace: ConversationNamespace };

export interface NormalizedAssistantOptions {
  /** `false` when `apiKey` is missing: schema and admin shape stay the same, the assistant says "not configured". */
  configured: boolean;
  access: (user: PayloadRequest["user"]) => boolean | Promise<boolean>;
  models: AssistantModel[];
  defaultModel: string;
  apiKey: string;
  instructions: string | ((context: AssistantContext) => string | Promise<string>) | undefined;
  maxSteps: number;
  toolFilter: ((tool: AssistantToolInfo) => boolean) | undefined;
  conversations: ConversationStorage;
  rateLimit: ((req: PayloadRequest) => boolean | Promise<boolean>) | undefined;
  openRouter: { provider: typeof OPENROUTER_PROVIDER };
}

const defaultAccess = (user: PayloadRequest["user"]) => Boolean(user);

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

  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (!apiKey) {
    console.warn(
      `${PREFIX} "apiKey" is missing: the assistant is not configured. The endpoint and the admin view stay registered and report that.`
    );
  }

  return {
    configured: apiKey !== "",
    access: options.access ?? defaultAccess,
    models,
    defaultModel,
    apiKey,
    instructions: options.instructions,
    maxSteps,
    toolFilter: options.toolFilter,
    conversations: options.conversations
      ? { kind: "durable-object", namespace: options.conversations.namespace }
      : { kind: "memory" },
    rateLimit: options.rateLimit,
    openRouter: { provider: OPENROUTER_PROVIDER },
  };
}
