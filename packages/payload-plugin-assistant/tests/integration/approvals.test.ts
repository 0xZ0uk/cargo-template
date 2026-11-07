import type { CollectionSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@cargo/payload-plugin-mcp";
import { fakeText, type FakeResponseStep } from "@tanstack/ai/testing";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));

import type { ApprovalProposal } from "../../src/approvals/types";
import { assistantPluginWith } from "../../src/plugin";
import { inProcessDispatch } from "../../src/tools/inProcess";
import { ofType, readEvents, textOf } from "../sse";

/**
 * Approvals end to end (#65), in Node: real Payload 4 on SQLite with plugin-mcp, every request
 * through Payload's router with a user's cookie, the in-memory conversation backend and
 * `fakeText()` as the model. Covers the proposals endpoint (the diff the card shows), approve,
 * reject with a reason the model reads, stale proposals, batches, an access error at apply time,
 * and ownership.
 */
const KEY = "assistant-approvals";
const ORIGIN = "http://localhost:3000";
const READONLY = "readonly@example.com";

let tmpDir: string;
let app: { payload: Payload; config: SanitizedConfig };
let cookies: Record<"editor" | "other" | "readonly" | "customer", string>;
let fake = fakeText();
const script = (steps: FakeResponseStep[]) => {
  fake = fakeText();
  fake.setResponses(steps);
};

/** A Lexical editor state (stored in a `json` field here: the diff recognises the shape). */
const lexical = (...paragraphs: string[]) => ({
  root: {
    type: "root",
    version: 1,
    children: paragraphs.map((p) => ({ type: "paragraph", version: 1, children: [{ type: "text", text: p, version: 1 }] })),
  },
});

const notReadonly = ({ req }: { req: { user?: { email?: string } | null } }) => Boolean(req.user) && req.user?.email !== READONLY;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-approvals-"));
  const config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "approvals.db")}` }, push: true }),
    admin: { user: "users" },
    collections: [
      { slug: "users", auth: true, fields: [] },
      { slug: "customers", auth: true, fields: [] },
      {
        slug: "pages",
        labels: { singular: "Page", plural: "Pages" },
        admin: { useAsTitle: "title" },
        versions: { drafts: true },
        access: { read: () => true, create: notReadonly, update: notReadonly, delete: notReadonly },
        fields: [
          { name: "title", type: "text", label: "Title" },
          { name: "content", type: "json", label: "Content" },
          { name: "meta", type: "group", label: "SEO", fields: [{ name: "description", type: "text" }] },
        ],
      },
    ],
    plugins: [
      mcpPlugin({ collections: { pages: { description: "Website pages." } } }),
      assistantPluginWith(
        { models: [{ id: "m", label: "M" }], apiKey: "sk-test" },
        {
          createAdapter: () => fake,
          dispatch: (request) => inProcessDispatch(config, { payloadInstanceCacheKey: KEY })(request),
        }
      ),
    ],
  });
  app = { config, payload: await getPayload({ config, key: KEY }) };
  const login = async (collection: "users" | "customers", email: string) => {
    await app.payload.create({ collection: collection as CollectionSlug, data: { email, password: "pw-123456" } as never, overrideAccess: true });
    const { token } = await app.payload.login({ collection: collection as never, data: { email, password: "pw-123456" } });
    return `payload-token=${token}`;
  };
  cookies = {
    editor: await login("users", "editor@example.com"),
    other: await login("users", "other@example.com"),
    readonly: await login("users", READONLY),
    customer: await login("customers", "customer@example.com"),
  };
}, 120_000);

afterAll(async () => {
  await (app?.payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

type As = keyof typeof cookies | null;

const call = (method: string, path: string, init: { as?: As; body?: unknown } = {}) => {
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
const newPage = async (data: Record<string, unknown>) =>
  (await app.payload.create({ collection: "pages" as CollectionSlug, data: data as never, draft: true, overrideAccess: true })) as unknown as { id: number; updatedAt: string };
const readPage = async (id: number | string) =>
  (await app.payload.findByID({ collection: "pages" as CollectionSlug, id, draft: true, overrideAccess: true })) as unknown as Record<string, any>;

/** Sends a message; the scripted turn pauses on its write tool calls. Returns the interrupts. */
async function pauseOn(threadId: string, as: As = "editor") {
  const events = await readEvents(await call("POST", "/assistant/chat", { as, body: { threadId, message: "Please change it" } }));
  const outcome = ofType(events, "RUN_FINISHED").at(-1)?.outcome;
  expect(outcome?.type).toBe("interrupt");
  return outcome.interrupts as Array<{ id: string; toolCallId: string }>;
}

const proposals = async (threadId: string, as: As = "editor") => {
  const res = await call("GET", `/assistant/approvals?threadId=${threadId}`, { as });
  expect(res.status).toBe(200);
  return ((await res.json()) as { approvals: ApprovalProposal[] }).approvals;
};

const resume = (threadId: string, decisions: Array<{ interruptId: string; payload: unknown }>, as: As = "editor") =>
  call("POST", "/assistant/chat", { as, body: { threadId, resume: decisions.map((d) => ({ ...d, status: "resolved" })) } });

describe("GET /assistant/approvals: what the card shows", () => {
  it("401 / 403 / 400 like every endpoint", async () => {
    expect((await call("GET", "/assistant/approvals?threadId=t", { as: null })).status).toBe(401);
    expect((await call("GET", "/assistant/approvals?threadId=t", { as: "customer" })).status).toBe(403);
    expect((await call("GET", "/assistant/approvals")).status).toBe(400);
  });

  it("update: the current document (title, status, updatedAt) and a field-by-field diff; rich text as text", async () => {
    const page = await newPage({ title: "Home", content: lexical("Old intro."), meta: { description: "Old" } });
    const threadId = newThread();
    script([
      {
        toolCalls: [
          { name: "updateDocument", input: { slug: "pages", id: String(page.id), draft: true, data: { title: "Welcome", content: lexical("New intro.", "Second line."), meta: { description: "New" } } } },
        ],
      },
    ]);
    const [interrupt] = await pauseOn(threadId);
    const [proposal] = await proposals(threadId);
    expect(proposal).toMatchObject({
      interruptId: interrupt!.id,
      toolName: "updateDocument",
      action: "update",
      target: { kind: "collection", slug: "pages", label: "Page" },
      draft: true,
      items: [
        {
          document: { id: String(page.id), title: "Home", status: "draft", updatedAt: page.updatedAt },
          changes: [
            { path: "title", label: "Title", kind: "changed", before: "Home", after: "Welcome" },
            { path: "content", label: "Content", kind: "changed", format: "richText", before: "Old intro.", after: "New intro.\n\nSecond line." },
            { path: "meta.description", label: "SEO › Description", kind: "changed", before: "Old", after: "New" },
          ],
        },
      ],
    });
    expect(proposal!.changedSinceProposal).toBeUndefined();
    expect(JSON.stringify(proposal)).not.toContain('"root"');
  });

  it("create: the proposed fields; delete: what will be lost", async () => {
    const page = await newPage({ title: "Old page", content: lexical("Gone soon.") });
    const threadId = newThread();
    script([
      {
        toolCalls: [
          { name: "createDocuments", input: { slug: "pages", draft: true, documents: [{ data: { title: "About", content: lexical("We make chairs.") } }] } },
          { name: "deleteDocuments", input: { slug: "pages", id: String(page.id) } },
        ],
      },
    ]);
    await pauseOn(threadId);
    const [create, del] = await proposals(threadId);
    expect(create).toMatchObject({
      action: "create",
      items: [{ changes: [{ path: "title", kind: "added", after: "About" }, { path: "content", kind: "added", format: "richText", after: "We make chairs." }] }],
    });
    expect(del).toMatchObject({
      action: "delete",
      items: [{ document: { title: "Old page" }, changes: [{ path: "title", kind: "removed", before: "Old page" }, { path: "content", kind: "removed", before: "Gone soon." }] }],
    });
    expect(JSON.stringify([create, del])).not.toContain('"root"');
  });

  it("an unreadable document gives a notice and the proposed values, not an error", async () => {
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: "999999", data: { title: "Ghost" } } }] }]);
    await pauseOn(threadId);
    const [proposal] = await proposals(threadId);
    expect(proposal!.notice).toMatch(/could not be read/);
    expect(proposal!.items[0]!.changes).toEqual([expect.objectContaining({ path: "title", after: "Ghost" })]);
  });
});

describe("answering", () => {
  it("approve: the change is applied", async () => {
    const page = await newPage({ title: "Before" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), draft: true, data: { title: "After" } } }] }, { text: "Done." }]);
    const [interrupt] = await pauseOn(threadId);
    const [proposal] = await proposals(threadId);
    const events = await readEvents(await resume(threadId, [{ interruptId: interrupt!.id, payload: { approved: true, seenUpdatedAt: proposal!.items[0]!.document!.updatedAt } }]));
    expect(textOf(events)).toBe("Done.");
    expect((await readPage(page.id)).title).toBe("After");
    expect(await proposals(threadId)).toEqual([]);
  });

  it("reject: nothing is written and the model gets the reason", async () => {
    const page = await newPage({ title: "Keep me" });
    const threadId = newThread();
    let toolResult = "";
    script([
      { toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), draft: true, data: { title: "Changed" } } }] },
      ({ request }) => {
        const tool = request.messages.filter((m) => m.role === "tool").at(-1);
        toolResult = typeof tool?.content === "string" ? tool.content : JSON.stringify(tool?.content);
        return { text: "Understood." };
      },
    ]);
    const [interrupt] = await pauseOn(threadId);
    const events = await readEvents(await resume(threadId, [{ interruptId: interrupt!.id, payload: { approved: false, reason: "The title must stay as it is." } }]));
    expect(textOf(events)).toBe("Understood.");
    expect((await readPage(page.id)).title).toBe("Keep me");
    expect(toolResult).toContain("The user rejected this change");
    expect(toolResult).toContain("The title must stay as it is.");
    // The tool call shows as denied in the stream (the UI's "Rejected").
    expect(JSON.stringify(ofType(events, "TOOL_CALL_RESULT"))).toContain("The title must stay as it is.");
  });

  it("a reason that is too long, or not text, is a 400", async () => {
    for (const payload of [{ approved: false, reason: "x".repeat(2001) }, { approved: false, reason: 4 }, { approved: true, seenUpdatedAt: 5 }]) {
      const res = await resume(newThread(), [{ interruptId: "approval_x", payload }]);
      expect(res.status).toBe(400);
    }
  });

  it("several approvals in one turn: answered together, one applied and one rejected", async () => {
    const a = await newPage({ title: "A" });
    const b = await newPage({ title: "B" });
    const threadId = newThread();
    script([
      {
        toolCalls: [
          { name: "updateDocument", input: { slug: "pages", id: String(a.id), draft: true, data: { title: "A2" } } },
          { name: "updateDocument", input: { slug: "pages", id: String(b.id), draft: true, data: { title: "B2" } } },
        ],
      },
      { text: "One of two." },
    ]);
    const interrupts = await pauseOn(threadId);
    expect(interrupts).toHaveLength(2);
    expect((await proposals(threadId)).map((p) => p.items[0]!.document!.title)).toEqual(["A", "B"]);

    // TanStack resumes a batch all or nothing: an answer for only one of them changes nothing.
    const partial = await readEvents(await resume(threadId, [{ interruptId: interrupts[0]!.id, payload: { approved: true } }]));
    expect(ofType(partial, "RUN_ERROR")).not.toHaveLength(0);
    expect((await readPage(a.id)).title).toBe("A");
    expect(await proposals(threadId)).toHaveLength(2);

    await readEvents(
      await resume(threadId, [
        { interruptId: interrupts[0]!.id, payload: { approved: true } },
        { interruptId: interrupts[1]!.id, payload: { approved: false, reason: "Not B" } },
      ])
    );
    expect((await readPage(a.id)).title).toBe("A2");
    expect((await readPage(b.id)).title).toBe("B");
  });
});

describe("stale proposals", () => {
  it("a document changed after the proposal is flagged, and an approval of the old diff is refused with 409", async () => {
    const page = await newPage({ title: "Original" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), draft: true, data: { title: "From the assistant" } } }] }, { text: "Applied." }]);
    const [interrupt] = await pauseOn(threadId);
    const [seen] = await proposals(threadId);
    const seenUpdatedAt = seen!.items[0]!.document!.updatedAt!;

    // Someone edits the page meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.payload.update({ collection: "pages" as CollectionSlug, id: page.id, data: { title: "Edited by a person" } as never, draft: true, overrideAccess: true });

    const [fresh] = await proposals(threadId);
    expect(fresh!.changedSinceProposal).toBe(true);
    expect(fresh!.items[0]!.changes[0]).toMatchObject({ before: "Edited by a person", after: "From the assistant" });

    const refused = await resume(threadId, [{ interruptId: interrupt!.id, payload: { approved: true, seenUpdatedAt } }]);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "stale", interruptIds: [interrupt!.id] });
    expect((await readPage(page.id)).title).toBe("Edited by a person");
    expect(await proposals(threadId)).toHaveLength(1);

    // Confirmed against the current version: applied.
    const events = await readEvents(await resume(threadId, [{ interruptId: interrupt!.id, payload: { approved: true, seenUpdatedAt: fresh!.items[0]!.document!.updatedAt } }]));
    expect(textOf(events)).toBe("Applied.");
    expect((await readPage(page.id)).title).toBe("From the assistant");
  });
});

describe("access and ownership", () => {
  it("an approved write the user may not make comes back as a tool error; nothing changes", async () => {
    const page = await newPage({ title: "Protected" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), draft: true, data: { title: "Hacked" } } }] }, { text: "I couldn't." }]);
    const [interrupt] = await pauseOn(threadId, "readonly");
    // The card can still be built: the user may read the page.
    expect((await proposals(threadId, "readonly"))[0]!.items[0]!.document!.title).toBe("Protected");
    const events = await readEvents(await resume(threadId, [{ interruptId: interrupt!.id, payload: { approved: true } }], "readonly"));
    const result = JSON.stringify(ofType(events, "TOOL_CALL_RESULT"));
    expect(result).toMatch(/error/i);
    expect(result).toMatch(/not enabled|not allowed|forbidden/i);
    expect((await readPage(page.id)).title).toBe("Protected");
  });

  it("another user can't see or answer someone else's approval", async () => {
    const page = await newPage({ title: "Mine" });
    const threadId = newThread();
    script([{ toolCalls: [{ name: "updateDocument", input: { slug: "pages", id: String(page.id), draft: true, data: { title: "Theirs" } } }] }, { text: "never" }]);
    const [interrupt] = await pauseOn(threadId);

    expect((await call("GET", `/assistant/approvals?threadId=${threadId}`, { as: "other" })).status).toBe(404);
    // With and without the stale check's ownership path.
    for (const payload of [{ approved: true }, { approved: true, seenUpdatedAt: page.updatedAt }]) {
      const res = await resume(threadId, [{ interruptId: interrupt!.id, payload }], "other");
      expect(res.status).toBe(404);
    }
    expect((await readPage(page.id)).title).toBe("Mine");
    // Still pending for the owner.
    expect((await proposals(threadId)).map((p) => p.interruptId)).toEqual([interrupt!.id]);
  });
});
