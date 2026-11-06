import type { AnyTextAdapter, ModelMessage } from "@tanstack/ai";
import { fakeText, type FakeResponse } from "@tanstack/ai/testing";
import type { TurnSettings } from "../conversations/types";
import { REFERENCE_NOTE_OPEN, withoutReferenceNote } from "../references";

/**
 * The test model (`testModel: true`): a scripted `fakeText()` adapter, so end-to-end tests run
 * real turns (tools, approvals, the Durable Object, the UI) with no key and no network. It never
 * calls OpenRouter. Its behaviour is a tiny command language in the user's message:
 *
 * - `/tool <name> <JSON arguments>` calls that tool once, e.g.
 *   `/tool findDocuments {"slug":"pages","limit":5}`. A write tool pauses for approval as usual.
 * - After a tool result, it answers `Tool <name> finished: <result, cut>`, or, when the user
 *   rejected the change, `The change was rejected. Nothing was written.`
 * - Anything else gets `Test model: you said "<message>".`
 * - Each call reports a cost of $1 per million (estimated) tokens, like OpenRouter's `usage.cost`.
 * - A message with document references (#69) is read without its note, and the answer to plain
 *   text adds ` Documents: <the note's lines>`, so a test sees what the model was told.
 *
 * Stateless (it reads the request's messages), so it survives a restarted object.
 */
export function testModelAdapter(settings: TurnSettings): AnyTextAdapter {
  const model = fakeText({ model: settings.model });
  // One answer per model call; a run makes at most `maxSteps` of them.
  model.setResponses(Array.from({ length: settings.maxSteps + 1 }, () => ({ request }) => answer(request.messages)));
  return withFakeCost(model as unknown as AnyTextAdapter);
}

/** What the test model "charges": $1 per million tokens (#68), so budgets and costs show in end-to-end tests. */
export const TEST_MODEL_USD_PER_TOKEN = 0.000001;

/**
 * A fake adapter that reports a cost, as OpenRouter does (`usage.cost` on each call's
 * `RUN_FINISHED`): `fakeText()` estimates tokens but has no price. Mutates and returns `adapter`.
 */
export function withFakeCost<T extends AnyTextAdapter>(adapter: T, usdPerToken: number = TEST_MODEL_USD_PER_TOKEN): T {
  const inner = adapter.chatStream.bind(adapter);
  (adapter as { chatStream: AnyTextAdapter["chatStream"] }).chatStream = async function* (options) {
    for await (const chunk of inner(options)) {
      const event = chunk as { type?: string; usage?: { totalTokens?: number; cost?: number } };
      if (event.type === "RUN_FINISHED" && event.usage && typeof event.usage.totalTokens === "number" && event.usage.cost === undefined) {
        yield { ...chunk, usage: { ...event.usage, cost: event.usage.totalTokens * usdPerToken } } as typeof chunk;
      } else yield chunk;
    }
  } as AnyTextAdapter["chatStream"];
  return adapter;
}

const TOOL_COMMAND = /^\/tool\s+([A-Za-z0-9_-]+)\s*([\s\S]*)$/;
const MAX_RESULT_CHARS = 300;

function textOf(message: ModelMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).map((part) => (part.type === "text" ? part.content : "")).join("");
}

/** The answer to one model call, from the conversation so far. */
export function answer(messages: ModelMessage[]): FakeResponse {
  const last = messages[messages.length - 1];
  if (last?.role === "tool") {
    const name =
      messages
        .flatMap((message) => message.toolCalls ?? [])
        .find((call) => call.id === last.toolCallId)?.function.name ?? "tool";
    const result = textOf(last);
    if (/rejected this change/i.test(result)) return { text: "The change was rejected. Nothing was written." };
    const cut = result.length > MAX_RESULT_CHARS ? `${result.slice(0, MAX_RESULT_CHARS)}…` : result;
    return { text: `Tool ${name} finished: ${cut}` };
  }

  const full = textOf(last);
  const said = withoutReferenceNote(full).trim();
  const note = full.includes(REFERENCE_NOTE_OPEN) ? full.slice(full.lastIndexOf(REFERENCE_NOTE_OPEN)) : "";
  const command = TOOL_COMMAND.exec(said);
  if (command) {
    const [, name, rawArgs] = command;
    let input: unknown = {};
    if (rawArgs?.trim()) {
      try {
        input = JSON.parse(rawArgs);
      } catch {
        return { text: `Test model: the arguments for ${name} are not valid JSON.` };
      }
    }
    // Explicit ids: the fake's default ids restart with the isolate, and a conversation outlives it.
    return { toolCalls: [{ name: name!, input, id: `call_${crypto.randomUUID().replaceAll("-", "")}` }] };
  }
  return { text: `Test model: you said "${said}".${note ? ` Documents: ${noteLines(note)}` : ""}` };
}

/** The note's lines without its tags, on one line. */
function noteLines(note: string): string {
  return note.split("\n").slice(1, -1).join(" ");
}
