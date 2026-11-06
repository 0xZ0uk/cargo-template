import type { ModelMessage } from "@tanstack/ai";
import { defineAIPersistence, memoryPersistence } from "@tanstack/ai-persistence";
import { runPersistenceConformance } from "@tanstack/ai-persistence/testkit";
import { describe, expect, it } from "vitest";
import {
  byteLength,
  capJsonSize,
  capTranscript,
  DEFAULT_CONVERSATION_CAPS,
  truncateText,
  truncateToolResult,
  withConversationCaps,
} from "../src/conversations/caps";

const caps = { ...DEFAULT_CONVERSATION_CAPS };
const user = (content: string): ModelMessage => ({ role: "user", content });
const assistant = (content: string, toolCalls?: ModelMessage["toolCalls"]): ModelMessage => ({
  role: "assistant",
  content,
  ...(toolCalls ? { toolCalls } : {}),
});
const tool = (content: string): ModelMessage => ({ role: "tool", content, toolCallId: "call_1" });

describe("truncation", () => {
  it("cuts text to the byte budget on a character boundary and says how much it dropped", () => {
    const cut = truncateText("é".repeat(1000), 100);
    expect(byteLength(cut)).toBeLessThanOrEqual(100);
    expect(cut).toMatch(/^é+\n…\[truncated \d+ bytes\]$/);
    expect(truncateText("short", 100)).toBe("short");
  });

  it("cuts tool results only (string and text parts)", () => {
    const big = "x".repeat(50_000);
    expect(byteLength(truncateToolResult(tool(big), 1000).content as string)).toBeLessThanOrEqual(1000);
    expect(truncateToolResult(user(big), 1000).content).toBe(big);
    const parts = truncateToolResult({ role: "tool", toolCallId: "c", content: [{ type: "text", content: big }] }, 1000);
    expect(JSON.stringify(parts).length).toBeLessThan(1200);
  });

  it("shrinks a JSON value to a byte budget, keeping its shape", () => {
    const value = { type: "TOOL_CALL_RESULT", toolCallId: "t", content: "y".repeat(100_000), meta: { a: "b" } };
    const capped = capJsonSize(value, 2000);
    expect(byteLength(JSON.stringify(capped))).toBeLessThanOrEqual(2000);
    expect(capped).toMatchObject({ type: "TOOL_CALL_RESULT", toolCallId: "t", meta: { a: "b" } });
    expect(value.content).toHaveLength(100_000); // input untouched
  });
});

describe("capTranscript", () => {
  it("keeps a transcript within the caps unchanged", () => {
    const messages = [user("a"), assistant("b")];
    expect(capTranscript(messages, caps)).toEqual(messages);
  });

  it("drops the oldest whole turns when over maxMessages, never orphaning a tool result", () => {
    const turn = (n: number) => [
      user(`q${n}`),
      assistant("", [{ id: "call_1", type: "function", function: { name: "find", arguments: "{}" } }]),
      tool(`r${n}`),
      assistant(`a${n}`),
    ];
    const messages = [...turn(1), ...turn(2), ...turn(3)];
    const capped = capTranscript(messages, { ...caps, maxMessages: 6 });
    expect(capped[0]).toEqual(user("q3"));
    expect(capped).toHaveLength(4);
  });

  it("drops old turns when over maxBytes, and cuts big tool results first", () => {
    const messages = [user("q1"), tool("z".repeat(40_000)), assistant("a1"), user("q2"), assistant("a2")];
    const cut = capTranscript(messages, caps);
    expect(byteLength((cut[1]!.content as string))).toBeLessThanOrEqual(caps.maxToolResultBytes);
    const small = capTranscript(messages, { ...caps, maxBytes: 200, maxToolResultBytes: 1000 });
    expect(small.map((m) => m.content)).toEqual(["q2", "a2"]);
  });

  it("keeps the newest turn even when it alone is over the limit", () => {
    const messages = [user("q1"), assistant("a1"), user("x".repeat(5000))];
    expect(capTranscript(messages, { ...caps, maxBytes: 100 })).toEqual([user("x".repeat(5000))]);
  });

  it("applies on saveThread through withConversationCaps", async () => {
    const persistence = withConversationCaps(memoryPersistence(), { maxToolResultBytes: 500 });
    await persistence.stores.messages.saveThread("t", [user("q"), tool("w".repeat(10_000))]);
    const [, stored] = await persistence.stores.messages.loadThread("t");
    expect(byteLength(stored!.content as string)).toBeLessThanOrEqual(500);
  });
});

// The Node fallback's stores, with the caps on: the defaults sit above anything the suite writes.
runPersistenceConformance(
  "memory fallback (memoryPersistence + caps)",
  () => {
    const { messages, runs, interrupts, metadata, sessions } = memoryPersistence().stores;
    return withConversationCaps(defineAIPersistence({ stores: { messages, runs, interrupts, metadata, sessions } }));
  },
  {
  skip: ["activities", "generationRuns", "artifacts", "blobs", "log"],
  checks: ["messages.metadata", "runs.listByThread.state"],
  }
);
