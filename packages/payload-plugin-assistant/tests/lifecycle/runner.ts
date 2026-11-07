import type { StreamChunk } from "@tanstack/ai";
import type { TurnContext } from "../../src/conversations/types";

/*
 * The turn the lifecycle suite runs, in both storages (memory in Node, the Durable Object under
 * workerd). No model: what it does comes from the turn body, plain JSON, so it crosses into the
 * object as is.
 */

/** What the suite's turn body may say. */
export interface LifecycleTurnBody {
  /** Text deltas before the transcript save (default 8). */
  steps?: number;
  /** Delay before each delta (default 40 ms). */
  delayMs?: number;
  /** The user message saved with the reply. */
  message?: string;
  /** One model call's usage, recorded before the first delta. */
  usage?: { costUsd: number; tokens: number };
  /** Usage recorded `delayMs` after the turn started, whatever happened to it meanwhile (the fence test). */
  lateUsage?: { costUsd: number; tokens: number; delayMs: number };
  /** One audit event, reported before the first delta. */
  audit?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const chunk = (value: Record<string, unknown>) => ({ timestamp: Date.now(), ...value }) as unknown as StreamChunk;

/**
 * Text deltas with a delay, then the transcript save `withPersistence` would do. Honors the stop
 * signal the way the real turn does: a stopped run ends with a `RUN_ERROR` whose code is `stopped`.
 */
export async function* lifecycleTurn({ input, persistence, signal, recordUsage, audit }: TurnContext): AsyncIterable<StreamChunk> {
  const { threadId, runId } = input;
  const body = input.body as LifecycleTurnBody;
  const steps = Number(body.steps ?? 8);
  const delayMs = Number(body.delayMs ?? 40);
  if (body.lateUsage) {
    const { delayMs: after, ...amount } = body.lateUsage;
    setTimeout(() => void recordUsage?.(amount).catch(() => {}), after);
  }
  await persistence.stores.runs.createOrResume({ runId, threadId, startedAt: Date.now() });
  yield chunk({ type: "RUN_STARTED", threadId, runId });
  if (body.usage) await recordUsage?.(body.usage);
  if (body.audit) {
    await audit?.({
      userKey: input.userKey,
      userId: input.userKey.split(":").pop() ?? "",
      tool: "updateDocument",
      collection: "pages",
      documentId: "1",
      conversationId: threadId,
      runId,
      model: "lifecycle",
      timestamp: Date.now(),
    });
  }
  let text = "";
  for (let i = 0; i < steps; i++) {
    await sleep(delayMs);
    if (signal.aborted) {
      await persistence.stores.runs.update(runId, { status: "aborted", finishedAt: Date.now() });
      yield chunk({ type: "RUN_ERROR", message: "Stopped.", code: "stopped", error: { message: "Stopped.", code: "stopped" } });
      return;
    }
    text += `part${i} `;
    yield chunk({ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: `part${i} ` });
  }
  const history = await persistence.stores.messages.loadThread(threadId);
  await persistence.stores.messages.saveThread(threadId, [
    ...history,
    { role: "user", content: String(body.message ?? "hi") },
    { role: "assistant", content: text.trim() },
  ]);
  await persistence.stores.runs.update(runId, { status: "completed", finishedAt: Date.now() });
  yield chunk({ type: "RUN_FINISHED", threadId, runId });
}
