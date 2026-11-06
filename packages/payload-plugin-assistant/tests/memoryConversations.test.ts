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

describe("memoryConversations (Node fallback)", () => {
  it("enforces ownership on read, resume, new turns, rename and delete", async () => {
    const backend = memoryConversations({ turnRunner });
    const start = input("users:1", "t1");
    expect((await events(await backend.startTurn(start))).at(-1)?.type).toBe("RUN_FINISHED");
    expect((await backend.transcript("users:1", "t1"))?.messages).toHaveLength(2);

    expect(await backend.claim("users:2", "t1")).toEqual({ ok: false });
    expect(await backend.transcript("users:2", "t1")).toBeNull();
    const join = new Request("http://x/api/assistant/chat", { headers: { "Last-Event-ID": "-1", "X-Run-Id": start.runId } });
    expect((await backend.join("users:2", "t1", join)).status).toBe(404);
    expect((await backend.startTurn(input("users:2", "t1"))).status).toBe(404);
    expect(await backend.rename("users:2", "t1", "x")).toBe(false);
    expect(await backend.remove("users:2", "t1")).toBe(false);
    expect((await backend.list("users:2")).entries).toEqual([]);
    expect((await backend.list("users:1")).entries.map((e) => e.threadId)).toEqual(["t1"]);
  });

  it("rejoins a run after a disconnect from the last event id", async () => {
    const backend = memoryConversations({ turnRunner });
    const start = input("users:1", "t2");
    const first = await events(await backend.startTurn(start), 2);
    const rest = await events(
      await backend.join("users:1", "t2", new Request("http://x", { headers: { "Last-Event-ID": first.at(-1)!.id!, "X-Run-Id": start.runId } }))
    );
    expect([...first, ...rest].map((e) => e.type)).toEqual([
      "RUN_STARTED",
      ...Array(5).fill("TEXT_MESSAGE_CONTENT"),
      "RUN_FINISHED",
    ]);
  });

  it("drops idle conversations after the retention", async () => {
    let now = 1_000;
    const backend = memoryConversations({ turnRunner, retentionMs: 100, now: () => now });
    await backend.claim("users:1", "t3");
    now += 50;
    expect(await backend.transcript("users:1", "t3")).not.toBeNull();
    now += 200;
    expect(await backend.transcript("users:1", "t3")).toBeNull();
    expect((await backend.list("users:1")).entries).toEqual([]);
  });

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
