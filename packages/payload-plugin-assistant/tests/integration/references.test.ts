import type { Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@payloadcms/plugin-mcp";
import type { ModelMessage } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));

import { DOCUMENT_CONTROLS_COMPONENT_PATH } from "../../src/constants";
import { assistantPluginWith } from "../../src/plugin";
import { inProcessDispatch } from "../../src/tools/inProcess";
import { readEvents } from "../sse";

/**
 * Document references (#69) end to end in Node: the context of an edit view's conversation and
 * `@` mentions, resolved as the user through Payload's router, stored on the message, named to the
 * model without their content; and the `@` search through plugin-mcp's tools.
 */
const KEY = "assistant-references";
const ORIGIN = "http://localhost:3000";
const SECRET_BODY = "the body text no prompt should contain";

let tmpDir: string;
let app: { payload: Payload; config: SanitizedConfig };
let cookies: { editor: string; customer: string };
let homeId: string;
let aboutId: string;
let secretId: string;
let editorId: string;
let personId: string;
/** What each model call received. */
let calls: ModelMessage[][] = [];

const boot = async () => {
  const config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "references.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      // Named by its email, which the assistant never sees (the auth defaults redact it).
      { slug: "users", auth: true, admin: { useAsTitle: "email" }, fields: [] },
      // Named by a field the app redacts with the `redact` option.
      { slug: "people", labels: { singular: "Person", plural: "People" }, admin: { useAsTitle: "name" }, fields: [{ name: "name", type: "text" }] },
      { slug: "customers", auth: true, fields: [] },
      {
        slug: "pages",
        admin: { useAsTitle: "title" },
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: "textarea" },
        ],
      },
      // Readable by nobody but the server.
      { slug: "secrets", admin: { useAsTitle: "name" }, access: { read: () => false }, fields: [{ name: "name", type: "text" }] },
      // Not given to plugin-mcp: the assistant can't reach it.
      { slug: "notes", admin: { useAsTitle: "name" }, fields: [{ name: "name", type: "text" }] },
    ],
    globals: [
      { slug: "header", label: "Header", fields: [{ name: "label", type: "text" }] },
      { slug: "vault", label: "Vault", access: { read: () => false }, fields: [{ name: "code", type: "text" }] },
      { slug: "footer", label: "Footer", fields: [{ name: "label", type: "text" }] },
    ],
    plugins: [
      mcpPlugin({
        collections: { pages: {}, secrets: {}, users: {}, people: {} },
        globals: { header: {}, vault: {} },
      }),
      assistantPluginWith(
        { models: [{ id: "test/model", label: "Test" }], apiKey: "sk-test", redact: { people: ["name"] } },
        {
          createAdapter: () => {
            const model = fakeText();
            model.setResponses(
              Array.from({ length: 4 }, () => ({ request }: { request: { messages: ModelMessage[] } }) => {
                calls.push(request.messages);
                return { text: "ok" };
              })
            );
            return model as never;
          },
          dispatch: (request) => inProcessDispatch(config, { payloadInstanceCacheKey: KEY })(request),
        }
      ),
    ],
  });
  return { config, payload: await getPayload({ config, key: KEY }) };
};

const call = (method: string, path: string, init: { as?: keyof typeof cookies | null; body?: unknown } = {}) => {
  const as = init.as === undefined ? "editor" : init.as;
  return handleEndpoints({
    config: app.config,
    payloadInstanceCacheKey: KEY,
    path: `/api${path.split("?")[0]}`,
    request: new Request(`${ORIGIN}/api${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        ...(as ? { Cookie: cookies[as] } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
  });
};

const newThread = () => `thread-${crypto.randomUUID()}`;
const send = (threadId: string, extra: Record<string, unknown>) =>
  call("POST", "/assistant/chat", { body: { threadId, message: "Tighten the intro.", ...extra } });
const hydrate = async (threadId: string) => (await call("GET", `/assistant/chat?threadId=${threadId}`)).json();
const lastUserText = (messages: ModelMessage[]) => {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
};

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-references-"));
  app = await boot();
  const login = async (collection: "users" | "customers", email: string) => {
    await app.payload.create({ collection: collection as never, data: { email, password: "pw-123456" } as never, overrideAccess: true });
    const { token, user } = await app.payload.login({ collection: collection as never, data: { email, password: "pw-123456" } });
    if (collection === "users") editorId = String((user as { id: number | string }).id);
    return `payload-token=${token}`;
  };
  cookies = { editor: await login("users", "editor@example.com"), customer: await login("customers", "c@example.com") };
  const create = async (collection: string, data: Record<string, unknown>) =>
    String(((await app.payload.create({ collection: collection as never, data: data as never, overrideAccess: true })) as { id: number | string }).id);
  homeId = await create("pages", { title: "Home", body: SECRET_BODY, _status: "draft" });
  aboutId = await create("pages", { title: "About us", body: SECRET_BODY, _status: "draft" });
  secretId = await create("secrets", { name: "Home secret" });
  await create("notes", { name: "Home note" });
  personId = await create("people", { name: "Ada Lovelace" });
});

afterAll(async () => {
  await app?.payload?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
});

describe("the edit view's context", () => {
  it("is resolved as the user, stored on the message with the server's title, and named to the model without content", async () => {
    const threadId = newThread();
    const response = await send(threadId, { forwardedProps: { context: { kind: "collection", slug: "pages", id: homeId, title: "Forged" } } });
    expect(response.status).toBe(200);
    await readEvents(response);

    const told = lastUserText(calls[0]!);
    expect(told).toContain("Tighten the intro.");
    expect(told).toContain(`\`pages\` id ${homeId} "Home"`);
    expect(told).toContain("findDocuments");
    expect(told).not.toContain(SECRET_BODY);
    expect(JSON.stringify(calls[0])).not.toContain(SECRET_BODY);

    const body = await hydrate(threadId);
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    // The stored message is the user's own words; the references are metadata.
    expect(JSON.stringify(user.parts)).not.toContain("document-references");
    expect(user.metadata.assistant).toEqual({ context: { kind: "collection", slug: "pages", id: homeId, title: "Home" } });
  });

  it("a global works the same way", async () => {
    const threadId = newThread();
    const response = await send(threadId, { context: { kind: "global", slug: "header" } });
    expect(response.status).toBe(200);
    await readEvents(response);
    expect(lastUserText(calls[0]!)).toContain('global `header` "Header"');
    expect((await hydrate(threadId)).messages[0].metadata.assistant.context).toEqual({ kind: "global", slug: "header", title: "Header" });
  });

  it.each([
    ["a document the user can't read", () => ({ kind: "collection", slug: "secrets", id: secretId }), 404, "reference_not_found"],
    ["a document that doesn't exist", () => ({ kind: "collection", slug: "pages", id: "999999" }), 404, "reference_not_found"],
    ["a collection the assistant can't reach", () => ({ kind: "collection", slug: "notes", id: "1" }), 400, "invalid_reference"],
    ["an unknown collection", () => ({ kind: "collection", slug: "nope", id: "1" }), 400, "invalid_reference"],
    ["a global the user can't read", () => ({ kind: "global", slug: "vault" }), 404, "reference_not_found"],
    ["a global the assistant can't reach", () => ({ kind: "global", slug: "footer" }), 400, "invalid_reference"],
  ])("refuses %s, and runs nothing", async (_name, context, status, code) => {
    const threadId = newThread();
    const response = await send(threadId, { context: context() });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(calls).toHaveLength(0);
    expect((await hydrate(threadId)).messages).toEqual([]);
  });

  it.each([
    ["no id", { kind: "collection", slug: "pages" }],
    ["a bad kind", { kind: "doc", slug: "pages", id: "1" }],
    ["a bad slug", { kind: "global", slug: "../x" }],
  ])("refuses a malformed context (%s) as an invalid body", async (_name, context) => {
    const response = await send(newThread(), { context });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_body" });
  });
});

const EDITOR_EMAIL = "editor@example.com";

describe("titles of redacted fields", () => {
  const userRef = () => ({ kind: "collection", slug: "users", id: editorId });
  const personRef = () => ({ kind: "collection", slug: "people", id: personId });

  it("a users context is named User #id: no email reaches the model, the stream or the stored message", async () => {
    const threadId = newThread();
    const response = await send(threadId, { context: userRef() });
    expect(response.status).toBe(200);
    const events = await readEvents(response);

    expect(lastUserText(calls[0]!)).toContain(`\`users\` id ${editorId} "User #${editorId}"`);
    expect(JSON.stringify(calls)).not.toContain(EDITOR_EMAIL);
    expect(JSON.stringify(events)).not.toContain(EDITOR_EMAIL);
    const body = await hydrate(threadId);
    expect(JSON.stringify(body)).not.toContain(EDITOR_EMAIL);
    expect(body.messages[0].metadata.assistant.context).toEqual({ kind: "collection", slug: "users", id: editorId, title: `User #${editorId}` });
  });

  it("a mention of a users document, and of one whose title the redact option hides, are named by label and id", async () => {
    const threadId = newThread();
    const response = await send(threadId, { references: [userRef(), personRef(), { kind: "collection", slug: "pages", id: homeId }] });
    expect(response.status).toBe(200);
    await readEvents(response);

    expect(lastUserText(calls[0]!)).toContain(
      `The editor mentioned: \`users\` id ${editorId} "User #${editorId}"; \`people\` id ${personId} "Person #${personId}"; \`pages\` id ${homeId} "Home".`
    );
    for (const secret of [EDITOR_EMAIL, "Ada Lovelace"]) {
      expect(JSON.stringify(calls)).not.toContain(secret);
      expect(JSON.stringify(await hydrate(threadId))).not.toContain(secret);
    }
  });

  it("the @ search never returns the hidden title, and finds those documents by label or id", async () => {
    const search = async (q: string) => call("GET", `/assistant/documents?q=${encodeURIComponent(q)}`);
    const seen: string[] = [];
    const titles = async (q: string) => {
      const text = await (await search(q)).text();
      seen.push(text);
      return (JSON.parse(text).documents as Array<{ slug: string; title: string }>).filter((d) => d.slug === "users" || d.slug === "people");
    };

    // By what the title field holds: nothing matches it, since it isn't read.
    expect(await titles("editor@")).toEqual([]);
    expect(await titles("Ada")).toEqual([]);
    // By label, by id, and in the empty-query list.
    expect(await titles("user")).toEqual([expect.objectContaining({ title: `User #${editorId}` })]);
    // (An id matches in every such collection: a user and a person may both be #1.)
    expect(await titles(`#${personId}`)).toContainEqual(expect.objectContaining({ slug: "people", id: personId, title: `Person #${personId}` }));
    expect(await titles("#99999")).toEqual([]);
    expect((await titles("")).map((d) => d.title)).toEqual(expect.arrayContaining([`User #${editorId}`, `Person #${personId}`]));
    for (const text of seen) {
      expect(text).not.toContain(EDITOR_EMAIL);
      expect(text).not.toContain("Ada Lovelace");
    }
    // A title that isn't redacted still shows.
    expect(JSON.parse(await (await search("Hom")).text()).documents).toEqual([{ kind: "collection", slug: "pages", id: homeId, title: "Home" }]);
  });

  it("the config endpoint tells the client which collections are named that way", async () => {
    const config = await (await call("GET", "/assistant/config")).json();
    expect(config.redactedTitles).toEqual({ users: "User", people: "Person" });
  });
});

describe("mentions", () => {
  it("are stored on the message (once each) and listed to the model by address and title only", async () => {
    const threadId = newThread();
    const ref = { kind: "collection", slug: "pages", id: aboutId };
    const response = await send(threadId, { references: [ref, ref, { kind: "global", slug: "header" }] });
    expect(response.status).toBe(200);
    await readEvents(response);

    const told = lastUserText(calls[0]!);
    expect(told).toContain(`The editor mentioned: \`pages\` id ${aboutId} "About us"; global \`header\` "Header".`);
    expect(JSON.stringify(calls[0])).not.toContain(SECRET_BODY);

    const stored = (await hydrate(threadId)).messages[0].metadata.assistant;
    expect(stored).toEqual({
      references: [
        { kind: "collection", slug: "pages", id: aboutId, title: "About us" },
        { kind: "global", slug: "header", title: "Header" },
      ],
    });
  });

  it("the note stays on the earlier message in later turns, and isn't repeated on new ones", async () => {
    const threadId = newThread();
    await readEvents(await send(threadId, { references: [{ kind: "collection", slug: "pages", id: aboutId }] }));
    calls = [];
    await readEvents(await call("POST", "/assistant/chat", { body: { threadId, message: "And now?" } }));
    const users = calls[0]!.filter((m) => m.role === "user");
    expect(users).toHaveLength(2);
    expect(String(users[0]!.content)).toContain("About us");
    expect(users[1]!.content).toBe("And now?");
  });

  it("refuses a mention of an unreadable document", async () => {
    const response = await send(newThread(), { references: [{ kind: "collection", slug: "secrets", id: secretId }] });
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses references on a resume and too many references", async () => {
    const resume = await call("POST", "/assistant/chat", {
      body: {
        threadId: newThread(),
        resume: [{ interruptId: "x", status: "resolved", payload: { approved: true } }],
        references: [{ kind: "global", slug: "header" }],
      },
    });
    expect(resume.status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => ({ kind: "collection", slug: "pages", id: String(i + 1) }));
    expect((await send(newThread(), { references: many })).status).toBe(400);
  });
});

describe("GET /api/assistant/documents (the @ search)", () => {
  const search = async (q: string, as: keyof typeof cookies | null = "editor") => call("GET", `/assistant/documents?q=${encodeURIComponent(q)}`, { as });

  it("finds documents by title through plugin-mcp, as the user, and returns only address and title", async () => {
    const response = await search("Hom");
    expect(response.status).toBe(200);
    const { documents } = await response.json();
    // "Home secret" (unreadable) and "Home note" (unreachable) never show up.
    expect(documents).toEqual([{ kind: "collection", slug: "pages", id: homeId, title: "Home" }]);
    for (const doc of documents) expect(Object.keys(doc).sort()).toEqual(["id", "kind", "slug", "title"]);
  });

  it("finds readable globals by label, never unreadable or unreachable ones", async () => {
    expect((await (await search("head")).json()).documents).toEqual([{ kind: "global", slug: "header", title: "Header" }]);
    expect((await (await search("vault")).json()).documents).toEqual([]);
    expect((await (await search("foot")).json()).documents).toEqual([]);
  });

  it("an empty query lists recent documents and readable globals", async () => {
    const { documents } = await (await search("")).json();
    const keys = documents.map((d: { slug: string; id?: string }) => `${d.slug}:${d.id ?? ""}`);
    expect(keys).toEqual(expect.arrayContaining([`pages:${homeId}`, `pages:${aboutId}`, "header:"]));
    expect(keys.some((k: string) => k.startsWith("secrets") || k.startsWith("vault"))).toBe(false);
    expect(JSON.stringify(documents)).not.toContain(SECRET_BODY);
  });

  it("is for signed-in users `access` admits", async () => {
    expect((await search("Hom", null)).status).toBe(401);
    expect((await search("Hom", "customer")).status).toBe(403);
  });

  it("refuses an overlong query", async () => {
    expect((await search("x".repeat(101))).status).toBe(400);
  });
});

describe("the edit-view control", () => {
  const controls = (entity: { admin?: { components?: { edit?: { beforeDocumentControls?: unknown[] } } } } | undefined) =>
    (entity?.admin?.components?.edit?.beforeDocumentControls ?? []) as Array<{ path?: string; clientProps?: unknown }>;

  it("is added to the collections and globals plugin-mcp exposes, and nowhere else", () => {
    const collection = (slug: string) => app.config.collections.find((c) => c.slug === slug);
    const global = (slug: string) => app.config.globals.find((g) => g.slug === slug);
    expect(controls(collection("pages"))).toContainEqual(
      expect.objectContaining({ path: DOCUMENT_CONTROLS_COMPONENT_PATH, clientProps: { kind: "collection", slug: "pages" } })
    );
    expect(controls(global("header"))).toContainEqual(
      expect.objectContaining({ path: DOCUMENT_CONTROLS_COMPONENT_PATH, clientProps: { kind: "global", slug: "header" } })
    );
    for (const entity of [collection("notes"), collection("customers"), global("footer")]) {
      expect(controls(entity).some((c) => c.path === DOCUMENT_CONTROLS_COMPONENT_PATH)).toBe(false);
    }
  });
});
