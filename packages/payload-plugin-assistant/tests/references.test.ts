import type { ModelMessage } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import {
  messageReferences,
  parseReferenceInput,
  referenceNote,
  withoutReferenceNote,
  type MessageReferences,
} from "../src/references";
import { withNote, withReferenceNotes } from "../src/server/referenceNotes";
import { answer } from "../src/server/testModel";
import { activeMention, applyMention } from "../src/ui/mentions";
import { appliedWrites, writeTouches, type ToolCallLike, type ToolResultLike } from "../src/ui/tools";
import { reachableEntities } from "../src/utils/reachable";

const home = { kind: "collection" as const, slug: "pages", id: "12", title: "Home" };
const header = { kind: "global" as const, slug: "header", title: "Header" };

describe("reference inputs", () => {
  it("accepts collection documents (number ids as text) and globals", () => {
    expect(parseReferenceInput({ kind: "collection", slug: "pages", id: 12, title: "ignored" })).toEqual({ kind: "collection", slug: "pages", id: "12" });
    expect(parseReferenceInput({ kind: "global", slug: "header", id: "x" })).toEqual({ kind: "global", slug: "header" });
  });

  it.each([
    [null],
    ["pages"],
    [{ kind: "collection", slug: "pages" }],
    [{ kind: "collection", slug: "pages", id: "1 OR 1=1" }],
    [{ kind: "collection", slug: "../users", id: "1" }],
    [{ kind: "document", slug: "pages", id: "1" }],
  ])("refuses %j", (value) => {
    expect(parseReferenceInput(value)).toBeUndefined();
  });

  it("reads stored references and ignores anything else in the metadata", () => {
    expect(messageReferences({ tanstack: {}, assistant: { context: home, references: [header, { bogus: true }] } })).toEqual({
      context: home,
      references: [header],
    });
    expect(messageReferences(undefined)).toEqual({});
    expect(messageReferences({ assistant: "x" })).toEqual({});
  });
});

describe("the note for the model", () => {
  const refs: MessageReferences = { context: home, references: [header] };

  it("names the documents and how to read them, nothing else", () => {
    const note = referenceNote(refs)!;
    expect(note).toMatch(/^<document-references>\n/);
    expect(note).toContain('`pages` id 12 "Home"');
    expect(note).toContain("findDocuments (slug `pages`, id 12, draft: true)");
    expect(note).toContain('global `header` "Header"');
    expect(note).toContain("unsaved changes");
    expect(referenceNote({})).toBeUndefined();
  });

  it("quotes titles so they can't break out of their place", () => {
    expect(referenceNote({ references: [{ ...home, title: 'A "quoted"\ntitle' }] })).toContain('"A \\"quoted\\"\\ntitle"');
  });

  it("goes after the user's text, only on user messages with references", () => {
    const user = { role: "user", content: "Shorten it.", metadata: { assistant: refs } } as ModelMessage;
    const noted = withNote(user);
    expect(noted.content).toBe(`Shorten it.\n\n${referenceNote(refs)}`);
    expect(user.content).toBe("Shorten it."); // the stored message is untouched
    const plain = { role: "user", content: "Hi" } as ModelMessage;
    expect(withNote(plain)).toBe(plain);
    const assistant = { role: "assistant", content: "Hi", metadata: { assistant: refs } } as ModelMessage;
    expect(withNote(assistant)).toBe(assistant);
  });

  it("the middleware rewrites what the provider gets, never the transcript", async () => {
    const messages = [
      { role: "user", content: "First", metadata: { assistant: refs } },
      { role: "assistant", content: "ok" },
      { role: "user", content: "Second" },
    ] as ModelMessage[];
    const out = await withReferenceNotes().onConfig!({} as never, { messages, systemPrompts: [], tools: [] } as never);
    const provider = (out as { providerMessages: ModelMessage[] }).providerMessages;
    expect(provider[0]!.content).toContain("<document-references>");
    expect(provider[2]).toBe(messages[2]);
    expect(messages[0]!.content).toBe("First");
    expect(out).not.toHaveProperty("messages");
    expect(await withReferenceNotes().onConfig!({} as never, { messages: [messages[2]!], systemPrompts: [], tools: [] } as never)).toBeUndefined();
  });

  it("the test model reads a command without the note, and says what it was told", () => {
    const note = referenceNote(refs)!;
    expect(withoutReferenceNote(`/tool findDocuments {"slug":"pages"}\n\n${note}`)).toBe('/tool findDocuments {"slug":"pages"}');
    const command = answer([{ role: "user", content: `/tool findDocuments {"slug":"pages"}\n\n${note}` }]);
    expect(command).toMatchObject({ toolCalls: [{ name: "findDocuments", input: { slug: "pages" } }] });
    const text = answer([{ role: "user", content: `Hello\n\n${note}` }]) as { text: string };
    expect(text.text).toMatch(/^Test model: you said "Hello"\. Documents: The editor opened this conversation/);
  });
});

describe("mentions in the composer", () => {
  it.each([
    ["@", 1, { start: 0, query: "" }],
    ["see @Hom", 8, { start: 4, query: "Hom" }],
    ["see @about us", 13, { start: 4, query: "about us" }],
    ["see @Hom and more", 8, { start: 4, query: "Hom" }],
  ])("%j at %i is a mention", (text, caret, expected) => {
    expect(activeMention(text, caret)).toEqual(expected);
  });

  it.each([
    ["mail me at a@b.co", 17],
    ["@ x", 3],
    ["@one\ntwo", 8],
    ["no at sign", 5],
    [`@${"x".repeat(51)}`, 52],
  ])("%j at %i is not", (text, caret) => {
    expect(activeMention(text, caret)).toBeUndefined();
  });

  it("picking a document puts its title in place of @query", () => {
    expect(applyMention("compare @Ho with", { start: 8, query: "Ho" }, 11, "Home")).toEqual({ text: "compare Home with", caret: 13 });
    expect(applyMention("@ab", { start: 0, query: "ab" }, 3, "About us")).toEqual({ text: "About us ", caret: 9 });
  });
});

describe("applied writes and the open document", () => {
  const fenced = (data: unknown) => `Updated\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``;
  const call = (name: string, input: Record<string, unknown>, id = `c-${name}`): ToolCallLike => ({ id, name, input });
  const result = (callId: string, content: unknown, extra: Partial<ToolResultLike> = {}): ToolResultLike => ({ toolCallId: callId, content, ...extra });
  const page = { kind: "collection" as const, slug: "pages", id: "12" };

  it("finds writes whose result arrived and succeeded", () => {
    const update = call("updateDocument", { slug: "pages", id: 12 });
    const failed = call("updateDocument", { slug: "pages", id: 13 }, "c-failed");
    const read = call("findDocuments", { slug: "pages", id: 12 });
    const pending = call("setRichTextFromMarkdown", { slug: "pages", id: 12 });
    const messages = [{ parts: [update, failed, read, pending].map((c) => ({ type: "tool-call", ...c })) }];
    const results = new Map([
      [update.id, result(update.id, fenced({ id: 12 }))],
      [failed.id, result(failed.id, '{"error":"denied"}')],
      [read.id, result(read.id, fenced({ id: 12 }))],
    ]);
    expect(appliedWrites(messages, results).map((w) => w.call.id)).toEqual([update.id]);
  });

  it.each([
    ["an update by id", call("updateDocument", { slug: "pages", id: 12 }), undefined, true],
    ["the Markdown rich text tool", call("setRichTextFromMarkdown", { slug: "pages", id: "12", path: "body" }), undefined, true],
    ["an update by where that returned it", call("updateDocument", { slug: "pages", where: {} }), fenced({ docs: [{ id: 12 }] }), true],
    ["a restore", call("restoreVersion", { slug: "pages", id: "12" }), undefined, true],
    ["another document", call("updateDocument", { slug: "pages", id: 13 }), undefined, false],
    ["another collection", call("updateDocument", { slug: "posts", id: 12 }), undefined, false],
    ["a delete", call("deleteDocuments", { slug: "pages", id: 12 }), undefined, false],
    ["a read", call("findDocuments", { slug: "pages", id: 12 }), undefined, false],
  ])("%s → %s", (_name, c, content, expected) => {
    expect(writeTouches(c, content ? result(c.id, content) : undefined, page)).toBe(expected);
  });

  it("globals match by slug", () => {
    expect(writeTouches(call("updateGlobal", { slug: "header" }), undefined, { kind: "global", slug: "header" })).toBe(true);
    expect(writeTouches(call("updateGlobal", { slug: "footer" }), undefined, { kind: "global", slug: "header" })).toBe(false);
    expect(writeTouches(call("updateDocument", { slug: "header", id: 1 }), undefined, { kind: "global", slug: "header" })).toBe(false);
  });
});

describe("what the assistant reaches", () => {
  const config = {
    collections: [{ slug: "pages" }, { slug: "users" }, { slug: "payload-preferences" }],
    globals: [{ slug: "header" }, { slug: "footer" }],
  };

  it("plugin-mcp's collections and globals when it is installed", () => {
    const mcp = Object.assign(() => ({}), { slug: "@payloadcms/plugin-mcp", options: { collections: { pages: {}, gone: {} }, globals: { header: {} } } });
    const reachable = reachableEntities({ ...config, plugins: [mcp] });
    expect([...reachable.collections]).toEqual(["pages"]);
    expect([...reachable.globals]).toEqual(["header"]);
  });

  it("everything but Payload's own collections without it", () => {
    const reachable = reachableEntities(config);
    expect([...reachable.collections]).toEqual(["pages", "users"]);
    expect([...reachable.globals]).toEqual(["header", "footer"]);
  });
});

describe("the chat body", () => {
  it("reads the document context from forwardedProps, never AG-UI's own `context` array", async () => {
    const { validateChatBody } = await import("../src/server/validate");
    const agUi = { threadId: "t1", context: [], messages: [{ role: "user", content: "Hi" }], forwardedProps: { model: "m" } };
    expect(validateChatBody(agUi, null)).toMatchObject({ ok: true, value: { context: undefined, references: [] } });
    const withDoc = { ...agUi, forwardedProps: { context: { kind: "collection", slug: "pages", id: 3 }, references: [{ kind: "global", slug: "header" }] } };
    expect(validateChatBody(withDoc, null)).toMatchObject({
      ok: true,
      value: { context: { kind: "collection", slug: "pages", id: "3" }, references: [{ kind: "global", slug: "header" }] },
    });
  });
});
