import { describe, expect, it } from "vitest";
import { SET_RICH_TEXT_TOOL_NAME } from "../src/richText/fields";
import { describeCall, jsonSpansIn, parseResult, resultText } from "../src/toolCalls";
import { fixtures, recorded } from "./fixtures/pluginMcp";

const describeRecorded = (label: string) => {
  const call = recorded(label);
  return describeCall(call.name, call.args);
};
const parseRecorded = (label: string) => parseResult(recorded(label).result);
const fence = (value: unknown) => "```json\n" + JSON.stringify(value) + "\n```";

describe("describeCall, on every recorded plugin-mcp call", () => {
  it("knows every tool, and its approval is the one plugin-mcp's annotations give", () => {
    for (const { name, args } of fixtures.calls) {
      const call = describeCall(name, args);
      expect(call.known, name).toBe(true);
      expect(call.needsApproval, name).toBe(fixtures.tools[name]?.needsApproval);
    }
    expect(describeCall(SET_RICH_TEXT_TOOL_NAME, {}).operation).toBe("update");
  });

  it("the operation, the target and whether it works on versions", () => {
    const rows = Object.fromEntries(
      fixtures.calls.map(({ name, args }) => {
        const call = describeCall(name, args);
        return [name, `${call.operation} ${call.target ? `${call.target.kind}:${call.target.slug}` : "-"}${call.versions ? " versions" : ""}`];
      })
    );
    expect(rows).toEqual({
      getConfigInfo: "read -",
      getCollectionSchema: "read collection:pages",
      findDocuments: "read collection:pages",
      countDocuments: "read collection:pages",
      findDistinct: "read collection:pages",
      createDocuments: "create collection:strict",
      updateDocument: "update collection:locked",
      setRichTextFromMarkdown: "update collection:pages",
      duplicateDocument: "duplicate collection:pages",
      findVersions: "read collection:pages versions",
      countVersions: "read collection:pages versions",
      findVersionByID: "read collection:pages versions",
      restoreVersion: "restore collection:pages versions",
      deleteDocuments: "delete collection:pages",
      findGlobal: "read global:settings",
      getGlobalSchema: "read global:settings",
      updateGlobal: "update global:settings",
      findGlobalVersions: "read global:settings versions",
      countGlobalVersions: "read global:settings versions",
      findGlobalVersionByID: "read global:settings versions",
      restoreGlobalVersion: "restore global:settings versions",
    });
  });

  it("the id, the locale and the queried paths", () => {
    expect(describeRecorded("update by id")).toMatchObject({ id: "1", locale: "en", queriedPaths: [] });
    expect(describeRecorded("update by where")).toMatchObject({ id: undefined, queriedPaths: ["title"] });
    expect(describeRecorded("find, a page").queriedPaths).toEqual(["title"]);
    expect(describeRecorded("distinct values").queriedPaths).toEqual(["title"]);
    expect(describeRecorded("find versions").queriedPaths).toEqual(["version.title", "updatedAt"]);
    expect(describeRecorded("restore a version")).toMatchObject({ id: "1", versions: true });
  });

  it("queried paths: where through and/or, sort as a string or a list, select's true leaves, findDistinct's field", () => {
    const call = describeCall("findDocuments", {
      slug: "pages",
      where: { or: [{ a: { equals: 1 } }, { AND: [{ "b.c": { exists: true } }] }] },
      sort: "-d, +e",
      select: { f: true, g: { h: true, i: false } },
      field: "j",
    });
    expect(call.queriedPaths).toEqual(["a", "b.c", "d", "e", "f", "g.h", "j"]);
    expect(describeCall("findDocuments", { slug: "pages", sort: ["k", "-l"] }).queriedPaths).toEqual(["k", "l"]);
  });

  it("reads arguments from an object or a JSON string; a partial one is no arguments", () => {
    expect(describeCall("findDocuments", '{"slug":"media","id":3}')).toMatchObject({ target: { kind: "collection", slug: "media" }, id: "3" });
    expect(describeCall("findDocuments", '{"slu')).toMatchObject({ target: undefined, args: {} });
    expect(describeCall("findDocuments", undefined).args).toEqual({});
  });

  it("the target is plugin-mcp's `slug` argument only", () => {
    expect(describeCall("findDocuments", { collection: "pages" }).target).toBeUndefined();
    expect(describeCall("findGlobal", { global: "header" }).target).toBeUndefined();
    expect(describeCall("findGlobal", { slug: "" }).target).toBeUndefined();
  });

  it("an unknown tool: other, on a collection, needs approval unless its definition says otherwise", () => {
    expect(describeCall("publishEverything", { slug: "pages", id: 1 })).toMatchObject({
      known: false,
      operation: "other",
      target: { kind: "collection", slug: "pages" },
      versions: false,
      needsApproval: true,
    });
    expect(describeCall("findSomething", {}, { needsApproval: false }).needsApproval).toBe(false);
    // Names never decide: a custom tool called like a global or a versions tool is neither.
    expect(describeCall("listGlobalVersions", { slug: "x" })).toMatchObject({ target: { kind: "collection" }, versions: false });
    expect(describeCall("toString", {}).known).toBe(false);
  });
});

describe("parseResult, on every recorded plugin-mcp result", () => {
  it("the documents and ids a write lists", () => {
    expect(parseRecorded("create two")).toMatchObject({ ids: ["3", "4"], nothingChanged: false, error: undefined });
    // The failed index is not a document, nor is the schema after it.
    expect(parseRecorded("create, one fails").ids).toEqual(["1"]);
    expect(parseRecorded("update by id").ids).toEqual(["1"]);
    expect(parseRecorded("update by where").ids).toEqual(["3", "2"]);
    expect(parseRecorded("duplicate").ids).toEqual(["5"]);
    expect(parseRecorded("restore a version").ids).toEqual(["1"]);
    expect(parseRecorded("delete by id").ids).toEqual(["2"]);
    // Whole documents: their populated relations (`createdBy`) are not documents of their own.
    expect(parseRecorded("delete by where").ids).toEqual(["5", "3"]);
    expect(parseRecorded("delete by where").documents[0]).toMatchObject({ id: 5, title: "Renamed" });
  });

  it("the documents a read lists", () => {
    // findDocuments writes each document of a page as its own block.
    expect(parseRecorded("find, a page").documents).toEqual([{ id: 2, title: "About" }, { id: 1, title: "Home" }]);
    expect(parseRecorded("find by id").ids).toEqual(["1"]);
    // The versions tools list versions: `id` is the version's.
    expect(parseRecorded("find versions").documents).toMatchObject([{ id: 1, parent: 1 }]);
    expect(parseRecorded("find a version").ids).toEqual(["1"]);
  });

  it("results without documents", () => {
    for (const label of ["config", "count", "distinct values", "rich text from Markdown", "global", "update global", "restore a global version", "count versions"]) {
      expect(parseRecorded(label), label).toMatchObject({ documents: [], ids: undefined, nothingChanged: false, error: undefined });
    }
  });

  it("a write that changed nothing", () => {
    expect(parseRecorded("update by where, none match")).toEqual({ documents: [], ids: [], nothingChanged: true, error: undefined });
    expect(parseResult(`Created 0 of 2 documents in collection "pages".`).nothingChanged).toBe(true);
    expect(parseResult(`Document deleted successfully from collection "pages"!\nDeleted: 0 documents\nErrors: 0\n---`).nothingChanged).toBe(true);
  });

  it("a tool error is chat()'s { error }", () => {
    expect(parseRecorded("update, refused").error).toMatch(/MCP access to "updateDocument" is not enabled for collection "locked"/);
    // plugin-mcp's error results: a create where every document failed.
    expect(parseRecorded("create, all fail")).toMatchObject({ documents: [], ids: undefined, error: expect.stringContaining("Created 0 of 1") });
  });

  it("documents listed under Errors: were not written (updateTool.ts and deleteTool.ts write that section)", () => {
    const text = `Multiple documents updated in collection "pages"!\nUpdated: 1 documents\nErrors: 1\n---\n\nUpdated documents:\n${fence([{ id: "a" }])}\n\nErrors:\n${fence([{ id: "b", message: "no" }])}\n\nUse this schema for data:\n${fence({ id: "schema" })}`;
    expect(parseResult(text).ids).toEqual(["a"]);
    expect(parseResult(`Multiple documents updated in collection "pages"!\nUpdated: 0 documents\nErrors: 1\n---\n\nErrors:\n${fence([{ id: "b", message: "no" }])}`).ids).toEqual([]);
  });

  it("the same result as content parts, as JSON, JSON encoded twice, or structured data", () => {
    const text = recorded("update by where").result as string;
    expect(parseResult([{ type: "text", content: text }]).ids).toEqual(["3", "2"]);
    expect(parseResult([{ type: "text", text }]).ids).toEqual(["3", "2"]);
    expect(parseResult('{"docs":[{"id":3}]}').ids).toEqual(["3"]);
    expect(parseResult(JSON.stringify(`Found 1 document.\n${fence({ docs: [{ id: 3 }] })}`)).ids).toEqual(["3"]);
    expect(parseResult({ docs: [{ doc: { id: 9 } }] }).ids).toEqual(["9"]);
    expect(parseResult(JSON.stringify(JSON.stringify({ error: "denied" }))).error).toBe("denied");
    expect(parseResult("No JSON here")).toEqual({ documents: [], ids: undefined, nothingChanged: false, error: undefined });
    expect(parseResult(undefined).ids).toBeUndefined();
  });
});

describe("text helpers", () => {
  it("resultText: a string, or text content parts joined", () => {
    expect(resultText("a")).toBe("a");
    expect(resultText([{ type: "text", content: "a" }, { type: "image" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(resultText([{ id: 1 }])).toBeUndefined();
    expect(resultText({ docs: [] })).toBeUndefined();
  });

  it("jsonSpansIn: every top-level JSON value, fenced or not, with where it is; broken JSON is skipped", () => {
    const text = 'a {"x":1} b ```json\n[1,{"y":"}"}]\n``` {broken [2]';
    const spans = jsonSpansIn(text);
    expect(spans.map((span) => span.value)).toEqual([{ x: 1 }, [1, { y: "}" }], [2]]);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('{"x":1}');
  });
});
