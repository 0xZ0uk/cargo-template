export interface SseEvent {
  id?: string;
  data: Record<string, any>;
}

/**
 * Read SSE events from a response body; stop after `limit` events (then cancel = disconnect).
 * TanStack's first event on a durable run (`CUSTOM run.accepted`) is skipped: not part of the turn.
 */
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
      if (parsed.type === "CUSTOM" && parsed.name === "run.accepted") continue;
      events.push({ ...(id ? { id } : {}), data: parsed });
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

export const ofType = (events: SseEvent[], type: string) => events.filter((event) => event.data.type === type).map((event) => event.data);

export const textOf = (events: SseEvent[]) =>
  ofType(events, "TEXT_MESSAGE_CONTENT")
    .map((event) => event.delta)
    .join("");
