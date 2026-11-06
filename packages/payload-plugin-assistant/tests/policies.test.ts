import type { ModelMessage } from "@tanstack/ai";
import { memoryPersistence } from "@tanstack/ai-persistence";
import { describe, expect, it } from "vitest";
import { analyticsEngineAuditSink, auditDocumentId } from "../src/audit";
import { DEFAULT_AUTH_REDACTIONS, redactDocument, redactText, redactToolResult, redactTranscript, withAuthRedactions } from "../src/redaction";
import { redactedMessageStore } from "../src/server/policy";
import { budgetExceeded, dayBefore, nextUtcMidnight, usageAmountOf, usageResponse, utcDay } from "../src/usage";
import { normalizeOptions } from "../src/utils/normalizeOptions";

describe("redactDocument", () => {
  const doc = {
    id: 1,
    email: "a@example.com",
    name: "Ann",
    profile: { phone: "123", city: "Porto" },
    layout: [
      { blockType: "cta", label: "Buy", secret: "s1", nested: [{ secret: "s2", keep: "k" }] },
      { blockType: "text", body: "Hi" },
    ],
  };

  it("drops top-level, group, array and blocks paths, and copies", () => {
    const frozen = structuredClone(doc);
    const out = redactDocument(doc, ["email", "profile.phone", "layout.secret", "layout.nested.secret"]);
    expect(out).toEqual({
      id: 1,
      name: "Ann",
      profile: { city: "Porto" },
      layout: [
        { blockType: "cta", label: "Buy", nested: [{ keep: "k" }] },
        { blockType: "text", body: "Hi" },
      ],
    });
    expect(doc).toEqual(frozen); // never mutated
  });

  it("walks lists, pages, versions and { doc } wrappers", () => {
    const user = { id: 2, email: "b@example.com", name: "Bo" };
    expect(redactDocument([user], ["email"])).toEqual([{ id: 2, name: "Bo" }]);
    expect(redactDocument({ docs: [user], totalDocs: 1 }, ["email"])).toEqual({ docs: [{ id: 2, name: "Bo" }], totalDocs: 1 });
    expect(redactDocument({ docs: [{ id: "v1", parent: 2, version: user }] }, ["email"])).toEqual({
      docs: [{ id: "v1", parent: 2, version: { id: 2, name: "Bo" } }],
    });
    expect(redactDocument({ doc: user }, ["email"])).toEqual({ doc: { id: 2, name: "Bo" } });
  });

  it("returns the same object when there is nothing to drop", () => {
    expect(redactDocument(doc, ["missing"])).toBe(doc);
    expect(redactDocument(doc, [])).toBe(doc);
  });
});

describe("redactText: plugin-mcp's text results", () => {
  it("fenced JSON blocks (findDocuments by where), keeping the text around them", () => {
    const text = [
      'Collection: "users"',
      "Total: 2 documents",
      "",
      '```json\n{"id":1,"email":"a@example.com","name":"Ann","sessions":[{"id":"s"}]}\n```',
      '```json\n{"id":2,"email":"b@example.com","name":"Bo"}\n```',
    ].join("\n");
    const out = redactText(text, DEFAULT_AUTH_REDACTIONS);
    expect(out).toBe(['Collection: "users"', "Total: 2 documents", "", '```json\n{"id":1,"name":"Ann"}\n```', '```json\n{"id":2,"name":"Bo"}\n```'].join("\n"));
  });

  it("unfenced JSON (findDocuments by id), pretty-printed JSON keeps its style", () => {
    expect(redactText('Document from collection "users":\n{"id":1,"email":"a@x.io","name":"A"}', ["email"])).toBe(
      'Document from collection "users":\n{"id":1,"name":"A"}'
    );
    const pretty = `Result:\n${JSON.stringify({ doc: { id: 1, email: "a@x.io" } }, null, 2)}\nDone.`;
    expect(redactText(pretty, ["email"])).toBe(`Result:\n${JSON.stringify({ doc: { id: 1 } }, null, 2)}\nDone.`);
  });

  it("leaves text without JSON, broken JSON and braces in strings alone", () => {
    for (const text of ["no json here", 'a { "email": broken', 'quote "{not json}" end', ""]) expect(redactText(text, ["email"])).toBe(text);
    const tricky = '{"title":"a } in a string","email":"x@y.z"}';
    expect(redactText(tricky, ["email"])).toBe('{"title":"a } in a string"}');
  });
});

describe("redactToolResult / redactTranscript", () => {
  it("strings, text parts and structured results", () => {
    expect(redactToolResult('{"email":"a","id":1}', ["email"])).toBe('{"id":1}');
    expect(redactToolResult([{ type: "text", content: '{"email":"a","id":1}' }], ["email"])).toEqual([{ type: "text", content: '{"id":1}' }]);
    expect(redactToolResult({ email: "a", id: 1 }, ["email"])).toEqual({ id: 1 });
  });

  it("redacts each tool message with the paths of its call's slug", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "my email is me@example.com" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "c1", type: "function", function: { name: "findDocuments", arguments: '{"slug":"users"}' } },
          { id: "c2", type: "function", function: { name: "findDocuments", arguments: '{"slug":"pages"}' } },
        ],
      },
      { role: "tool", toolCallId: "c1", content: '{"email":"a@example.com","id":1}' },
      { role: "tool", toolCallId: "c2", content: '{"email":"page-field","id":2}' },
    ];
    const out = redactTranscript(messages, { users: ["email"] });
    expect(out[2]!.content).toBe('{"id":1}');
    expect(out[3]!.content).toBe('{"email":"page-field","id":2}'); // another collection's paths
    expect(out[0]).toBe(messages[0]); // the user's own words are theirs
  });

  it("the message store saves the redacted transcript", async () => {
    const store = memoryPersistence().stores.messages;
    const redacted = redactedMessageStore(store, { users: ["email"] });
    await redacted.saveThread("t", [
      { role: "assistant", content: null, toolCalls: [{ id: "c1", type: "function", function: { name: "findDocuments", arguments: '{"slug":"users"}' } }] },
      { role: "tool", toolCallId: "c1", content: '{"email":"a@example.com","id":1}' },
    ]);
    expect(JSON.stringify(await store.loadThread("t"))).not.toContain("a@example.com");
  });
});

describe("withAuthRedactions and the options", () => {
  it("every auth collection gets the defaults; the app's paths are added", () => {
    const map = withAuthRedactions({ users: ["phone"], pages: ["note"] }, [{ slug: "users", auth: true }, { slug: "members", auth: {} }, { slug: "pages" }]);
    expect(map.users).toEqual([...DEFAULT_AUTH_REDACTIONS, "phone"]);
    expect(map.members).toEqual([...DEFAULT_AUTH_REDACTIONS]);
    expect(map.pages).toEqual(["note"]);
    expect(map.users).toContain("email");
    expect(map.users).toEqual(expect.arrayContaining(["apiKey", "sessions", "hash", "salt", "resetPasswordToken"]));
  });

  const base = { models: [{ id: "m", label: "M" }], apiKey: "k" };
  it("budget: $5 a day by default, false turns it off, bad caps throw", () => {
    expect(normalizeOptions(base).budget).toEqual({ dailyCostUsd: 5 });
    expect(normalizeOptions({ ...base, budget: false }).budget).toBeNull();
    expect(normalizeOptions({ ...base, budget: { dailyTokens: 1000 } }).budget).toEqual({ dailyTokens: 1000 });
    expect(() => normalizeOptions({ ...base, budget: {} })).toThrow(/dailyCostUsd/);
    expect(() => normalizeOptions({ ...base, budget: { dailyCostUsd: -1 } })).toThrow(/positive/);
  });

  it("redact: dotted paths only", () => {
    expect(normalizeOptions({ ...base, redact: { pages: ["a.b"] } }).redact).toEqual({ pages: ["a.b"] });
    expect(() => normalizeOptions({ ...base, redact: { pages: ["a..b"] } })).toThrow(/dotted/);
    expect(() => normalizeOptions({ ...base, redact: { pages: "a" as never } })).toThrow(/dotted/);
  });
});

describe("usage helpers", () => {
  it("UTC days and the reset", () => {
    expect(utcDay(Date.parse("2031-03-04T23:59:59Z"))).toBe("2031-03-04");
    expect(utcDay(Date.parse("2031-03-05T00:00:00Z"))).toBe("2031-03-05");
    expect(nextUtcMidnight(Date.parse("2031-12-31T10:00:00Z")).toISOString()).toBe("2032-01-01T00:00:00.000Z");
    expect(dayBefore("2031-03-01", 1)).toBe("2031-02-28");
  });

  it("reads TanStack's usage, OpenRouter's cost included", () => {
    expect(usageAmountOf({ promptTokens: 10, completionTokens: 2, totalTokens: 12, cost: 0.0003 })).toEqual({ tokens: 12, costUsd: 0.0003 });
    expect(usageAmountOf({ promptTokens: 10, completionTokens: 2 })).toEqual({ tokens: 12, costUsd: 0 });
    expect(usageAmountOf(undefined)).toEqual({ tokens: 0, costUsd: 0 });
  });

  it("caps and what is left", () => {
    expect(budgetExceeded({ costUsd: 5, tokens: 0 }, { dailyCostUsd: 5 })).toBe(true);
    expect(budgetExceeded({ costUsd: 4.99, tokens: 10 }, { dailyCostUsd: 5, dailyTokens: 10 })).toBe(true);
    expect(budgetExceeded({ costUsd: 100, tokens: 1e9 }, null)).toBe(false);
    const body = usageResponse({ day: "2031-03-04", costUsd: 6, tokens: 10 }, { dailyCostUsd: 5 }, Date.parse("2031-03-04T12:00:00Z"));
    expect(body).toMatchObject({ exceeded: true, remaining: { costUsd: 0, tokens: null }, resetsAt: "2031-03-05T00:00:00.000Z" });
  });
});

describe("audit helpers", () => {
  it("the document id: the call's id, else the created document's", () => {
    expect(auditDocumentId({ slug: "pages", id: 7 }, "ok")).toBe("7");
    expect(auditDocumentId({ slug: "pages" }, 'Created 1 of 1 documents:\n```json\n{"id":"abc","title":"x"}\n```')).toBe("abc");
    expect(auditDocumentId({ slug: "pages", where: {} }, "Updated 3 documents")).toBe("");
  });

  it("the Analytics Engine sink writes one data point per event, no content", () => {
    const points: unknown[] = [];
    const sink = analyticsEngineAuditSink({ writeDataPoint: (point) => points.push(point) })!;
    void sink({ userKey: "users:1", userId: "1", tool: "updateDocument", collection: "pages", documentId: "7", conversationId: "t", runId: "r", model: "m", timestamp: 1 });
    expect(points).toEqual([{ indexes: ["users:1"], blobs: ["users:1", "updateDocument", "pages", "7", "t", "m", "r"], doubles: [1] }]);
    expect(analyticsEngineAuditSink(undefined)).toBeUndefined();
  });
});
