import { env } from "cloudflare:test";
import { durableObjectConversations } from "../../src/conversations/durableObject";
import { DEFAULT_CONVERSATION_CAPS } from "../../src/conversations/caps";
import type { TurnInput } from "../../src/conversations/types";
import { ADMIN_ORIGIN, GOOD_COOKIE, type Env } from "./worker";

export const bindings = env as unknown as Env;

export const DAY = 24 * 60 * 60 * 1000;

export function backend(retentionMs = 30 * DAY) {
  return durableObjectConversations({
    conversations: bindings.ASSISTANT_CONVERSATIONS,
    index: bindings.ASSISTANT_INDEX,
    retentionMs,
    caps: DEFAULT_CONVERSATION_CAPS,
  });
}

export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function turn(userKey: string, threadId: string, body: Record<string, unknown> = {}, auth = { cookie: GOOD_COOKIE, origin: ADMIN_ORIGIN }): TurnInput {
  return { userKey, threadId, runId: newId("run"), body, auth };
}

export interface SseEvent {
  id?: string;
  data: Record<string, any>;
}

/** Read SSE events from a response body; stop after `limit` events (then cancel = disconnect). */
export async function readEvents(response: Response, limit = Infinity): Promise<SseEvent[]> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const events: SseEvent[] = [];
  let buffer = "";
  while (events.length < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1 && events.length < limit) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const id = /^id: ?(.*)$/m.exec(block)?.[1];
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data: ?/, ""))
        .join("\n");
      if (!data) continue;
      const parsed = JSON.parse(data);
      // TanStack's first event on a durable run ("run.accepted"), not part of the turn.
      if (parsed.type === "CUSTOM" && parsed.name === "run.accepted") continue;
      events.push({ ...(id ? { id } : {}), data: parsed });
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}
