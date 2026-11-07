import { parseResult, type ToolCall } from "./toolCalls";

/**
 * The audit log (#68): one event per document an applied write changed (a summary event past
 * {@link AUDIT_DOCUMENT_EVENT_LIMIT}), no content. Pure (no runtime imports): the
 * turn runner emits events, the app supplies the sink.
 */

/** One write the assistant applied: who, which tool, on what, in which conversation, with which model. */
export interface AssistantAuditEvent {
  /** `<auth collection>:<user id>`, the conversation's owner. */
  userKey: string;
  /** The user's id, without the collection. */
  userId: string;
  /** The MCP tool that wrote (`updateDocument`, `createDocument`, `setRichTextFromMarkdown`…). */
  tool: string;
  /** Collection or global slug (the call's `slug` argument), `""` when it had none. */
  collection: string;
  /**
   * The document changed: one event per document. The call's `id`, or the ids plugin-mcp lists in
   * its result (created documents, update or delete by `where`, the copy of a duplicate); `""`
   * when it can't be told (a global, a custom tool without ids in its result).
   */
  documentId: string;
  /** The conversation (thread id). */
  conversationId: string;
  /** The run that applied it. */
  runId: string;
  /** OpenRouter model id. */
  model: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /**
   * Only on a summary event (`documentId` is {@link AUDIT_SUMMARY_DOCUMENT_ID}): how many
   * documents the call changed that got no event of their own, because the run had already
   * emitted {@link AUDIT_DOCUMENT_EVENT_LIMIT} per-document events. Absent (one document) otherwise.
   */
  documents?: number;
}

/**
 * Per-document events one run may emit. Workers Analytics Engine takes at most 250 data points
 * per Worker invocation (and drops the rest), so a large write by `where` would lose events
 * silently. Past this limit a tool call emits one summary event instead (a run makes at most
 * `maxToolCalls` ≤ 25 calls, so the summaries fit in the 50 points that remain).
 */
export const AUDIT_DOCUMENT_EVENT_LIMIT = 200;

/** `documentId` of a summary event ("many documents, not listed one by one"); `""` is a global or an unknown id. */
export const AUDIT_SUMMARY_DOCUMENT_ID = "*";

/**
 * The events for one successful write: one per document id while the run has room (`emitted`,
 * the per-document events it already sent, counts against {@link AUDIT_DOCUMENT_EVENT_LIMIT}),
 * then one summary event for the documents that didn't fit. `base` is the event without
 * `documentId`.
 */
export function auditEventsFor(
  base: Omit<AssistantAuditEvent, "documentId" | "documents">,
  documentIds: readonly string[],
  emitted = 0,
  limit = AUDIT_DOCUMENT_EVENT_LIMIT
): { events: AssistantAuditEvent[]; emitted: number } {
  const room = Math.max(0, limit - emitted);
  const listed = documentIds.slice(0, room);
  const events: AssistantAuditEvent[] = listed.map((documentId) => ({ ...base, documentId }));
  const rest = documentIds.length - listed.length;
  if (rest > 0) events.push({ ...base, documentId: AUDIT_SUMMARY_DOCUMENT_ID, documents: rest });
  return { events, emitted: emitted + listed.length };
}

/**
 * Where audit events go. Called once per document a successful write changed (up to
 * {@link AUDIT_DOCUMENT_EVENT_LIMIT} per run, then once per call with a summary), never for reads, rejected approvals or
 * failed calls. Errors are logged and swallowed: auditing never fails a run.
 */
export type AssistantAuditSink = (event: AssistantAuditEvent) => void | Promise<void>;

/** The part of an Analytics Engine dataset binding the sink uses (no `@cloudflare/workers-types`). */
export interface AnalyticsEngineDatasetLike {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

/**
 * A sink that writes each event to a Workers Analytics Engine dataset: index = the user key
 * (sampling key), blobs = `[userKey, tool, collection, documentId, conversationId, model, runId]`,
 * doubles = `[documents]`: 1, or the count of a summary event (`documentId` `"*"`); count documents with `SUM(double1 * _sample_interval)`. `undefined` dataset (Node dev, tests
 * without the binding): `undefined`, i.e. no audit.
 *
 * ```sql
 * SELECT timestamp, blob1 AS user, blob2 AS tool, blob3 AS collection, blob4 AS document
 * FROM assistant_audit WHERE timestamp > NOW() - INTERVAL '7' DAY ORDER BY timestamp DESC
 * ```
 */
export function analyticsEngineAuditSink(dataset: AnalyticsEngineDatasetLike | undefined): AssistantAuditSink | undefined {
  if (!dataset) return undefined;
  return (event) => {
    dataset.writeDataPoint({
      indexes: [event.userKey.slice(0, 96)],
      blobs: [event.userKey, event.tool, event.collection, event.documentId, event.conversationId, event.model, event.runId],
      doubles: [event.documents ?? 1],
    });
  };
}

/**
 * The documents a successful write changed, one id each (`""` when it can't be told, e.g. a
 * global, or a result without ids). Never a wrong id:
 *
 * - Globals: `[""]` (one global, no document id).
 * - `duplicateDocument` / `restoreVersion`: the result's document (the copy, the restored
 *   document), not the `id` argument (the source, the version).
 * - Otherwise the call's `id` argument when it has one.
 * - Otherwise (create, update or delete by `where`) the ids of the documents plugin-mcp lists in
 *   its result ({@link parseResult}): documents that failed are not listed, and a write that
 *   changed nothing ("Updated: 0 documents") gives no ids.
 */
export function auditDocumentIds(call: ToolCall, result: unknown): string[] {
  if (call.target?.kind === "global") return [""];
  const fromResult = () => parseResult(result).ids;
  if (call.operation === "duplicate" || call.operation === "restore") return (fromResult() ?? [""]).slice(0, 1);
  if (call.id) return [call.id];
  return fromResult() ?? [""];
}
