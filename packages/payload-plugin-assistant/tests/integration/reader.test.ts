import type { CollectionSlug, GlobalSlug, Payload } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, createPayloadRequest, getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HiddenFieldError, readerFor, type UserReader } from "../../src/server/reader";
import { buildProposal } from "../../src/server/approvals";
import { resolveMessageReferences } from "../../src/server/references";
import { turnPolicyMiddleware } from "../../src/server/policy";
import { DEFAULT_AUTH_REDACTIONS } from "../../src/redaction";

/**
 * The `UserReader` (#133) on a real Payload 4 (SQLite): every read is access-checked, draft-aware
 * and redacted (paths through groups, arrays and blocks; populated relations by their own
 * collection; versions), titles never use a hidden field, hidden-field queries are refused, and
 * the policy it hands the turn is the one the turn's middleware applies.
 */
const KEY = "assistant-reader";
const REDACT = {
  pages: ["internalNote", "meta.secret", "rows.secret", "layout.trackingId"],
  contacts: ["phone"],
  settings: ["token"],
};

let tmpDir: string;
let payload: Payload;
let editor: { id: number; email: string };
let reader: UserReader;
let anonymous: UserReader;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-reader-"));
  const config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "reader.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, admin: { useAsTitle: "email" }, fields: [{ name: "name", type: "text" }] },
      // Named by a field the `redact` option hides.
      { slug: "contacts", admin: { useAsTitle: "phone" }, access: { read: () => true }, fields: [{ name: "phone", type: "text" }, { name: "city", type: "text" }] },
      {
        slug: "pages",
        admin: { useAsTitle: "title" },
        versions: { drafts: true },
        access: { read: ({ req }) => Boolean(req.user) },
        fields: [
          { name: "title", type: "text" },
          { name: "internalNote", type: "text" },
          { name: "meta", type: "group", fields: [{ name: "secret", type: "text" }, { name: "keep", type: "text" }] },
          { name: "rows", type: "array", fields: [{ name: "secret", type: "text" }, { name: "keep", type: "text" }] },
          { name: "layout", type: "blocks", blocks: [{ slug: "cta", fields: [{ name: "label", type: "text" }, { name: "trackingId", type: "text" }] }] },
          { name: "author", type: "relationship", relationTo: "users" },
        ],
      },
    ],
    globals: [
      {
        slug: "settings",
        access: { read: ({ req }) => Boolean(req.user) },
        fields: [{ name: "siteName", type: "text" }, { name: "token", type: "text" }, { name: "owner", type: "relationship", relationTo: "users" }],
      },
    ],
  });
  payload = await getPayload({ config, key: KEY });
  const email = `editor-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const user = await payload.create({ collection: "users" as CollectionSlug, data: { email, password: "pw-123456", name: "Ed" } as never, overrideAccess: true });
  editor = { id: (user as unknown as { id: number }).id, email };
  const req = await createPayloadRequest({ payload, user: { ...(user as object), collection: "users" } as never });
  reader = readerFor(req, { redact: REDACT });
  anonymous = readerFor(await createPayloadRequest({ payload, user: null }), { redact: REDACT });
}, 120_000);

afterAll(async () => {
  await (payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

const newPage = async (data: Record<string, unknown>) =>
  (await payload.create({ collection: "pages" as CollectionSlug, data: data as never, overrideAccess: true })) as unknown as { id: number };

const SECRET_PAGE = {
  title: "Landing",
  internalNote: "hidden-note",
  meta: { secret: "hidden-meta", keep: "kept-meta" },
  rows: [{ secret: "hidden-row", keep: "kept-row" }],
  layout: [{ blockType: "cta", label: "Buy", trackingId: "hidden-tracking" }],
};

describe("reads: access-checked, draft-aware, redacted", () => {
  it("findByID drops the redacted paths through groups, arrays and blocks, keeps the rest", async () => {
    const page = await newPage({ ...SECRET_PAGE, author: editor.id });
    const doc = await reader.findByID("pages", String(page.id));
    const text = JSON.stringify(doc);
    expect(text).toContain("Landing");
    expect(text).toContain("kept-meta");
    expect(text).toContain("kept-row");
    expect(text).toContain("Buy");
    expect(text).not.toContain("hidden-");
  });

  it("populated relations lose their own collection's hidden fields (depth 1)", async () => {
    const page = await newPage({ title: "Authored", author: editor.id });
    const doc = await reader.findByID("pages", String(page.id), { depth: 1 });
    expect(doc?.author).toMatchObject({ id: editor.id, name: "Ed" });
    expect(JSON.stringify(doc)).not.toContain(editor.email);
    const global = await reader.findGlobal("settings", { depth: 1 });
    expect(JSON.stringify(global)).not.toContain(editor.email);
  });

  it("an auth collection loses the defaults (email, sessions…)", async () => {
    const doc = await reader.findByID("users", String(editor.id));
    expect(doc).toMatchObject({ id: editor.id, name: "Ed" });
    for (const field of DEFAULT_AUTH_REDACTIONS) expect(doc).not.toHaveProperty(field);
  });

  it("find redacts every document and counts them all", async () => {
    const tag = `find-${crypto.randomUUID().slice(0, 8)}`;
    await newPage({ ...SECRET_PAGE, title: tag });
    await newPage({ ...SECRET_PAGE, title: tag });
    const found = await reader.find("pages", { title: { equals: tag } }, { limit: 1 });
    expect(found?.docs).toHaveLength(1);
    expect(found?.total).toBe(2);
    expect(JSON.stringify(found)).not.toContain("hidden-");
  });

  it("findGlobal drops the global's hidden fields; existsOnly reads nothing else", async () => {
    await payload.updateGlobal({ slug: "settings" as GlobalSlug, data: { siteName: "Cargo", token: "hidden-token", owner: editor.id } as never, overrideAccess: true });
    const settings = await reader.findGlobal("settings");
    expect(settings).toMatchObject({ siteName: "Cargo" });
    expect(JSON.stringify(settings)).not.toContain("hidden-token");
    expect(await reader.findGlobal("settings", { existsOnly: true })).not.toHaveProperty("siteName");
  });

  it("drafts: the latest draft, not the published version", async () => {
    const page = await newPage({ title: "Published", _status: "published" });
    await payload.update({ collection: "pages" as CollectionSlug, id: page.id, data: { title: "Draft title", internalNote: "hidden-draft" } as never, draft: true, overrideAccess: true });
    const doc = await reader.findByID("pages", String(page.id));
    expect(doc?.title).toBe("Draft title");
    expect(doc).not.toHaveProperty("internalNote");
  });

  it("findVersion: the version's document is redacted, with its parent's id", async () => {
    const page = await newPage({ ...SECRET_PAGE, title: "Versioned" });
    const versions = await payload.findVersions({ collection: "pages" as CollectionSlug, where: { parent: { equals: page.id } }, overrideAccess: true });
    const found = await reader.findVersion("pages", String(versions.docs[0]!.id));
    expect(found?.parent).toBe(String(page.id));
    expect(found?.version).toMatchObject({ title: "Versioned" });
    expect(JSON.stringify(found)).not.toContain("hidden-");
  });

  it("overrideAccess is off: what the user can't read is null, never an error", async () => {
    const page = await newPage({ title: "Members only" });
    expect(await anonymous.findByID("pages", String(page.id))).toBeNull();
    expect(await anonymous.find("pages", { title: { equals: "Members only" } })).toBeNull();
    expect(await anonymous.findGlobal("settings")).toBeNull();
    expect(await reader.findByID("pages", "999999")).toBeNull();
    expect(await reader.findByID("nope", "1")).toBeNull();
  });
});

describe("hidden-field queries", () => {
  it("find refuses a where on a hidden field, directly or through a relation", async () => {
    await expect(reader.find("users", { email: { equals: editor.email } })).rejects.toBeInstanceOf(HiddenFieldError);
    await expect(reader.find("pages", { "author.email": { like: "editor" } })).rejects.toMatchObject({ field: "author.email" });
    await expect(reader.find("pages", { or: [{ title: { equals: "x" } }, { "meta.secret": { exists: true } }] })).rejects.toMatchObject({ field: "meta.secret" });
  });

  it("hiddenField: where, sort, select and findDistinct's field; the versions tools' version. and parent. paths", () => {
    expect(reader.hiddenField({ slug: "users", sort: "-email" })).toBe("email");
    expect(reader.hiddenField({ slug: "users", select: { name: true, apiKey: true } })).toBe("apiKey");
    expect(reader.hiddenField({ slug: "contacts", field: "phone" })).toBe("phone");
    for (const tool of ["findVersions", "countVersions", "findVersionByID", "findGlobalVersions"]) {
      expect(reader.hiddenField({ slug: "pages", where: { "version.author.email": { equals: "x" } } }, tool), tool).toBe("version.author.email");
      expect(reader.hiddenField({ slug: "pages", where: { "version.internalNote": { exists: true } } }, tool), tool).toBe("version.internalNote");
      expect(reader.hiddenField({ slug: "users", sort: "-version.email" }, tool), tool).toBe("version.email");
      expect(reader.hiddenField({ slug: "users", where: { "parent.email": { equals: "x" } } }, tool), tool).toBe("parent.email");
      expect(reader.hiddenField({ slug: "pages", where: { "version.title": { equals: "x" } }, sort: "-version.updatedAt" }, tool), tool).toBeUndefined();
    }
    // Elsewhere a field may be called `version`.
    expect(reader.hiddenField({ slug: "users", where: { "version.email": { equals: "x" } } }, "findDocuments")).toBeUndefined();
    expect(reader.hiddenField({ slug: "pages", where: { title: { equals: "x" } }, sort: "-updatedAt" })).toBeUndefined();
  });
});

describe("titles", () => {
  it("the title field, or label and id when it is hidden: the value is never read", async () => {
    const page = await newPage({ title: "  Home  " });
    expect(reader.title("pages", await reader.findByID("pages", String(page.id), { titleOnly: true }), String(page.id))).toBe("Home");
    expect(reader.title("users", { email: editor.email }, String(editor.id))).toBe(`User #${editor.id}`);
    const contact = (await payload.create({ collection: "contacts" as CollectionSlug, data: { phone: "555-hidden", city: "Porto" } as never, overrideAccess: true })) as unknown as { id: number };
    const read = await reader.findByID("contacts", String(contact.id), { titleOnly: true });
    expect(read).not.toHaveProperty("phone");
    expect(reader.title("contacts", { phone: "555-hidden" }, String(contact.id))).toBe(`Contact #${contact.id}`);
    expect(reader.title("pages", {}, "7")).toBe("7");
    expect(reader.titleField("users")).toEqual({ field: "email", hidden: true });
    expect(reader.titleField("pages")).toEqual({ field: "title", hidden: false });
  });

  it("redactedTitles lists the collections named by label and id", () => {
    expect(reader.redactedTitles()).toEqual({ users: "User", contacts: "Contact" });
  });

  it("references and approval cards name documents through the reader, never by a hidden field", async () => {
    const resolved = await resolveMessageReferences(reader, { context: { kind: "collection", slug: "users", id: String(editor.id) } });
    expect(resolved).toEqual({ ok: true, value: { context: { kind: "collection", slug: "users", id: String(editor.id), title: `User #${editor.id}` } } });

    const card = await buildProposal(reader, {
      interruptId: "i",
      requestedAt: Date.now(),
      payload: { toolCallId: "c", metadata: { toolName: "updateDocument", input: { slug: "users", id: String(editor.id), data: { name: "Edd" } } } },
    });
    expect(card.items[0]?.document?.title).toBe(`User #${editor.id}`);
    expect(JSON.stringify(card)).not.toContain(editor.email);
  });
});

describe("the policy the turn gets", () => {
  it("is plain JSON: the auth defaults, the app's paths and the relations that lead to them", () => {
    const policy = JSON.parse(JSON.stringify(reader.policy));
    expect(policy).toEqual(reader.policy);
    expect(policy.paths.users).toEqual([...DEFAULT_AUTH_REDACTIONS]);
    expect(policy.paths.pages).toEqual(REDACT.pages);
    expect(policy.relations.pages).toEqual(expect.arrayContaining([{ path: "author", relationTo: "users" }]));
  });

  it("the turn's middleware applies it as sent: results redacted, hidden-field queries refused", async () => {
    const middleware = turnPolicyMiddleware({ input: { threadId: "t", runId: "r", userKey: `users:${editor.id}` }, settings: { model: "m", redaction: JSON.parse(JSON.stringify(reader.policy)) } });
    const before = middleware.onBeforeToolCall as (ctx: unknown, hook: unknown) => unknown;
    const after = middleware.onAfterToolCall as (ctx: unknown, info: unknown) => Promise<{ result?: unknown } | undefined>;
    const toolCall = (name: string, args: unknown) => ({ id: "x", type: "function", function: { name, arguments: JSON.stringify(args) } });
    const args = { slug: "pages", where: { "version.author.email": { equals: editor.email } } };
    expect(await before({}, { toolCallId: "1", toolName: "findVersions", args, toolCall: toolCall("findVersions", args) })).toMatchObject({ type: "skip" });

    const page = { id: 1, title: "T", internalNote: "hidden-note", author: { id: editor.id, email: editor.email } };
    const replaced = await after({}, { toolCallId: "2", toolName: "findDocuments", toolCall: toolCall("findDocuments", { slug: "pages" }), ok: true, result: `Document:\n${JSON.stringify(page)}` });
    expect(String(replaced?.result)).toContain('"title":"T"');
    expect(String(replaced?.result)).not.toMatch(/hidden-note|@example\.com/);
  });
});
