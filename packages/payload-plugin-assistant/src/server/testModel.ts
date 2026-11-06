import type { AnyTextAdapter, ModelMessage } from "@tanstack/ai";
import { fakeText, type FakeResponse } from "@tanstack/ai/testing";
import type { TurnSettings } from "../conversations/types";

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
 *
 * Stateless (it reads the request's messages), so it survives a restarted object.
 */
export function testModelAdapter(settings: TurnSettings): AnyTextAdapter {
  const model = fakeText({ model: settings.model });
  // One answer per model call; a run makes at most `maxSteps` of them.
  model.setResponses(Array.from({ length: settings.maxSteps + 1 }, () => ({ request }) => answer(request.messages)));
  return model as unknown as AnyTextAdapter;
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

  const said = textOf(last).trim();
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
  return { text: `Test model: you said "${said}".` };
}
