import type { Block, CollectionSlug, Payload, PayloadRequest, SanitizedConfig } from "payload";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { mcpPlugin } from "@shipment/payload-plugin-mcp";
import {
  BoldFeature,
  HeadingFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnderlineFeature,
  UnorderedListFeature,
  lexicalEditor,
} from "@payloadcms/richtext-lexical";
import { fakeText, type FakeResponseStep } from "@tanstack/ai/testing";
import { buildConfig, getPayload, handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@payloadcms/ui", () => ({ Banner: () => null }));
vi.mock("@payloadcms/ui/rsc", () => ({ DefaultTemplate: () => null }));

import type { ApprovalProposal } from "../../src/approvals/types";
import { assistantPluginWith } from "../../src/plugin";
import { markdownLosses, unsupportedMarkdown, resolveRichText, RichTextPathError, convertersOf, blocksBySlugOf, collectionOf, parseInternalLinkUrl, type FieldLike } from "../../src/richText/fields";
import { describeRichTextAsMarkdown, sameMarkdown, setRichTextFromMarkdownTool, SET_RICH_TEXT_TOOL_NAME, withMarkdownRichText } from "../../src/richText/tool";
import { buildSystemPrompt } from "../../src/server/instructions";
import { createPayloadToolSource, authHeadersFrom, type PayloadToolSource } from "../../src/tools/payloadToolSource";
import { inProcessDispatch } from "../../src/tools/inProcess";
import { normalizeOptions } from "../../src/utils/normalizeOptions";
import { ofType, readEvents } from "../sse";

/**
 * Rich text as Markdown (#67), in Node: real Payload 4 on SQLite with Lexical editors shaped like
 * the app's (root: paragraph, underline, bold, italic, link; blocks registered once on the config
 * and referenced by slug; a column → content blocks nesting like the app's Columns block), plus a
 * fixture field with list features. The tool and the read conversion are called through
 * plugin-mcp's endpoint as a signed-in user; the approval card through the assistant's endpoints.
 */
const KEY = "assistant-rich-text";
const ORIGIN = "http://localhost:3000";
const READONLY = "readonly@example.com";

let tmpDir: string;
let app: { payload: Payload; config: SanitizedConfig };
let cookies: Record<"editor" | "readonly", string>;
let fake = fakeText();
const script = (steps: FakeResponseStep[]) => {
  fake = fakeText();
  fake.setResponses(steps);
};
const sources: PayloadToolSource[] = [];

const rootEditor = lexicalEditor({
  features: [ParagraphFeature(), UnderlineFeature(), BoldFeature(), ItalicFeature(), LinkFeature({ enabledCollections: ["pages"] })],
});
const withHeadings = (sizes: Array<"h1" | "h2" | "h3" | "h4">) =>
  lexicalEditor({ features: ({ rootFeatures }) => [...rootFeatures, HeadingFeature({ enabledHeadingSizes: sizes })] });

const richTextBlock: Block = {
  slug: "richText",
  labels: { singular: "Rich text", plural: "Rich text" },
  fields: [{ name: "richText", type: "richText", editor: withHeadings(["h1", "h2", "h3", "h4"]) }],
};
const columnsBlock: Block = {
  slug: "columns",
  labels: { singular: "Columns", plural: "Columns" },
  fields: [
    { name: "title", type: "text" },
    {
      name: "columns",
      type: "array",
      fields: [
        {
          name: "content",
          type: "blocks",
          blocks: [
            { slug: "columnText", labels: { singular: "Text", plural: "Text" }, fields: [{ name: "richText", type: "richText", editor: withHeadings(["h2", "h3", "h4"]) }] },
            { slug: "columnButtons", fields: [{ name: "label", type: "text" }] },
          ],
        },
      ],
    },
  ],
};
const ctaBlock: Block = { slug: "cta", fields: [{ name: "title", type: "text" }] };

const notReadonly = ({ req }: { req: { user?: { email?: string } | null } }) => Boolean(req.user) && req.user?.email !== READONLY;

// ── Lexical builders ───────────────────────────────────────────────────────────────────────
const t = (text: string, format = 0) => ({ type: "text", text, format, detail: 0, mode: "normal", style: "", version: 1 });
const p = (...children: unknown[]) => ({ type: "paragraph", children, direction: "ltr", format: "", indent: 0, textFormat: 0, version: 1 });
const state = (...children: unknown[]) => ({ root: { type: "root", children, direction: "ltr", format: "", indent: 0, version: 1 } });

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-richtext-"));
  const config = await buildConfig({
    secret: "test-secret",
    // Block references need blocks stored as JSON, as the app does (`blocksAsJSON`).
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "richtext.db")}` }, push: true, blocksAsJSON: true }),
    admin: { user: "users" },
    editor: rootEditor,
    blocks: [richTextBlock, columnsBlock, ctaBlock],
    collections: [
      { slug: "users", auth: true, fields: [] },
      {
        slug: "pages",
        labels: { singular: "Page", plural: "Pages" },
        admin: { useAsTitle: "title" },
        versions: { drafts: true },
        access: { read: () => true, create: notReadonly, update: notReadonly, delete: notReadonly },
        fields: [
          { name: "title", type: "text" },
          { name: "hero", type: "group", fields: [{ name: "heading", type: "text" }, { name: "richText", type: "richText", editor: withHeadings(["h1"]) }] },
          {
            type: "tabs",
            tabs: [{ label: "Content", fields: [{ name: "layout", type: "blocks", blocks: [], blockReferences: ["richText", "columns", "cta"] }] }],
          },
          {
            // A fixture editor with lists: the app's editors have none.
            name: "listy",
            type: "richText",
            editor: lexicalEditor({ features: ({ rootFeatures }) => [...rootFeatures, HeadingFeature({ enabledHeadingSizes: ["h2"] }), UnorderedListFeature(), OrderedListFeature()] }),
          },
        ],
      },
      {
        slug: "notes",
        fields: [{ name: "body", type: "richText" }, { name: "tags", type: "text" }],
      },
    ],
    plugins: [
      mcpPlugin({
        collections: {
          pages: withMarkdownRichText("pages", { description: "Website pages." }),
          notes: withMarkdownRichText("notes"),
        },
      }),
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
  const login = async (email: string) => {
    await app.payload.create({ collection: "users" as CollectionSlug, data: { email, password: "pw-123456" } as never, overrideAccess: true });
    const { token } = await app.payload.login({ collection: "users" as never, data: { email, password: "pw-123456" } });
    return `payload-token=${token}`;
  };
  cookies = { editor: await login("editor@example.com"), readonly: await login(READONLY) };
}, 120_000);

afterAll(async () => {
  await Promise.allSettled(sources.map((s) => s.close()));
  await (app?.payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

const tools = async (as: keyof typeof cookies = "editor") => {
  const source = createPayloadToolSource({
    endpoint: `${ORIGIN}/api/mcp`,
    headers: authHeadersFrom(new Request(`${ORIGIN}/api/assistant/chat`, { method: "POST", headers: { cookie: cookies[as] } })),
    dispatch: inProcessDispatch(app.config, { payloadInstanceCacheKey: KEY }),
  });
  sources.push(source);
  return new Map((await source.tools()).map((tool) => [tool.name, tool]));
};

/** Calls a tool as the user; the MCP text (or the thrown error's message, for `isError`). */
const run = async (name: string, input: Record<string, unknown>, as: keyof typeof cookies = "editor"): Promise<string> => {
  const tool = (await tools(as)).get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  try {
    const result = await tool.execute!(input as never, {} as never);
    const parsed = typeof result === "string" ? result : JSON.stringify(result);
    return parsed;
  } catch (error) {
    return `ERROR ${(error as Error).message}`;
  }
};

const pageField = (name: string) =>
  (collectionOf({ payload: app.payload } as unknown as PayloadRequest, "pages")!.flattenedFields as FieldLike[]).find((f) => f.name === name)!;

const newPage = async (data: Record<string, unknown>) =>
  (await app.payload.create({ collection: "pages" as CollectionSlug, data: data as never, draft: true, overrideAccess: true })) as unknown as Record<string, any>;
const readPage = async (id: number | string) =>
  (await app.payload.findByID({ collection: "pages" as CollectionSlug, id, draft: true, depth: 0, overrideAccess: true })) as unknown as Record<string, any>;
const md = (field: FieldLike, value: unknown) => convertersOf(field)!.toMarkdown({ data: value }).trim();

const layoutPage = () =>
  newPage({
    title: "Home",
    hero: { heading: "Hello", richText: state(p(t("Old hero."))) },
    layout: [
      { blockType: "cta", title: "Call us" },
      {
        blockType: "columns",
        title: "Two columns",
        columns: [
          { content: [{ blockType: "columnButtons", label: "Go" }] },
          { content: [{ blockType: "columnButtons", label: "Left" }, { blockType: "columnText", richText: state(p(t("Old column text."))) }] },
        ],
      },
      { blockType: "richText", richText: state(p(t("First paragraph.")), p(t("Second paragraph."))) },
    ],
  });

describe("converters: Markdown round trip", () => {
  it("keeps headings, bold, italic and links on the app-shaped block editor", () => {
    const field = (collectionOf({ payload: app.payload } as unknown as PayloadRequest, "pages")!.flattenedFields as FieldLike[]).find((f) => f.name === "layout")!;
    const block = blocksBySlugOf({ payload: app.payload } as unknown as PayloadRequest).get("richText")!;
    const rich = (block.flattenedFields ?? block.fields)!.find((f) => f.name === "richText")!;
    expect(field).toBeDefined();
    const source = "# Title\n\n## Section\n\nSome **bold**, _italic_ and a [link](https://example.com).";
    const converters = convertersOf(rich)!;
    const back = converters.toMarkdown({ data: converters.fromMarkdown({ markdown: source }) });
    expect(sameMarkdown(back, source)).toBe(true);
    expect(back).toContain("# Title");
    expect(back).toContain("[link](https://example.com)");
  });

  it("keeps lists on an editor with list features (fixture)", () => {
    const source = "## Steps\n\n- one\n- two\n\n1. first\n2. second";
    const converters = convertersOf(pageField("listy"))!;
    const back = converters.toMarkdown({ data: converters.fromMarkdown({ markdown: source }) });
    expect(sameMarkdown(back, source)).toBe(true);
  });

  it("an editor without lists or a heading level keeps the text, not the structure", () => {
    const converters = convertersOf(pageField("hero").flattenedFields!.find((f) => f.name === "richText"))!;
    const converted = converters.fromMarkdown({ markdown: "## Not allowed\n\n- item\n\n# Allowed" });
    expect(unsupportedMarkdown(converted).sort()).toEqual(["h2 headings", "lists"]);
    expect((converted as any).root.children.map((n: { type: string }) => n.type)).toEqual(["paragraph", "paragraph", "heading"]);
  });

  it("names what Markdown can't keep", () => {
    expect(markdownLosses(state(p(t("plain"), t("bold", 1))))).toEqual([]);
    // An autolink (a pasted URL) exports as `[url](url)`: not a loss.
    expect(markdownLosses(state(p({ type: "autolink", fields: { linkType: "custom", url: "https://example.com" }, children: [t("https://example.com")], version: 2 })))).toEqual([]);
    expect(
      markdownLosses(
        state(
          { ...p(t("u", 8)), format: "center", indent: 1 },
          p({ type: "link", fields: { linkType: "internal", doc: { relationTo: "pages", value: 1 }, newTab: true }, children: [t("x")], version: 3 }),
          p({ type: "link", fields: { linkType: "internal", doc: null }, children: [t("nowhere")], version: 3 }),
          { type: "upload", relationTo: "media", value: 1, version: 3 }
        )
      ).sort()
    ).toEqual(["indentation", "internal links without a target document", "links opening in a new tab", "text alignment", "underline", "upload nodes"].sort());
    // An internal link with a target is kept (as payload://pages/1), not a loss.
    expect(markdownLosses(state(p({ type: "link", fields: { linkType: "internal", doc: { relationTo: "pages", value: 1 } }, children: [t("x")], version: 3 })))).toEqual([]);
  });
});

describe("paths", () => {
  it("resolves blocks by blockType and lists the document's rich text paths on errors", async () => {
    const page = await layoutPage();
    const collection = collectionOf({ payload: app.payload } as unknown as PayloadRequest, "pages")!;
    const blocks = blocksBySlugOf({ payload: app.payload } as unknown as PayloadRequest);
    expect(resolveRichText(collection, page, "layout.1.columns.1.content.1.richText", blocks)).toMatchObject({
      path: "layout.1.columns.1.content.1.richText",
      label: "Layout › 2 · Columns › Columns › 2 › Content › 2 · Text › Rich Text",
    });
    expect(resolveRichText(collection, page, "layout[2].richText", blocks).path).toBe("layout.2.richText");
    const paths = "hero.richText, layout.1.columns.1.content.1.richText, layout.2.richText, listy";
    const fails = (path: string) => {
      try {
        resolveRichText(collection, page, path, blocks);
      } catch (error) {
        expect(error).toBeInstanceOf(RichTextPathError);
        return (error as Error).message;
      }
      throw new Error("resolved");
    };
    expect(fails("nope")).toContain(`no field "nope"`);
    expect(fails("nope")).toContain(paths);
    expect(fails("title")).toContain("is a text field, not rich text");
    expect(fails("hero")).toContain("is a group field, not rich text");
    expect(fails("layout.0.title")).toContain("is a text field, not rich text"); // the CTA block has a title
    expect(fails("layout.0.body")).toContain(`no field "body" in "layout.0"`);
    expect(fails("layout.9.richText")).toContain("has 3 rows (0–2), no row 9");
    expect(fails("layout.richText")).toContain(`give the row number`);
  });
});

describe(`${SET_RICH_TEXT_TOOL_NAME} through plugin-mcp`, () => {
  it("needs approval (not read-only) and is refused to users who can't update the collection", async () => {
    const tool = (await tools("editor")).get(SET_RICH_TEXT_TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool!.needsApproval).toBe(true);
    // Still listed for the read-only user (they can update `notes`: one tool for all collections),
    // but refused for `pages`, which they can't update.
    const page = await layoutPage();
    const denied = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "hero.richText", markdown: "Hacked" }, "readonly");
    expect(denied).toContain('is not enabled for collection "pages"');
    expect((await readPage(page.id)).hero.richText).toEqual(page.hero.richText);
  });

  it("writes a block's rich text as a draft: sibling fields and block/row ids are kept", async () => {
    const page = await layoutPage();
    const before = await readPage(page.id);
    const result = await run(SET_RICH_TEXT_TOOL_NAME, {
      slug: "pages",
      id: page.id,
      path: "layout.1.columns.1.content.1.richText",
      markdown: "## New heading\n\nNew **column** text with a [link](https://example.com).",
    });
    expect(result).toContain(`Updated "layout.1.columns.1.content.1.richText" of pages ${page.id} (saved as a draft)`);
    expect(result).not.toContain('"root"');
    const after = await readPage(page.id);
    expect(after._status).toBe("draft");
    expect(after.title).toBe("Home");
    expect(after.hero).toEqual(before.hero);
    const ids = (doc: Record<string, any>) => JSON.stringify(doc.layout, (k, v) => (k === "richText" ? undefined : v));
    expect(ids(after)).toBe(ids(before)); // every block, row and sibling, ids included
    expect(after.layout[2].richText).toEqual(before.layout[2].richText);
    const field = columnsBlock.fields[1] as never;
    void field;
    const text = md(
      (blocksBySlugOf({ payload: app.payload } as unknown as PayloadRequest).get("columns")!.flattenedFields!.find((f) => f.name === "columns")!.flattenedFields!.find((f) => f.name === "content")!.blocks as FieldLike[] as never as Array<{ slug: string; flattenedFields: FieldLike[] }>)
        .find((b) => b.slug === "columnText")!
        .flattenedFields.find((f) => f.name === "richText")!,
      after.layout[1].columns[1].content[1].richText
    );
    expect(text).toBe("## New heading\n\nNew **column** text with a [link](https://example.com).");
  });

  it("writes a group's rich text; `draft: false` publishes", async () => {
    const page = await layoutPage();
    const result = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "hero.richText", markdown: "# Welcome\n\nWe make _chairs_.", draft: false });
    expect(result).toContain("(published)");
    const published = (await app.payload.findByID({ collection: "pages" as CollectionSlug, id: page.id, depth: 0, overrideAccess: true })) as Record<string, any>;
    expect(published._status).toBe("published");
    expect(md(pageField("hero").flattenedFields!.find((f) => f.name === "richText")!, published.hero.richText)).toBe("# Welcome\n\nWe make *chairs*.");
    expect(published.layout).toHaveLength(3);
  });

  it("says when the field's editor dropped some of the Markdown", async () => {
    const page = await layoutPage();
    const result = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "hero.richText", markdown: "## Not h1\n\n- a list" });
    expect(result).toContain("This field's editor doesn't support h2 headings, lists: that Markdown was kept as plain text.");
  });

  it("refuses to drop formatting Markdown can't keep, unless allowFormattingLoss", async () => {
    const page = await newPage({ title: "Underlined", hero: { richText: state(p(t("Keep "), t("this", 8))) } });
    const refused = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "hero.richText", markdown: "Keep this" });
    expect(refused).toMatch(/^ERROR .*Not written: "hero.richText" contains underline/);
    expect((await readPage(page.id)).hero.richText.root.children[0].children[1].format).toBe(8);
    const written = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "hero.richText", markdown: "Keep this", allowFormattingLoss: true });
    expect(written).toContain("Updated");
    expect(markdownLosses((await readPage(page.id)).hero.richText)).toEqual([]);
  });

  it("clear errors: unknown path, not rich text, missing document, collection without the tool", async () => {
    const page = await layoutPage();
    const call = (input: Record<string, unknown>) => run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, markdown: "x", ...input });
    expect(await call({ path: "layout.0.body" })).toMatch(/no field "body".*Rich text paths in this document: hero\.richText, layout\.1\.columns\.1\.content\.1\.richText, layout\.2\.richText, listy/);
    expect(await call({ path: "title" })).toContain('"title" is a text field, not rich text');
    expect(await call({ path: "layout.5.richText" })).toContain("no row 5");
    expect(await call({ path: "hero.richText", id: 999999 })).toContain('document "999999" not found in "pages"');
    expect(await run(SET_RICH_TEXT_TOOL_NAME, { slug: "users", id: 1, path: "x", markdown: "x" })).toContain('is not enabled for collection "users"');
  });

  it("the handler itself names the collections with rich text for an unknown slug", async () => {
    const req = ({ payload: app.payload, user: null, url: `${ORIGIN}/api/assistant/chat` } as unknown as PayloadRequest);
    const response = await setRichTextFromMarkdownTool.handler({
      slug: "nope" as CollectionSlug,
      input: { id: 1, path: "x", markdown: "x" },
      req,
      authorizedMCP: { items: [], overrideAccess: false },
      serverContext: {} as never,
    });
    expect(response.isError).toBe(true);
    expect((response.content[0] as { text: string }).text).toBe('Error: "nope" is not a collection. Collections with rich text: pages, notes.');
  });

  it("works on a collection without drafts", async () => {
    const note = (await app.payload.create({ collection: "notes" as CollectionSlug, data: { tags: "a" } as never, overrideAccess: true })) as Record<string, any>;
    expect(await run(SET_RICH_TEXT_TOOL_NAME, { slug: "notes", id: note.id, path: "body", markdown: "Hello **world**" })).toContain("(saved)");
    const read = (await app.payload.findByID({ collection: "notes" as CollectionSlug, id: note.id, overrideAccess: true })) as Record<string, any>;
    expect(read.tags).toBe("a");
    expect(read.body.root.children[0].children.map((c: { text: string }) => c.text).join("")).toBe("Hello world");
  });
});

describe("findDocuments returns rich text as Markdown", () => {
  it("by id and by where: Markdown, never Lexical JSON", async () => {
    const page = await layoutPage();
    const byId = await run("findDocuments", { slug: "pages", id: page.id, draft: true, depth: 0 });
    expect(byId).toContain("Old hero.");
    expect(byId).toContain("First paragraph.\\n\\nSecond paragraph.");
    expect(byId).toContain(`change them with ${SET_RICH_TEXT_TOOL_NAME}`);
    expect(byId).not.toContain('"root"');
    expect(byId).not.toContain(`\\"type\\":\\"paragraph\\"`);

    const many = await run("findDocuments", { slug: "pages", where: { id: { equals: page.id } }, draft: true, depth: 0, limit: 1 });
    expect(many).toContain(`Collection: "pages"`);
    expect(many).toContain("Old column text.");
    expect(many).not.toContain('"root"');
  });

  it("leaves documents without rich text and errors as they are", async () => {
    const missing = await run("findDocuments", { slug: "pages", id: 999999 });
    expect(missing).toContain("not found");
  });
});

describe("internal links round-trip as payload://<collection>/<id> (#116)", () => {
  const internal = (text: string, value: number | string | Record<string, unknown>) =>
    ({ type: "link", fields: { linkType: "internal", doc: { relationTo: "pages", value }, newTab: false }, children: [t(text)], direction: "ltr", format: "", indent: 0, version: 3 });
  const links = (value: unknown): Array<Record<string, any>> => {
    const out: Array<Record<string, any>> = [];
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "link") out.push(node.fields);
      (node.children ?? []).forEach(visit);
    };
    visit((value as any)?.root);
    return out;
  };
  const blockField = () => {
    const block = blocksBySlugOf({ payload: app.payload } as unknown as PayloadRequest).get("richText")!;
    return (block.flattenedFields ?? block.fields)!.find((f) => f.name === "richText")!;
  };

  it("the converters write an internal link as payload://pages/<id> and read it back as internal", () => {
    const converters = convertersOf(blockField())!;
    const markdown = converters.toMarkdown({ data: state(p(t("See "), internal("about us", 12), t(" and "), internal("pricing", { id: 7, title: "Pricing" }), t("."))) });
    expect(markdown).toBe("See [about us](payload://pages/12) and [pricing](payload://pages/7).");
    const back = converters.fromMarkdown({ markdown: `${markdown} Or [the docs](https://example.com).` });
    expect(links(back)).toEqual([
      expect.objectContaining({ linkType: "internal", doc: { relationTo: "pages", value: 12 } }),
      expect.objectContaining({ linkType: "internal", doc: { relationTo: "pages", value: 7 } }),
      expect.objectContaining({ linkType: "custom", url: "https://example.com" }),
    ]);
    expect(links(back)[0]).not.toHaveProperty("url");
    expect(parseInternalLinkUrl("payload://pages/abc%2Fdef")).toEqual({ relationTo: "pages", id: "abc/def" });
    expect(parseInternalLinkUrl("https://pages/1")).toBeUndefined();
  });

  it("findDocuments shows the link, and setRichTextFromMarkdown keeps it and adds new ones", async () => {
    const target = await newPage({ title: "About" });
    const other = await newPage({ title: "Pricing" });
    const page = await newPage({ title: "Linking", layout: [{ blockType: "richText", richText: state(p(t("Read "), internal("about us", target.id), t("."))) }] });

    const read = await run("findDocuments", { slug: "pages", id: page.id, draft: true, depth: 0 });
    expect(read).toContain(`[about us](payload://pages/${target.id})`);

    const markdown = `Read [about us](payload://pages/${target.id}) and [pricing](payload://pages/${other.id}).`;
    const out = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "layout.0.richText", markdown });
    expect(out).toContain('Updated "layout.0.richText"');
    expect(out).not.toMatch(/Not written/);
    const stored = (await readPage(page.id)).layout[0].richText;
    expect(links(stored)).toEqual([
      expect.objectContaining({ linkType: "internal", doc: expect.objectContaining({ relationTo: "pages", value: expect.anything() }) }),
      expect.objectContaining({ linkType: "internal", doc: expect.objectContaining({ relationTo: "pages", value: expect.anything() }) }),
    ]);
    const ids = links(stored).map((f) => (typeof f.doc.value === "object" ? f.doc.value.id : f.doc.value));
    expect(ids).toEqual([target.id, other.id]);
    expect(await run("findDocuments", { slug: "pages", id: page.id, draft: true, depth: 0 })).toContain(`[pricing](payload://pages/${other.id})`);
  });

  it("refuses a link to a document that doesn't exist, with a clear message", async () => {
    const page = await newPage({ title: "Broken link", layout: [{ blockType: "richText", richText: state(p(t("Old."))) }] });
    const out = await run(SET_RICH_TEXT_TOOL_NAME, { slug: "pages", id: page.id, path: "layout.0.richText", markdown: "See [this](payload://pages/999999) and [that](payload://nope/1)." });
    expect(out).toContain("Not written");
    expect(out).toContain("payload://pages/999999");
    expect(out).toContain('payload://nope/1 (no collection "nope")');
    expect(md(blockField(), (await readPage(page.id)).layout[0].richText)).toBe("Old.");
  });
});

describe("other tools' results and the schema (#116)", () => {
  const noLexical = (out: string) => {
    expect(out).not.toContain('\\"root\\"');
    expect(out).not.toContain('"root"');
    expect(out).not.toContain(`\\"type\\":\\"paragraph\\"`);
  };

  it("updateDocument (returning), the version tools and duplicate show rich text as Markdown", async () => {
    const page = await layoutPage();
    const updated = await run("updateDocument", { slug: "pages", id: page.id, draft: true, data: { title: "Home 2" }, returning: true, depth: 0 });
    expect(updated).toContain("Document updated successfully");
    expect(updated).toContain("Old hero.");
    expect(updated).toContain(`change them with ${SET_RICH_TEXT_TOOL_NAME}`);
    noLexical(updated);

    const versions = await run("findVersions", { slug: "pages", where: { parent: { equals: page.id } }, limit: 2, depth: 0 });
    expect(versions).toContain("Versions for collection");
    expect(versions).toContain("Old column text.");
    noLexical(versions);
    const versionId = /"id":(\d+|"[^"]+")/.exec(versions.slice(versions.indexOf('"docs"')))![1]!.replace(/"/g, "");

    const version = await run("findVersionByID", { slug: "pages", id: versionId, depth: 0 });
    expect(version).toContain("First paragraph.");
    noLexical(version);

    const restored = await run("restoreVersion", { slug: "pages", id: versionId, depth: 0 });
    expect(restored).toContain("restored successfully");
    expect(restored).toContain("First paragraph.");
    noLexical(restored);

    const duplicated = await run("duplicateDocument", { slug: "pages", id: page.id, depth: 0 });
    expect(duplicated).toContain("duplicated successfully");
    expect(duplicated).toContain("Old hero.");
    noLexical(duplicated);
  });

  it("updateDocument without returning is left as it is (only the id)", async () => {
    const page = await layoutPage();
    const out = await run("updateDocument", { slug: "pages", id: page.id, draft: true, data: { title: "Plain" } });
    expect(out).toContain("Document updated successfully");
    expect(out).not.toContain(SET_RICH_TEXT_TOOL_NAME);
  });

  it("describes rich text fields Payload deduplicated into $defs, and prunes the Lexical defs", () => {
    const lexical = { type: "object", properties: { root: { type: "object", properties: { type: { const: "root" }, children: { items: { $ref: "#/$defs/paragraph" } } } } } };
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        intro: { $ref: "#/$defs/shared_0" },
        body: { $ref: "#/$defs/shared_0" },
        blocks: { type: "array", items: { $ref: "#/$defs/block" } },
      },
      $defs: {
        shared_0: lexical,
        paragraph: { type: "object", properties: { type: { const: "paragraph" } } },
        block: { type: "object", properties: { text: lexical, label: { type: "string" } } },
      },
    };
    const { schema: out, changed } = describeRichTextAsMarkdown(schema) as { schema: { properties: Record<string, unknown>; $defs?: Record<string, unknown> }; changed: boolean };
    expect(changed).toBe(true);
    expect(out.properties.intro).toEqual({ description: expect.stringContaining(SET_RICH_TEXT_TOOL_NAME) });
    expect(out.properties.body).toEqual({ description: expect.stringContaining(SET_RICH_TEXT_TOOL_NAME) });
    expect(Object.keys(out.$defs ?? {})).toEqual(["block"]);
    expect(JSON.stringify(out)).not.toContain("paragraph");
    expect(JSON.stringify(out)).not.toContain('"root"');
  });

  it("getCollectionSchema describes rich text as Markdown written with the tool, without the Lexical schema", async () => {
    const out = await run("getCollectionSchema", { slug: "pages" });
    expect(out).toContain(`Write it only with ${SET_RICH_TEXT_TOOL_NAME}`);
    expect(out).toContain('"title"');
    expect(out).toContain('"hero"');
    expect(out).not.toContain('\\"const\\":\\"root\\"');
    expect(out).not.toContain("paragraph");
  });
});

describe("the approval card", () => {
  const call = (method: string, path: string, body?: unknown) =>
    handleEndpoints({
      config: app.config,
      payloadInstanceCacheKey: KEY,
      path: `/api${path.split("?")[0]}`,
      request: new Request(`${ORIGIN}/api${path}`, {
        method,
        headers: { Origin: ORIGIN, Cookie: cookies.editor, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    });

  it("pauses for approval, shows the change as text (before: current Markdown, after: proposed), then writes it", async () => {
    const page = await layoutPage();
    const threadId = `thread-${crypto.randomUUID()}`;
    script([
      {
        toolCalls: [
          {
            name: SET_RICH_TEXT_TOOL_NAME,
            input: { slug: "pages", id: page.id, path: "layout.2.richText", markdown: "First paragraph, rewritten.\n\nSecond paragraph." },
          },
        ],
      },
      { text: "Done." },
    ]);
    const events = await readEvents(await call("POST", "/assistant/chat", { threadId, message: "Rewrite the first paragraph" }));
    const outcome = ofType(events, "RUN_FINISHED").at(-1)?.outcome;
    expect(outcome?.type).toBe("interrupt");
    expect(await readPage(page.id)).toMatchObject({ layout: [{}, {}, { richText: page.layout[2].richText }] });

    const res = await call("GET", `/assistant/approvals?threadId=${threadId}`);
    const [proposal] = ((await res.json()) as { approvals: ApprovalProposal[] }).approvals;
    expect(proposal).toMatchObject({
      toolName: SET_RICH_TEXT_TOOL_NAME,
      action: "update",
      target: { kind: "collection", slug: "pages", label: "Page" },
      draft: true,
      items: [
        {
          document: { id: String(page.id), title: "Home" },
          changes: [
            {
              path: "layout.2.richText",
              label: "Layout › 3 · Rich text › Rich Text",
              kind: "changed",
              format: "richText",
              before: "First paragraph.\n\nSecond paragraph.",
              after: "First paragraph, rewritten.\n\nSecond paragraph.",
            },
          ],
        },
      ],
    });
    expect(proposal!.notice).toBeUndefined();
    expect(JSON.stringify(proposal)).not.toContain('"root"');

    const interruptId = (outcome.interrupts as Array<{ id: string }>)[0]!.id;
    const resumed = await readEvents(
      await call("POST", "/assistant/chat", {
        threadId,
        resume: [{ interruptId, status: "resolved", payload: { approved: true, reviewToken: proposal!.reviewToken } }],
      })
    );
    expect(ofType(resumed, "RUN_ERROR")).toHaveLength(0);
    const written = await readPage(page.id);
    expect(written.layout[2].richText.root.children[0].children[0].text).toBe("First paragraph, rewritten.");
    expect(written.layout[2].id).toBe(page.layout[2].id);
  });

  it("names formatting the write would lose", async () => {
    const page = await newPage({ title: "U", hero: { richText: state(p(t("under", 8))) } });
    const threadId = `thread-${crypto.randomUUID()}`;
    script([{ toolCalls: [{ name: SET_RICH_TEXT_TOOL_NAME, input: { slug: "pages", id: page.id, path: "hero.richText", markdown: "under", allowFormattingLoss: true } }] }]);
    await readEvents(await call("POST", "/assistant/chat", { threadId, message: "Change it" }));
    const [proposal] = ((await (await call("GET", `/assistant/approvals?threadId=${threadId}`)).json()) as { approvals: ApprovalProposal[] }).approvals;
    expect(proposal!.notice).toBe("This field contains underline, which Markdown can't keep: approving removes it.");
    // Same text: no visible change, but the card still says what is lost.
    expect(proposal!.items[0]!.changes).toEqual([]);
  });
});

describe("system prompt", () => {
  it("points at the Markdown tool for the collections that have it, and at drafts", async () => {
    const req = ({ payload: app.payload, user: null, url: `${ORIGIN}/api/assistant/chat` } as unknown as PayloadRequest);
    const prompt = await buildSystemPrompt(req, normalizeOptions({ models: [{ id: "m", label: "M" }], apiKey: "k" }, app.config as never) as never);
    expect(prompt).toContain("Rich text (`pages`, `notes`):");
    expect(prompt).toContain(`call ${SET_RICH_TEXT_TOOL_NAME}`);
    expect(prompt).toContain("read with `draft: true`");
  });
});
