import type { ModelMessage } from "@tanstack/ai";
import { memoryPersistence } from "@tanstack/ai-persistence";
import { describe, expect, it } from "vitest";
import {
  AUDIT_DOCUMENT_EVENT_LIMIT,
  AUDIT_SUMMARY_DOCUMENT_ID,
  analyticsEngineAuditSink,
  auditDocumentId,
  auditDocumentIds,
  auditEventsFor,
  type AssistantAuditEvent,
} from "../src/audit";
import {
  DEFAULT_AUTH_REDACTIONS,
  redactDocument,
  redactFor,
  redactResultFor,
  redactText,
  redactToolResult,
  redactTranscript,
  redactedReference,
  withAuthRedactions,
  type RedactionPolicy,
} from "../src/redaction";
import { redactionPolicyOf, relationMapOf } from "../src/redactionSchema";
import { redactedMessageStore, turnPolicyMiddleware } from "../src/server/policy";
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
    const out = redactTranscript(messages, { paths: { users: ["email"] } });
    expect(out[2]!.content).toBe('{"id":1}');
    expect(out[3]!.content).toBe('{"email":"page-field","id":2}'); // another collection's paths
    expect(out[0]).toBe(messages[0]); // the user's own words are theirs
  });

  it("the message store saves the redacted transcript", async () => {
    const store = memoryPersistence().stores.messages;
    const redacted = redactedMessageStore(store, { paths: { users: ["email"] } });
    await redacted.saveThread("t", [
      { role: "assistant", content: null, toolCalls: [{ id: "c1", type: "function", function: { name: "findDocuments", arguments: '{"slug":"users"}' } }] },
      { role: "tool", toolCallId: "c1", content: '{"email":"a@example.com","id":1}' },
    ]);
    expect(JSON.stringify(await store.loadThread("t"))).not.toContain("a@example.com");
  });
});

// A sanitized-config look-alike: Payload 4's `createdBy` / `updatedBy` (polymorphic, to the auth
// collections) on every collection, plus relations through groups, named tabs, arrays, blocks
// (inline and by reference) and a join.
const authorship = [
  { name: "createdBy", type: "relationship", relationTo: ["users"] },
  { name: "updatedBy", type: "relationship", relationTo: ["users"] },
];
const config = {
  blocks: [{ slug: "team", fields: [{ name: "lead", type: "relationship", relationTo: "users" }] }],
  collections: [
    { slug: "users", auth: true, fields: [{ name: "name", type: "text" }, { name: "avatar", type: "upload", relationTo: "media" }, ...authorship] },
    { slug: "media", fields: [{ name: "alt", type: "text" }, ...authorship] },
    { slug: "tags", fields: [{ name: "title", type: "text" }] },
    {
      slug: "pages",
      fields: [
        { name: "title", type: "text" },
        { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
        { name: "meta", type: "group", fields: [{ name: "owner", type: "relationship", relationTo: "users" }] },
        { type: "tabs", tabs: [{ name: "extra", fields: [{ name: "reviewers", type: "relationship", relationTo: "users", hasMany: true }] }, { fields: [{ type: "row", fields: [{ name: "hero", type: "upload", relationTo: "media" }] }] }] },
        { name: "layout", type: "blocks", blocks: [{ slug: "cta", fields: [{ name: "author", type: "relationship", relationTo: "users" }] }], blockReferences: ["team"] },
        { name: "notes", type: "array", fields: [{ name: "by", type: "relationship", relationTo: "users" }] },
        ...authorship,
      ],
    },
    { slug: "teams", fields: [{ name: "members", type: "join", collection: "users", on: "team" }] },
  ],
  globals: [{ slug: "settings", fields: [...authorship] }],
};

describe("relations: populated documents are redacted by their own collection", () => {
  const noAppPaths = {};
  const policy = redactionPolicyOf(config, noAppPaths);
  const ann = { id: 1, name: "Ann", email: "ann@example.com", apiKey: "k", sessions: [{ id: "s" }] };
  const annOut = { id: 1, name: "Ann" };

  it("relationMapOf keeps only relations that lead to redacted fields, through every container", () => {
    const relations = relationMapOf(config, { users: ["email"] });
    expect(relations.pages?.map((field) => field.path)).toEqual(["meta.owner", "extra.reviewers", "hero", "layout.author", "layout.lead", "notes.by", "createdBy", "updatedBy"]);
    expect(relations.media?.map((field) => field.path)).toEqual(["createdBy", "updatedBy"]); // media → users
    expect(relations.users?.map((field) => field.path)).toEqual(["avatar", "createdBy", "updatedBy"]);
    expect(relations.teams).toEqual([{ path: "members", relationTo: "users", join: true }]);
    expect(relations.settings?.length).toBe(2);
    expect(relations.tags).toBeUndefined(); // nothing hidden there
    expect(policy.paths.users).toEqual([...DEFAULT_AUTH_REDACTIONS]); // auth defaults from the sanitized config
    expect(redactionPolicyOf(config, noAppPaths)).toBe(policy); // cached
  });

  it("createdBy / updatedBy ({ relationTo, value }) on a page, a list and a page of results", () => {
    const page = { id: 9, title: "Home", createdBy: { relationTo: "users", value: ann }, updatedBy: { relationTo: "users", value: 1 } };
    const expected = { id: 9, title: "Home", createdBy: { relationTo: "users", value: annOut }, updatedBy: { relationTo: "users", value: 1 } };
    expect(redactFor(page, "pages", policy)).toEqual(expected);
    expect(redactFor({ docs: [page], totalDocs: 1 }, "pages", policy)).toEqual({ docs: [expected], totalDocs: 1 });
    expect(redactFor({ doc: page }, "pages", policy)).toEqual({ doc: expected });
    expect(JSON.stringify(page)).toContain("ann@example.com"); // never mutated
  });

  it("plain, hasMany, group, tab, blocks, array and join relations; nested documents (depth 2)", () => {
    const media = { id: 5, alt: "x", createdBy: { relationTo: "users", value: ann } };
    const page = {
      id: 9,
      tags: [{ id: 3, title: "t" }],
      meta: { owner: ann },
      reviewers: "not a relation at the top level",
      extra: { reviewers: [ann, 2] },
      hero: media,
      layout: [
        { blockType: "cta", author: ann },
        { blockType: "team", lead: { ...ann, avatar: media } },
      ],
      notes: [{ by: ann }],
    };
    const out = redactFor(page, "pages", policy);
    expect(JSON.stringify(out)).not.toContain("ann@example.com");
    expect(JSON.stringify(out)).not.toContain('"apiKey"');
    expect(out.meta.owner).toEqual(annOut);
    expect(out.extra.reviewers).toEqual([annOut, 2]);
    expect(out.tags).toBe(page.tags); // untouched branches are not copied
    expect((out.layout[1] as { lead: { avatar: unknown } }).lead.avatar).toEqual({ id: 5, alt: "x", createdBy: { relationTo: "users", value: annOut } });

    const team = { id: 1, members: { docs: [ann], hasNextPage: false } };
    expect(redactFor(team, "teams", policy)).toEqual({ id: 1, members: { docs: [annOut], hasNextPage: false } });
  });

  it("any { relationTo, value } of a collection with hidden fields, also without a slug (rich text, custom tools)", () => {
    const lexical = { root: { children: [{ type: "relationship", relationTo: "users", value: ann }] } };
    expect(JSON.stringify(redactFor(lexical, "pages", policy))).not.toContain("ann@example.com");
    expect(JSON.stringify(redactFor({ any: { relationTo: "users", value: ann } }, undefined, policy))).not.toContain("ann@example.com");
  });

  it("findDistinct rows: populated relations redacted, a hidden field's values dropped", () => {
    const distinct = { values: [{ "meta.owner": ann }, { "meta.owner": 2 }], totalDocs: 2 };
    expect(redactFor(distinct, "pages", policy)).toEqual({ values: [{ "meta.owner": annOut }, { "meta.owner": 2 }], totalDocs: 2 });
    expect(redactFor({ values: [{ email: "a@x.io" }, { email: "b@x.io" }] }, "users", policy)).toEqual({ values: [{}, {}] });
  });

  it("every plugin-mcp result shape, as text", () => {
    const user = JSON.stringify(ann);
    const page = JSON.stringify({ id: 9, createdBy: { relationTo: "users", value: ann } });
    const shapes: Array<[string, string]> = [
      ["users", `Document from collection "users":\n${user}`], // findDocuments by id
      ["pages", `Collection: "pages"\nTotal: 1 documents\n\n\`\`\`json\n${page}\n\`\`\``], // findDocuments
      ["pages", `Document updated successfully in collection "pages"!\nResult:\n\`\`\`json\n${page}\n\`\`\``],
      ["pages", `Multiple documents updated in collection "pages"!\nUpdated: 1 documents\nErrors: 0\n---\n\nUpdated documents:\n\`\`\`json\n[${page}]\n\`\`\``],
      ["pages", `Document deleted successfully from collection "pages"!\nDeleted: 1 documents\nErrors: 0\n---\n\nDeleted documents:\n\`\`\`json\n[${page}]\n\`\`\``],
      ["pages", `Created 1 of 1 documents in collection "pages".\nResults:\n\`\`\`json\n{"docs":[{"doc":${page},"index":0}],"errors":[]}\n\`\`\``],
      ["pages", `Document duplicated successfully in collection "pages"!\nDuplicated document:\n\`\`\`json\n${page}\n\`\`\``],
      ["pages", `Versions for collection "pages":\n\`\`\`json\n{"docs":[{"id":"v1","parent":${page},"version":${page}}],"totalDocs":1}\n\`\`\``],
      ["pages", `Version "v1" from collection "pages":\n\`\`\`json\n{"id":"v1","parent":9,"version":${page}}\n\`\`\``],
      ["pages", `Version "v1" restored successfully in collection "pages"!\nRestored document:\n\`\`\`json\n${page}\n\`\`\``],
      ["settings", `Global "settings" updated successfully!\n\`\`\`json\n{"id":1,"createdBy":{"relationTo":"users","value":${user}}}\n\`\`\``],
      ["users", `Distinct values for "name" in collection "users":\n\`\`\`json\n{"values":[{"name":"Ann"}],"totalDocs":1}\n\`\`\``],
    ];
    for (const [slug, text] of shapes) {
      const out = redactResultFor(text, slug, policy);
      expect(out, text).not.toContain("ann@example.com");
      expect(out, text).not.toContain('"apiKey"');
    }
  });

  it("documents past the nesting limit are cut down to their id", () => {
    let node: Record<string, unknown> = { ...ann };
    for (let i = 0; i < 12; i++) node = { id: 100 + i, name: "u", email: `u${i}@example.com`, avatar: { id: 200 + i, createdBy: { relationTo: "users", value: node } } };
    expect(JSON.stringify(redactFor(node, "users", policy))).not.toContain("@example.com");
  });
});

describe("redactedReference: queries on hidden fields", () => {
  const policy: RedactionPolicy = redactionPolicyOf(config, { pages: ["meta.secret"] });
  it("where (through and/or), sort, select and findDistinct's field, directly or through a relation", () => {
    expect(redactedReference(policy, { slug: "users", where: { email: { like: "a" } } })).toBe("email");
    expect(redactedReference(policy, { slug: "users", where: { or: [{ name: { equals: "A" } }, { and: [{ apiKey: { exists: true } }] }] } })).toBe("apiKey");
    expect(redactedReference(policy, { slug: "users", sort: "-email" })).toBe("email");
    expect(redactedReference(policy, { slug: "users", sort: ["name", "+sessions"] })).toBe("sessions");
    expect(redactedReference(policy, { slug: "users", select: { name: true, email: true } })).toBe("email");
    expect(redactedReference(policy, { slug: "users", field: "email" })).toBe("email");
    expect(redactedReference(policy, { slug: "users", field: "sessions.id" })).toBe("sessions.id");
    expect(redactedReference(policy, { slug: "pages", where: { "createdBy.email": { equals: "x" } } })).toBe("createdBy.email");
    expect(redactedReference(policy, { slug: "pages", where: { "createdBy.value.email": { equals: "x" } } })).toBe("createdBy.value.email");
    expect(redactedReference(policy, { slug: "pages", where: { "layout.0.author.email": { exists: true } } })).toBe("layout.0.author.email");
    expect(redactedReference(policy, { slug: "pages", where: { "meta.secret": { exists: true } } })).toBe("meta.secret");
    expect(redactedReference(policy, { slug: "pages", where: { "hero.createdBy.email": { exists: true } } })).toBe("hero.createdBy.email");
  });
  it("the versions tools: a leading version. is the document's root", () => {
    for (const tool of ["findVersions", "countVersions", "findGlobalVersions"]) {
      // where, directly and through a relation, on a versioned collection and an auth collection
      expect(redactedReference(policy, { slug: "pages", where: { "version.createdBy.email": { equals: "x" } } }, tool), tool).toBe("version.createdBy.email");
      expect(redactedReference(policy, { slug: "users", where: { "version.email": { like: "a" } } }, tool), tool).toBe("version.email");
      expect(redactedReference(policy, { slug: "pages", where: { and: [{ or: [{ "version.meta.secret": { exists: true } }] }] } }, tool), tool).toBe("version.meta.secret");
      expect(redactedReference(policy, { slug: "pages", where: { "version.createdBy.value.email": { equals: "x" } } }, tool), tool).toBe("version.createdBy.value.email");
      // sort, select, and the version's parent (the collection document)
      expect(redactedReference(policy, { slug: "pages", sort: "-version.createdBy.email" }, tool), tool).toBe("version.createdBy.email");
      expect(redactedReference(policy, { slug: "users", sort: ["version.name", "version.email"] }, tool), tool).toBe("version.email");
      expect(redactedReference(policy, { slug: "users", select: { version: { email: true } } }, tool), tool).toBe("version.email");
      expect(redactedReference(policy, { slug: "users", where: { "parent.email": { equals: "x" } } }, tool), tool).toBe("parent.email");
      // what stays allowed
      expect(redactedReference(policy, { slug: "pages", where: { "version.title": { equals: "x" }, parent: { equals: 1 } }, sort: "-updatedAt" }, tool), tool).toBeUndefined();
      expect(redactedReference(policy, { slug: "users", where: { "version.name": { equals: "x" } }, sort: "-version.name" }, tool), tool).toBeUndefined();
    }
    // the same paths without the tool name (or on another tool) are plain fields called "version"
    expect(redactedReference(policy, { slug: "users", where: { "version.email": { like: "a" } } })).toBeUndefined();
    expect(redactedReference(policy, { slug: "users", where: { "version.email": { like: "a" } } }, "findDocuments")).toBeUndefined();
    expect(redactedReference(policy, { slug: "users", where: { email: { like: "a" } } }, "findVersions")).toBe("email");
  });
  it("the policy refuses findVersions and countVersions on a hidden field, and answers the model why", async () => {
    const middleware = turnPolicyMiddleware({ input: { threadId: "t", runId: "r", userKey: "users:1" }, settings: { model: "m", redact: policy.paths, ...(policy.relations ? { relations: policy.relations } : {}) } });
    const before = middleware.onBeforeToolCall as (ctx: unknown, hook: unknown) => unknown;
    const hook = (toolName: string, args: Record<string, unknown>) => ({ toolCallId: `${toolName}-${JSON.stringify(args)}`, toolName, args, toolCall: { id: "x", type: "function", function: { name: toolName, arguments: "{}" } } });
    for (const toolName of ["findVersions", "countVersions"]) {
      for (const args of [
        { slug: "pages", where: { "version.createdBy.email": { equals: "x" } } },
        { slug: "users", where: { "version.email": { like: "a" } } },
        { slug: "pages", sort: "version.createdBy.email" },
        { slug: "users", sort: "-version.email" },
      ]) {
        expect(await before({}, hook(toolName, args)), `${toolName} ${JSON.stringify(args)}`).toMatchObject({ type: "skip", result: expect.stringContaining("hidden field") });
      }
      expect(await before({}, hook(toolName, { slug: "pages", where: { "version.title": { equals: "x" } }, sort: "-version.updatedAt" }))).toBeUndefined();
    }
  });
  it("results of the versions tools lose version.* and parent's hidden fields", () => {
    const out = redactResultFor({ docs: [{ id: "v1", parent: { id: 1, name: "Ann", email: "ann@example.com" }, version: { name: "Ann", email: "ann@example.com", createdBy: { relationTo: "users", value: { id: 1, email: "ann@example.com" } } } }] }, "users", policy);
    expect(JSON.stringify(out)).not.toContain("ann@example.com");
  });
  it("lets everything else through", () => {
    expect(redactedReference(policy, { slug: "users", where: { name: { equals: "email" } }, sort: "name", select: { email: false } })).toBeUndefined();
    expect(redactedReference(policy, { slug: "pages", where: { createdBy: { equals: 1 } }, field: "title" })).toBeUndefined();
    expect(redactedReference(policy, { slug: "pages", where: { "meta.owner": { equals: 1 } } })).toBeUndefined();
    expect(redactedReference(policy, { where: { email: { equals: "x" } } })).toBeUndefined(); // no slug, no collection
    expect(redactedReference({ paths: {} }, { slug: "users", where: { email: {} } })).toBeUndefined();
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

  // plugin-mcp 4.0.0-beta.6's result texts, as its tools write them.
  const fence = (value: unknown) => "```json\n" + JSON.stringify(value) + "\n```";
  it("one id per changed document, from each of plugin-mcp's write results", () => {
    const where = { slug: "pages", where: { title: { like: "x" } } };
    // update by where (not returning: ids only), with and without failed documents
    expect(auditDocumentIds("updateDocument", where, `Multiple documents updated in collection "pages"!\nUpdated: 3 documents\nErrors: 0\n---\n\nUpdated documents:\n${fence([{ id: 1 }, { id: 2 }, { id: 3 }])}`)).toEqual(["1", "2", "3"]);
    expect(
      auditDocumentIds(
        "updateDocument",
        where,
        `Multiple documents updated in collection "pages"!\nUpdated: 1 documents\nErrors: 1\n---\n\nUpdated documents:\n${fence([{ id: "a" }])}\n\nErrors:\n${fence([{ id: "b", message: "no" }])}\n\nUse this schema for data:\n${fence({ id: "schema" })}`
      )
    ).toEqual(["a"]);
    // nothing updated: no event; only failures: no event
    expect(auditDocumentIds("updateDocument", where, `Multiple documents updated in collection "pages"!\nUpdated: 0 documents\nErrors: 0\n---`)).toEqual([]);
    expect(auditDocumentIds("updateDocument", where, `Multiple documents updated in collection "pages"!\nUpdated: 0 documents\nErrors: 1\n---\n\nErrors:\n${fence([{ id: "b", message: "no" }])}`)).toEqual([]);
    // delete by where returns whole documents (their relations too: only top-level ids count)
    const deleted = [{ id: 4, createdBy: { relationTo: "users", value: { id: 99 } } }, { id: 5 }];
    expect(auditDocumentIds("deleteDocuments", where, `Document deleted successfully from collection "pages"!\nDeleted: 2 documents\nErrors: 0\n---\n\nDeleted documents:\n${fence(deleted)}`)).toEqual(["4", "5"]);
    // by id: the argument
    expect(auditDocumentIds("deleteDocuments", { slug: "pages", id: 6 }, `Document deleted successfully from collection "pages"!\nDeleted document:\n${fence({ id: 6 })}`)).toEqual(["6"]);
    expect(auditDocumentIds("updateDocument", { slug: "pages", id: "p" }, `Document updated successfully in collection "pages"!\nResult:\n${fence({ id: "p" })}`)).toEqual(["p"]);
    // create: ids or { doc } per created document; failed indexes are not documents
    expect(auditDocumentIds("createDocuments", { slug: "pages" }, `Created 2 of 3 documents in collection "pages".\nRetry failed indexes only.\nResults:\n${fence({ docs: [{ id: 7, index: 0 }, { id: 8, index: 2 }], errors: [{ index: 1, message: "bad" }] })}`)).toEqual(["7", "8"]);
    expect(auditDocumentIds("createDocuments", { slug: "pages" }, `Created 1 of 1 documents in collection "pages".\nResults:\n${fence({ docs: [{ doc: { id: 9, title: "x" }, index: 0 }], errors: [] })}`)).toEqual(["9"]);
    // duplicate and restore: the document written, not the id argument (the source, the version)
    expect(auditDocumentIds("duplicateDocument", { slug: "pages", id: 1 }, `Document duplicated successfully in collection "pages"!\nDuplicated document:\n${fence({ id: 10 })}`)).toEqual(["10"]);
    expect(auditDocumentIds("restoreVersion", { slug: "pages", id: "v1" }, `Version "v1" restored successfully in collection "pages"!\nRestored document:\n${fence({ id: 11 })}`)).toEqual(["11"]);
    // globals: no document id
    expect(auditDocumentIds("updateGlobal", { slug: "settings" }, `Global "settings" updated successfully!\n${fence({ id: 1 })}`)).toEqual([""]);
    // content parts work as text does
    expect(auditDocumentIds("updateDocument", where, [{ type: "text", content: `Updated documents:\n${fence([{ id: 1 }, { id: 2 }])}` }])).toEqual(["1", "2"]);
  });

  it("the Analytics Engine sink writes one data point per event, no content", () => {
    const points: unknown[] = [];
    const sink = analyticsEngineAuditSink({ writeDataPoint: (point) => points.push(point) })!;
    void sink({ userKey: "users:1", userId: "1", tool: "updateDocument", collection: "pages", documentId: "7", conversationId: "t", runId: "r", model: "m", timestamp: 1 });
    expect(points).toEqual([{ indexes: ["users:1"], blobs: ["users:1", "updateDocument", "pages", "7", "t", "m", "r"], doubles: [1] }]);
    expect(analyticsEngineAuditSink(undefined)).toBeUndefined();
  });

  it("the sink writes a summary event's document count as its double", () => {
    const points: { blobs?: string[]; doubles?: number[] }[] = [];
    const sink = analyticsEngineAuditSink({ writeDataPoint: (point) => points.push(point) })!;
    void sink({ userKey: "users:1", userId: "1", tool: "deleteDocuments", collection: "pages", documentId: AUDIT_SUMMARY_DOCUMENT_ID, documents: 120, conversationId: "t", runId: "r", model: "m", timestamp: 1 });
    expect(points[0]?.doubles).toEqual([120]);
    expect(points[0]?.blobs?.[3]).toBe("*");
  });
});

describe("audit cap: Analytics Engine takes 250 data points per invocation", () => {
  const base = { userKey: "users:1", userId: "1", tool: "updateDocument", collection: "pages", conversationId: "t", runId: "r", model: "m", timestamp: 1 };
  const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => String(from + i));

  it("auditEventsFor: one event per document up to the limit, then one summary for the rest", () => {
    const small = auditEventsFor(base, ids(3));
    expect(small.events.map((event) => event.documentId)).toEqual(["0", "1", "2"]);
    expect(small.emitted).toBe(3);
    const exact = auditEventsFor(base, ids(AUDIT_DOCUMENT_EVENT_LIMIT));
    expect(exact.events).toHaveLength(AUDIT_DOCUMENT_EVENT_LIMIT);
    expect(exact.events.some((event) => event.documents !== undefined)).toBe(false);
    const big = auditEventsFor(base, ids(500));
    expect(big.events).toHaveLength(AUDIT_DOCUMENT_EVENT_LIMIT + 1);
    expect(big.emitted).toBe(AUDIT_DOCUMENT_EVENT_LIMIT);
    expect(big.events.at(-1)).toEqual({ ...base, documentId: AUDIT_SUMMARY_DOCUMENT_ID, documents: 300 });
    // the run's earlier events count; nothing left: only the summary
    expect(auditEventsFor(base, ids(10), AUDIT_DOCUMENT_EVENT_LIMIT).events).toEqual([{ ...base, documentId: AUDIT_SUMMARY_DOCUMENT_ID, documents: 10 }]);
    expect(auditEventsFor(base, ids(10), AUDIT_DOCUMENT_EVENT_LIMIT - 4).events).toHaveLength(5);
    expect(auditEventsFor(base, []).events).toEqual([]);
  });

  // The middleware, with a fake Analytics Engine sink: every event is one data point.
  const run = async (calls: number[]) => {
    const events: AssistantAuditEvent[] = [];
    const middleware = turnPolicyMiddleware({
      input: { threadId: "t", runId: "r", userKey: "users:1" },
      settings: { model: "m" },
      audit: (event) => void events.push(event),
    });
    let n = 0;
    for (const count of calls) {
      const rows = ids(count, n * 1000).map((id) => ({ id }));
      const text = `Updated documents:\n\`\`\`json\n${JSON.stringify(rows)}\n\`\`\``;
      await (middleware.onAfterToolCall as (ctx: unknown, info: unknown) => Promise<unknown>)(
        {},
        {
          toolCallId: `call-${n++}`,
          toolName: "updateDocument",
          toolCall: { id: "x", type: "function", function: { name: "updateDocument", arguments: JSON.stringify({ slug: "pages", where: { title: { like: "x" } } }) } },
          tool: { needsApproval: true },
          ok: true,
          result: text,
          duration: 1,
        }
      );
    }
    return events;
  };
  const summaries = (events: AssistantAuditEvent[]) => events.filter((event) => event.documentId === AUDIT_SUMMARY_DOCUMENT_ID);

  it("250+ documents in one call: capped per-document events plus one summary, never past the limit", async () => {
    const events = await run([300]);
    expect(events).toHaveLength(AUDIT_DOCUMENT_EVENT_LIMIT + 1);
    expect(events.length).toBeLessThanOrEqual(250);
    expect(summaries(events)).toEqual([
      { userKey: "users:1", userId: "1", tool: "updateDocument", collection: "pages", documentId: "*", documents: 100, conversationId: "t", runId: "r", model: "m", timestamp: expect.any(Number) },
    ]);
    // the listed documents are the first 200, each once
    expect(new Set(events.slice(0, -1).map((event) => event.documentId)).size).toBe(AUDIT_DOCUMENT_EVENT_LIMIT);
    // nothing is lost: listed + summarized = changed
    expect(events.reduce((sum, event) => sum + (event.documents ?? 1), 0)).toBe(300);
  });

  it("the cap is per run: several calls share it, later ones only get summaries", async () => {
    const events = await run([150, 150, 5]);
    expect(events.filter((event) => event.documentId !== "*")).toHaveLength(AUDIT_DOCUMENT_EVENT_LIMIT);
    expect(summaries(events).map((event) => event.documents)).toEqual([100, 5]);
    expect(events).toHaveLength(AUDIT_DOCUMENT_EVENT_LIMIT + 2);
    expect(events.reduce((sum, event) => sum + (event.documents ?? 1), 0)).toBe(305);
  });

  it("a call under the limit is unchanged: one event per document, no summary", async () => {
    const events = await run([3]);
    expect(events.map((event) => event.documentId)).toEqual(["0", "1", "2"]);
    expect(summaries(events)).toEqual([]);
  });
});
