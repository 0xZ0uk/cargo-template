import type { FlattenedBlock, FlattenedField } from "payload";
import { describe, expect, it } from "vitest";

import { buildPromoteData, DEFAULT_PROMOTE_SKIP_FIELDS } from "../../src/utils/buildPromoteData";

const hero = {
  slug: "hero",
  fields: [],
  flattenedFields: [
    { name: "title", type: "text" },
    { name: "items", type: "array", fields: [], flattenedFields: [{ name: "label", type: "text" }] },
  ],
} as unknown as FlattenedBlock;

const fields = [
  { name: "title", type: "text" },
  { name: "slug", type: "text" },
  { name: "layout", type: "blocks", blocks: ["hero"] },
  {
    name: "meta",
    type: "group",
    fields: [],
    flattenedFields: [
      { name: "title", type: "text" },
      { name: "image", type: "upload", relationTo: "media" },
    ],
  },
  { name: "computed", type: "text", virtual: true },
  { name: "related", type: "join", collection: "posts", on: "page" },
  { name: "publishedAt", type: "date" },
  { name: "_status", type: "select" },
] as unknown as FlattenedField[];

const variant = {
  id: 7,
  title: "Winner",
  slug: "about--abc123",
  layout: [{ id: "row1", blockType: "hero", title: "Hi", items: [{ id: "item1", label: "One" }] }],
  meta: { title: "SEO", image: 12 },
  computed: "x",
  related: { docs: [] },
  _status: "published",
  createdAt: "2026-01-01",
};

describe("buildPromoteData", () => {
  const skip = [...DEFAULT_PROMOTE_SKIP_FIELDS, "slug"];

  it("copies data fields, uploads by id, and leaves out skipped, virtual and join fields", () => {
    const data = buildPromoteData(variant, fields, skip, { blocks: { hero } });
    expect(Object.keys(data).sort()).toEqual(["layout", "meta", "publishedAt", "title"]);
    expect(data.meta).toEqual({ title: "SEO", image: 12 });
    // A field the variant has no value for is cleared, not left as the original's.
    expect(data.publishedAt).toBeNull();
  });

  it("gives block and nested array rows new ids, the same ones for every locale", () => {
    const rowIds = new Map<string, string>();
    const en = buildPromoteData(variant, fields, skip, { blocks: { hero }, rowIds }) as any;
    const pt = buildPromoteData(variant, fields, skip, { blocks: { hero }, rowIds }) as any;
    expect(en.layout[0].id).toMatch(/^[0-9a-f]{24}$/);
    expect(en.layout[0].id).not.toBe("row1");
    expect(en.layout[0].items[0].id).not.toBe("item1");
    expect(pt.layout[0].id).toBe(en.layout[0].id);
    expect(pt.layout[0].items[0].id).toBe(en.layout[0].items[0].id);
    // The variant itself isn't modified.
    expect(variant.layout[0]!.id).toBe("row1");
  });

  it("takes dot-notation skip paths into groups", () => {
    const data = buildPromoteData(variant, fields, [...skip, "meta.image", "publishedAt"]);
    expect(data.meta).toEqual({ title: "SEO" });
    expect(data).not.toHaveProperty("publishedAt");
  });
});
