import type { ChatMiddleware, ModelMessage } from "@tanstack/ai";
import { messageReferences, referenceNote } from "../references";

/**
 * Adds each user message's {@link referenceNote} (the documents it is about, #69) after its text,
 * in what the model receives only (`providerMessages`); the stored transcript and the chat keep the
 * user's own words, with the references in `metadata.assistant`. Last in the middleware list, so it
 * works on what compaction kept. The note names documents; it never holds their content.
 */
export function withReferenceNotes(): ChatMiddleware {
  return {
    name: "assistant-reference-notes",
    onConfig: (_ctx, config) => {
      const source = config.providerMessages ?? config.messages;
      let changed = false;
      const providerMessages = source.map((message) => {
        const noted = withNote(message);
        if (noted !== message) changed = true;
        return noted;
      });
      return changed ? { providerMessages } : undefined;
    },
  };
}

/** The message with its note after the text, or the same message when it has none. */
export function withNote(message: ModelMessage): ModelMessage {
  if (message.role !== "user" || !message.metadata) return message;
  const note = referenceNote(messageReferences(message.metadata));
  if (!note) return message;
  if (typeof message.content === "string") return { ...message, content: `${message.content}\n\n${note}` };
  if (Array.isArray(message.content)) return { ...message, content: [...message.content, { type: "text", content: `\n\n${note}` }] };
  return { ...message, content: note };
}
