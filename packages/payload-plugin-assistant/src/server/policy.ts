import type { ChatMiddleware, ModelMessage } from "@tanstack/ai";
import type { MessageStore } from "@tanstack/ai-persistence";
import { auditDocumentIds, auditEventsFor, type AssistantAuditSink } from "../audit";
import type { TurnInput, TurnSettings } from "../conversations/types";
import { PLUGIN_NAME } from "../constants";
import { isEmptyPolicy, redactResultFor, redactTranscript, redactedReference, toolSlug, type RedactionPolicy } from "../redaction";
import { usageAmountOf, type UsageAmount } from "../usage";

/** What the policy middleware needs from the turn. */
export interface TurnPolicyOptions {
  input: Pick<TurnInput, "threadId" | "runId" | "userKey">;
  settings: Pick<TurnSettings, "model" | "redaction">;
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
 *   stored transcript see has the slug's redacted paths removed, and populated relations
 *   (`createdBy`…) lose their own collection's.
 * - **Hidden-field queries** (`onBeforeToolCall` → `skip`): a call whose `where`, `sort`, `select`
 *   or `findDistinct` field names a redacted field (directly or through a relation) doesn't run;
 *   the model gets an error saying why. For writes this happens when the approved call is applied
 *   (`chat()` asks no hook before the approval card, which shows a notice instead).
 * - **Audit** (`onAfterToolCall`): one event per document a successful call of a tool that needs
 *   approval (a write) changed, up to `AUDIT_DOCUMENT_EVENT_LIMIT` per run (Analytics Engine drops
 *   data points past 250 per invocation); past it one summary event per call. Reads don't need approval; a rejected approval never runs the tool
 *   (`chat()` calls no hook for it); a failed call has `ok: false`; a refused call is skipped.
 */
export function turnPolicyMiddleware(options: TurnPolicyOptions): ChatMiddleware {
  const { input, settings, recordUsage, audit } = options;
  const logError = options.logError ?? defaultLogError;
  const policy = settings.redaction;
  const redacting = !isEmptyPolicy(policy);
  /** Calls `onBeforeToolCall` refused: `chat()` still reports them to `onAfterToolCall` as `ok`. */
  const refused = new Set<string>();
  /** Per-document audit events this run already sent (the cap is per run, see `AUDIT_DOCUMENT_EVENT_LIMIT`). */
  let auditEmitted = 0;
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
    onBeforeToolCall(_ctx, hook) {
      if (!redacting) return undefined;
      const args = isRecord(hook.args) ? hook.args : argumentsOf(hook.toolCall.function.arguments);
      const field = redactedReference(policy, args, hook.toolName);
      if (!field) return undefined;
      refused.add(hook.toolCallId);
      return {
        type: "skip",
        result: `Error: "${field}" is a hidden field of "${String(args.slug)}": the assistant can't filter, sort, select or list distinct values by it. Leave it out of where, sort, select and field, and don't ask for its values.`,
      };
    },
    async onAfterToolCall(_ctx, info) {
      const args = argumentsOf(info.toolCall.function.arguments);
      const slug = toolSlug(args);
      // Errors too: a validation message can echo document values.
      const redacted = redacting ? redactResultFor(info.result, slug, policy) : info.result;

      if (audit && info.ok && info.tool?.needsApproval && !refused.has(info.toolCallId)) {
        const { events, emitted } = auditEventsFor(
          {
            userKey: input.userKey,
            userId,
            tool: info.toolName,
            collection: slug ?? "",
            conversationId: input.threadId,
            runId: input.runId,
            model: settings.model,
            timestamp: Date.now(),
          },
          auditDocumentIds(info.toolName, args, info.result),
          auditEmitted
        );
        auditEmitted = emitted;
        for (const event of events) {
          try {
            await audit(event);
          } catch (error) {
            logError("the audit sink failed", error);
          }
        }
      }
      return redacted !== info.result ? { type: "replaceResult", result: redacted } : undefined;
    },
  };
}

/** A message store whose saves drop redacted fields from tool results (`redactTranscript`). */
export function redactedMessageStore(store: MessageStore, policy: RedactionPolicy | undefined): MessageStore {
  if (isEmptyPolicy(policy)) return store;
  return {
    loadThread: store.loadThread.bind(store),
    saveThread: (threadId: string, messages: ModelMessage[]) => store.saveThread(threadId, redactTranscript(messages, policy)),
  };
}
