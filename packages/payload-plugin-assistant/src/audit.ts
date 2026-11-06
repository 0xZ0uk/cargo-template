/**
 * The audit log (#68): one event per applied write, no content. Pure (no runtime imports): the
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
  /** The document id: the call's `id`, or the created document's id from the result; `""` when unknown (a write by `where`). */
  documentId: string;
  /** The conversation (thread id). */
  conversationId: string;
  /** The run that applied it. */
  runId: string;
  /** OpenRouter model id. */
  model: string;
  /** Epoch milliseconds. */
  timestamp: number;
}

/**
 * Where audit events go. Called once per successful write, never for reads, rejected approvals or
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
 * doubles = `[1]` (count with `SUM(_sample_interval)`). `undefined` dataset (Node dev, tests
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
      doubles: [1],
    });
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const idText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/**
 * The id a write targeted: the call's `id` argument; for a create, the created document's id in
 * the result (plugin-mcp prints it as JSON in the text). `""` when there is none.
 */
export function auditDocumentId(input: unknown, result: unknown): string {
  if (isRecord(input) && idText(input.id)) return idText(input.id);
  const text =
    typeof result === "string"
      ? result
      : Array.isArray(result)
        ? result.map((part) => (isRecord(part) && typeof part.content === "string" ? part.content : "")).join("\n")
        : undefined;
  if (text) {
    const match = /"id"\s*:\s*("([^"\\]{1,128})"|(\d{1,20}))/.exec(text);
    if (match) return match[2] ?? match[3] ?? "";
  }
  if (isRecord(result)) {
    if (idText(result.id)) return idText(result.id);
    if (isRecord(result.doc) && idText(result.doc.id)) return idText(result.doc.id);
  }
  return "";
}
