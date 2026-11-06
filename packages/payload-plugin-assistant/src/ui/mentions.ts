/**
 * Pure helpers for `@` mentions in the composer (#69). No React, so they are unit tested.
 */

/** An `@` being typed: where it starts and what follows it, up to the caret. */
export interface ActiveMention {
  /** Index of the `@`. */
  start: number;
  /** The text typed after it (the search). */
  query: string;
}

/** Longest search typed after an `@` before it stops counting as a mention. */
export const MAX_MENTION_QUERY = 50;

/**
 * The mention the caret is in, if any: an `@` at the start or after whitespace, followed by up to
 * {@link MAX_MENTION_QUERY} characters without a line break or another `@`. Spaces are allowed
 * (titles have them), so "@about us" searches "about us"; an e-mail address (`a@b`) is not a mention.
 */
export function activeMention(text: string, caret: number): ActiveMention | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return undefined;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return undefined;
  const query = before.slice(at + 1);
  if (query.length > MAX_MENTION_QUERY || /[\n@]/.test(query) || /^\s/.test(query)) return undefined;
  return { start: at, query };
}

/**
 * The text after picking a document for the mention: `@query` becomes the document's title and a
 * space, so the sentence still reads ("compare Home with About"); the chip carries the reference.
 * Returns the new text and where the caret goes.
 */
export function applyMention(text: string, mention: ActiveMention, caret: number, title: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const insert = `${title}${after.startsWith(" ") ? "" : " "}`;
  const next = `${text.slice(0, mention.start)}${insert}${after}`;
  return { text: next, caret: mention.start + insert.length + (after.startsWith(" ") ? 1 : 0) };
}
