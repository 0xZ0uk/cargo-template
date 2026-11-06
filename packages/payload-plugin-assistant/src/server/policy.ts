import type { ChatMiddleware, ModelMessage } from "@tanstack/ai";
import type { MessageStore } from "@tanstack/ai-persistence";
import { auditDocumentId, type AssistantAuditSink } from "../audit";
import type { TurnInput, TurnSettings } from "../conversations/types";
import { PLUGIN_NAME } from "../constants";
import { redactToolResult, redactTranscript, toolSlug, type RedactionMap } from "../redaction";
import { usageAmountOf, type UsageAmount } from "../usage";

/** What the policy middleware needs from the turn. */
export interface TurnPolicyOptions {
  input: Pick<TurnInput, "threadId" | "runId" | "userKey">;
  settings: Pick<TurnSettings, "model" | "redact">;
  /** Adds one model call's usage to the user's day and the conversation (the index object). */
  recordUsage?: (amount: UsageAmount) => Promise<void>;
  audit?: AssistantAuditSink;
  logError?: (message: string, error: unknown) => void;
}

const defaultLogError = (message: string, error: unknown) => console.error(`[${PLUGIN_NAME}] ${message}`, error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function argumentsOf(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The turn's policies (#68), as one `chat()` middleware, where every model call and every tool
 * result passes:
 *
 * - **Usage** (`onUsage`, once per model call, failed calls included): `recordUsage` adds it to the
 *   user's UTC day and the conversation, inside the run, so it is recorded whether or not anyone
 *   is still watching (the run lives in the conversation, not in the request).
 * - **Redaction** (`onAfterToolCall` → `replaceResult`): the result the model, the stream and the
 *   stored transcript see has the slug's redacted paths removed.
 * - **Audit** (`onAfterToolCall`): one event per successful call of a tool that needs approval (a
 *   write). Reads don't need approval; a rejected approval never runs the tool (`chat()` calls no
 *   hook for it); a failed call has `ok: false`.
 */
export function turnPolicyMiddleware(options: TurnPolicyOptions): ChatMiddleware {
  const { input, settings, recordUsage, audit } = options;
  const logError = options.logError ?? defaultLogError;
  const redact = settings.redact ?? {};
  const [userCollection, ...rest] = input.userKey.split(":");
  const userId = rest.length ? rest.join(":") : (userCollection ?? "");

  return {
    name: "assistant-policy",
    async onUsage(_ctx, usage) {
      if (!recordUsage) return;
      const amount = usageAmountOf(usage);
      if (amount.costUsd === 0 && amount.tokens === 0) return;
      try {
        await recordUsage(amount);
      } catch (error) {
        logError("recording usage failed", error);
      }
    },
    async onAfterToolCall(_ctx, info) {
      const args = argumentsOf(info.toolCall.function.arguments);
      const slug = toolSlug(args);
      const paths = slug ? redact[slug] : undefined;
      // Errors too: a validation message can echo document values.
      const redacted = paths?.length ? redactToolResult(info.result, paths) : info.result;

      if (audit && info.ok && info.tool?.needsApproval) {
        try {
          await audit({
            userKey: input.userKey,
            userId,
            tool: info.toolName,
            collection: slug ?? "",
            documentId: auditDocumentId(args, info.result),
            conversationId: input.threadId,
            runId: input.runId,
            model: settings.model,
            timestamp: Date.now(),
          });
        } catch (error) {
          logError("the audit sink failed", error);
        }
      }
      return redacted !== info.result ? { type: "replaceResult", result: redacted } : undefined;
    },
  };
}

/** A message store whose saves drop redacted fields from tool results (`redactTranscript`). */
export function redactedMessageStore(store: MessageStore, map: RedactionMap | undefined): MessageStore {
  if (!map || Object.keys(map).length === 0) return store;
  return {
    loadThread: store.loadThread.bind(store),
    saveThread: (threadId: string, messages: ModelMessage[]) => store.saveThread(threadId, redactTranscript(messages, map)),
  };
}
