import { describe, expect, it } from "vitest";
import { diffDocument, displayValue, humanize, MAX_CHANGES, MAX_VALUE_CHARS, type FieldLike } from "../../src/approvals/diff";
import { isLexicalState, lexicalToText } from "../../src/approvals/lexical";

/** A Lexical editor state from paragraphs and other top-level nodes. */
const text = (value: string) => ({ type: "text", text: value, format: 0, version: 1 });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children, version: 1 });
const lexical = (...children: unknown[]) => ({ root: { type: "root", children, version: 1 } });

const FIELDS: FieldLike[] = [
  { type: "text", name: "title", label: "Title" },
  { type: "text", name: "slug" },
  { type: "richText", name: "content", label: "Content" },
  {
    type: "tabs",
    tabs: [
      { label: "Hero", fields: [{ type: "text", name: "heroHeading", label: { en: "Hero heading", pt: "Título" } }] },
      { name: "meta", label: "SEO", fields: [{ type: "text", name: "title", label: "Meta title" }, { type: "textarea", name: "description" }] },
    ],
  },
  { type: "row", fields: [{ type: "select", name: "theme", options: [{ label: "Dark mode", value: "dark" }, "light"] }] },
  { type: "checkbox", name: "featured" },
  { type: "relationship", name: "author", relationTo: "users" },
  { type: "upload", name: "image", relationTo: "media" },
  {
    type: "blocks",
    name: "layout",
    blocks: [
      { slug: "hero", labels: { singular: "Hero" }, fields: [{ type: "text", name: "heading" }, { type: "richText", name: "body" }] },
      "faq",
    ],
  },
  { type: "array", name: "links", fields: [{ type: "text", name: "label" }, { type: "text", name: "url" }] },
  { type: "json", name: "settings" },
];
const BLOCKS = new Map([["faq", { slug: "faq", labels: { singular: "FAQ" }, fields: [{ type: "text", name: "question" }] }]]);

const allText = (value: unknown) => JSON.stringify(value);

describe("lexicalToText", () => {
  it("reads paragraphs, headings, lists, quotes, links and line breaks as text with light Markdown", () => {
    const state = lexical(
      { type: "heading", tag: "h2", children: [text("Our story")] },
      paragraph(text("Made by "), { type: "link", fields: { url: "https://x" }, children: [text("hand")] }, text("."), { type: "linebreak" }, text("Since 1990.")),
      { type: "list", listType: "bullet", children: [{ type: "listitem", children: [text("Oak")] }, { type: "listitem", children: [text("Pine"), { type: "list", listType: "number", children: [{ type: "listitem", children: [text("Knotty")] }] }] }] },
      { type: "list", listType: "check", children: [{ type: "listitem", checked: true, children: [text("Done")] }] },
      { type: "quote", children: [text("Lovely chairs")] },
      { type: "horizontalrule" },
      { type: "upload", relationTo: "media", value: 4 },
      { type: "block", fields: { blockType: "cta", blockName: "Footer CTA" } },
      paragraph()
    );
    expect(lexicalToText(state)).toBe(
      [
        "## Our story",
        "Made by hand.\nSince 1990.",
        "- Oak\n- Pine\n  1. Knotty",
        "- [x] Done",
        "> Lovely chairs",
        "---",
        "[media: 4]",
        '[cta block "Footer CTA"]',
      ].join("\n\n")
    );
  });

  it("is empty for an empty editor and for anything that isn't a Lexical state", () => {
    expect(lexicalToText(lexical(paragraph()))).toBe("");
    expect(lexicalToText({ root: { type: "nope" } })).toBe("");
    expect(lexicalToText("text")).toBe("");
    expect(isLexicalState(lexical())).toBe(true);
    expect(isLexicalState({ root: {} })).toBe(false);
  });
});

describe("diffDocument", () => {
  const current = {
    id: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    _status: "draft",
    title: "Home",
    slug: "home",
    content: lexical(paragraph(text("Old intro."))),
    heroHeading: "Hello",
    meta: { title: "Home | Shop", description: "Old description" },
    theme: "light",
    featured: false,
    author: 3,
    image: { id: 9, filename: "chair.jpg" },
    layout: [
      { id: "a", blockType: "hero", heading: "Welcome", body: lexical(paragraph(text("Hi"))) },
      { id: "b", blockType: "faq", question: "Why oak?" },
    ],
    links: [{ id: "l1", label: "Shop", url: "/shop" }],
  };

  it("update: only the fields the data sets, field by field, before and after", () => {
    const { changes, omitted } = diffDocument({
      mode: "update",
      fields: FIELDS,
      blocks: BLOCKS,
      before: current,
      after: { title: "Welcome", slug: "home", meta: { description: "New description" }, theme: "dark", featured: true },
    });
    expect(omitted).toBe(0);
    expect(changes).toEqual([
      { path: "title", label: "Title", kind: "changed", format: "text", before: "Home", after: "Welcome" },
      { path: "meta.description", label: "SEO › Description", kind: "changed", format: "text", before: "Old description", after: "New description" },
      { path: "theme", label: "Theme", kind: "changed", format: "text", before: "light", after: "Dark mode" },
      { path: "featured", label: "Featured", kind: "changed", format: "text", before: "No", after: "Yes" },
    ]);
  });

  it("update: rich text is compared and shown as readable text, never Lexical JSON", () => {
    const { changes } = diffDocument({
      mode: "update",
      fields: FIELDS,
      before: current,
      after: { content: lexical({ type: "heading", tag: "h1", children: [text("New")] }, paragraph(text("New intro."))) },
    });
    expect(changes).toEqual([
      { path: "content", label: "Content", kind: "changed", format: "richText", before: "Old intro.", after: "# New\n\nNew intro." },
    ]);
    expect(allText(changes)).not.toMatch(/"root"|"children"|"type":"paragraph"/);
  });

  it("update: rich text without a field config (an unknown field) is still text", () => {
    const { changes } = diffDocument({ mode: "update", before: {}, after: { notes: lexical(paragraph(text("Remember"))) } });
    expect(changes).toEqual([{ path: "notes", label: "Notes", kind: "added", format: "richText", after: "Remember" }]);
  });

  it("update: blocks and arrays row by row, paired by id, with block labels; removed rows show what goes", () => {
    const { changes } = diffDocument({
      mode: "update",
      fields: FIELDS,
      blocks: BLOCKS,
      before: current,
      after: {
        layout: [
          { id: "a", blockType: "hero", heading: "Welcome!", body: lexical(paragraph(text("Hi"))) },
          { blockType: "faq", question: "Why pine?" },
        ],
        links: [],
      },
    });
    expect(changes).toEqual([
      { path: "layout.0.heading", label: "Layout › 1 · Hero › Heading", kind: "changed", format: "text", before: "Welcome", after: "Welcome!" },
      // No id: paired with the row at the same position.
      { path: "layout.1.question", label: "Layout › 2 · FAQ › Question", kind: "changed", format: "text", before: "Why oak?", after: "Why pine?" },
      { path: "links.0.label", label: "Links › 1 › Label", kind: "removed", format: "text", before: "Shop" },
      { path: "links.0.url", label: "Links › 1 › Url", kind: "removed", format: "text", before: "/shop" },
    ]);
  });

  describe("array rows", () => {
    const ITEMS: FieldLike[] = [{ type: "array", name: "items", fields: [{ type: "text", name: "title" }] }];
    const diffItems = (before: unknown[], after: unknown[]) =>
      diffDocument({ mode: "update", fields: ITEMS, before: { items: before }, after: { items: after } }).changes;
    const paths = (changes: Array<{ path: string }>) => changes.map((c) => c.path);
    const row = (id: string | undefined, title: string) => (id === undefined ? { title } : { id, title });

    it("a removed row never collides with a kept row (before [a, b], after [b'])", () => {
      const changes = diffItems([row("a", "x"), row("b", "y")], [row("b", "y2")]);
      expect(changes).toEqual([
        { path: "items.0.title", label: "Items › 1 › Title", kind: "changed", format: "text", before: "y", after: "y2" },
        { path: "items.removed-0.title", label: "Items › 1 (removed) › Title", kind: "removed", format: "text", before: "x" },
      ]);
      expect(new Set(paths(changes)).size).toBe(changes.length);
    });

    it("removing the first of two rows is a removal, not a move of the kept row", () => {
      const changes = diffItems([row("a", "x"), row("b", "y")], [row("b", "y")]);
      expect(changes).toEqual([{ path: "items.removed-0.title", label: "Items › 1 (removed) › Title", kind: "removed", format: "text", before: "x" }]);
    });

    it("a reorder of rows with ids is visible (it was an empty diff)", () => {
      const changes = diffItems([row("a", "x"), row("b", "y")], [row("b", "y"), row("a", "x")]);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ kind: "changed", format: "text" });
      expect(changes[0]!.label).toMatch(/Position$/);
      expect(Number(changes[0]!.before)).not.toBe(Number(changes[0]!.after));
    });

    it("moving one block to the end reports that block only, with its before and after positions", () => {
      const changes = diffItems([row("a", "A"), row("b", "B"), row("c", "C")], [row("b", "B"), row("c", "C"), row("a", "A")]);
      expect(changes).toEqual([{ path: "items.2:moved", label: "Items › 3 › Position", kind: "changed", format: "text", before: "1", after: "3" }]);
    });

    it("inserting in the middle is one added row; the rows after it are not changes", () => {
      const changes = diffItems([row("a", "A"), row("c", "C")], [row("a", "A"), { title: "New" }, row("c", "C")]);
      expect(changes).toEqual([{ path: "items.1.title", label: "Items › 2 › Title", kind: "added", format: "text", after: "New" }]);
    });

    it("a row with an id that is edited and moved shows the edit under its new position, and the move", () => {
      const changes = diffItems([row("a", "A"), row("b", "B")], [row("b", "B2"), row("a", "A")]);
      expect(new Set(paths(changes)).size).toBe(changes.length);
      expect(changes.some((c) => c.path === "items.0.title" && c.before === "B" && c.after === "B2")).toBe(true);
      expect(changes.filter((c) => c.path.endsWith(":moved"))).toHaveLength(1);
    });

    it("an added row with no visible values and a removed one are still reported", () => {
      expect(diffItems([row("a", "A")], [row("a", "A"), {}])).toEqual([
        { path: "items.1", label: "Items › 2", kind: "added", format: "text", after: "Empty row" },
      ]);
      expect(diffItems([row("a", "A"), { id: "e" }], [row("a", "A")])).toEqual([
        { path: "items.removed-1", label: "Items › 2 (removed)", kind: "removed", format: "text", before: "Empty row" },
      ]);
    });

    it("rows without ids are paired by position; extra rows are added or removed at the end", () => {
      expect(diffItems([row(undefined, "A"), row(undefined, "B")], [row(undefined, "A"), row(undefined, "B2"), row(undefined, "C")])).toEqual([
        { path: "items.1.title", label: "Items › 2 › Title", kind: "changed", format: "text", before: "B", after: "B2" },
        { path: "items.2.title", label: "Items › 3 › Title", kind: "added", format: "text", after: "C" },
      ]);
      const removed = diffItems([row(undefined, "A"), row(undefined, "B")], [row(undefined, "A")]);
      expect(removed).toEqual([{ path: "items.removed-1.title", label: "Items › 2 (removed) › Title", kind: "removed", format: "text", before: "B" }]);
    });

    it("an id-less new row is not paired with a row that an id claims", () => {
      // `a` is kept (claimed by id) at index 1; the new id-less row at index 0 must not steal `a`.
      const changes = diffItems([row("a", "A")], [{ title: "New" }, row("a", "A")]);
      expect(changes).toEqual([{ path: "items.0.title", label: "Items › 1 › Title", kind: "added", format: "text", after: "New" }]);
    });

    it("blocks: the same rules, with block labels, for a reordered layout", () => {
      const changes = diffDocument({
        mode: "update",
        fields: FIELDS,
        blocks: BLOCKS,
        before: current,
        after: { layout: [current.layout[1], current.layout[0]] },
      }).changes;
      expect(changes).toHaveLength(1);
      expect(changes[0]!.label).toMatch(/^Layout › \d · (Hero|FAQ) › Position$/);
    });
  });

  it("update: relationships, uploads and JSON are readable; an unchanged value is not listed", () => {
    const { changes } = diffDocument({
      mode: "update",
      fields: FIELDS,
      before: current,
      after: { author: 4, image: 9, settings: { a: 1 }, heroHeading: "Hello" },
    });
    expect(changes).toEqual([
      { path: "author", label: "Author", kind: "changed", format: "text", before: "3", after: "4" },
      { path: "image", label: "Image", kind: "changed", format: "text", before: "chair.jpg", after: "9" },
      { path: "settings", label: "Settings", kind: "added", format: "json", after: '{\n  "a": 1\n}' },
    ]);
  });

  it("create: every proposed value, as added", () => {
    const { changes } = diffDocument({
      mode: "create",
      fields: FIELDS,
      blocks: BLOCKS,
      after: { title: "About", content: lexical(paragraph(text("We make chairs."))), layout: [{ blockType: "faq", question: "Q?" }], empty: "" },
    });
    expect(changes).toEqual([
      { path: "title", label: "Title", kind: "added", format: "text", after: "About" },
      { path: "content", label: "Content", kind: "added", format: "richText", after: "We make chairs." },
      { path: "layout.0.question", label: "Layout › 1 · FAQ › Question", kind: "added", format: "text", after: "Q?" },
    ]);
  });

  it("delete: what will be lost, without system fields or the status", () => {
    const { changes } = diffDocument({ mode: "delete", fields: FIELDS, blocks: BLOCKS, before: current });
    const paths = changes.map((c) => c.path);
    expect(paths).toEqual(
      expect.arrayContaining(["title", "slug", "content", "heroHeading", "meta.title", "layout.0.heading", "layout.0.body", "layout.1.question", "links.0.url"])
    );
    expect(paths).not.toEqual(expect.arrayContaining(["id"]));
    expect(paths.some((p) => /createdAt|updatedAt|_status|blockType|\.id$/.test(p))).toBe(false);
    expect(changes.every((c) => c.kind === "removed" && c.after === undefined)).toBe(true);
    expect(changes.find((c) => c.path === "content")).toMatchObject({ format: "richText", before: "Old intro." });
    expect(allText(changes)).not.toContain('"root"');
  });

  it("replace (restore a version): the union of both sides", () => {
    const { changes } = diffDocument({
      mode: "replace",
      fields: FIELDS,
      before: { title: "Now", slug: "home", updatedAt: "x" },
      after: { title: "Then", slug: "home", heroHeading: "Old hero", updatedAt: "y" },
    });
    expect(changes).toEqual([
      { path: "title", label: "Title", kind: "changed", format: "text", before: "Now", after: "Then" },
      { path: "heroHeading", label: "Hero heading", kind: "added", format: "text", after: "Old hero" },
    ]);
  });

  it("cuts very long values and says so, and caps the number of changes", () => {
    const long = "x".repeat(MAX_VALUE_CHARS + 50);
    const [change] = diffDocument({ mode: "create", after: { body: long } }).changes;
    expect(change!.truncated).toBe(true);
    expect(change!.after!.length).toBe(MAX_VALUE_CHARS + 1);

    const many = Object.fromEntries(Array.from({ length: MAX_CHANGES + 5 }, (_, i) => [`f${i}`, "v"]));
    const result = diffDocument({ mode: "create", after: many });
    expect(result.changes).toHaveLength(MAX_CHANGES);
    expect(result.omitted).toBe(5);
  });
});

describe("helpers", () => {
  it("humanizes field names", () => {
    expect(humanize("metaTitle")).toBe("Meta title");
    expect(humanize("hero_image")).toBe("Hero image");
    expect(humanize("_status")).toBe("Status");
  });

  it("treats empty values as no value", () => {
    expect(displayValue("")).toBeUndefined();
    expect(displayValue([])).toBeUndefined();
    expect(displayValue({})).toBeUndefined();
    expect(displayValue(null)).toBeUndefined();
    expect(displayValue(lexical(paragraph()))).toBeUndefined();
    expect(displayValue(0)).toEqual({ text: "0", format: "text" });
  });
});
