import type { StreamChunk } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { conversationBackend } from "../src/conversations/backend";
import { memoryConversations } from "../src/conversations/memory";
import { normalizeOptions } from "../src/utils/normalizeOptions";
import type { TurnContext, TurnInput } from "../src/conversations/types";

const chunk = (value: Record<string, unknown>) => ({ timestamp: Date.now(), ...value }) as unknown as StreamChunk;

async function* turnRunner({ input, persistence }: TurnContext): AsyncIterable<StreamChunk> {
  yield chunk({ type: "RUN_STARTED", threadId: input.threadId, runId: input.runId });
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield chunk({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: `p${i}` });
  }
  await persistence.stores.messages.saveThread(input.threadId, [
    { role: "user", content: String(input.body.message) },
    { role: "assistant", content: "done" },
  ]);
  yield chunk({ type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId });
}

const input = (userKey: string, threadId: string, runId = crypto.randomUUID()): TurnInput => ({
  userKey,
  threadId,
  runId,
  body: { message: "draft" },
  auth: { cookie: "payload-token=x", origin: "http://localhost" },
});

async function events(response: Response, limit = Infinity) {
  const text: string[] = [];
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const out: Array<{ id?: string; type: string }> = [];
  while (out.length < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1 && out.length < limit) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      text.push(block);
      const data = JSON.parse(/^data: ?(.*)$/m.exec(block)![1]!);
      if (data.name === "run.accepted") continue;
      out.push({ id: /^id: ?(.*)$/m.exec(block)?.[1], type: data.type });
    }
  }
  await reader.cancel().catch(() => {});
  return out;
}

// The lifecycle itself (ownership, rejoin, retention, fencing…) is tests/lifecycle.test.ts, the
// suite both storages run. These are the memory backend's own options.
describe("memoryConversations (Node fallback)", () => {
  it("answers 501 until the turn (#63) exists", async () => {
    expect((await memoryConversations().startTurn(input("users:1", "t4"))).status).toBe(501);
  });

  it("conversationBackend: each call uses its own options, over one set of conversations", async () => {
    const options = normalizeOptions({ models: [{ id: "test/model", label: "Test" }], apiKey: "sk-test" });
    // The first call in the process comes from a path without a turn runner (a list, say).
    const bare = conversationBackend(options);
    expect((await bare.startTurn(input("users:9", "shared"))).status).toBe(501);
    // A later call with the runner is not stuck with the first call's options.
    const start = input("users:9", "shared");
    expect((await events(await conversationBackend(options, { turnRunner }).startTurn(start))).at(-1)?.type).toBe("RUN_FINISHED");
    // And the data is shared between calls, as Node dev needs across requests.
    expect((await conversationBackend(options).transcript("users:9", "shared"))?.messages).toHaveLength(2);
    expect((await conversationBackend(options).list("users:9")).entries.map((e) => e.threadId)).toEqual(["shared"]);
  });
});
