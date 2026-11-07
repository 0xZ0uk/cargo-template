import type { CollectionSlug, GlobalSlug, Payload, SanitizedConfig } from "payload";

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { mcpPlugin } from "@cargo/payload-plugin-mcp";
import { createMCPClient, type MCPClient } from "@tanstack/ai-mcp";
import { buildConfig, getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withMarkdownRichText } from "../../src/richText/tool";
import { inProcessDispatch } from "../../src/tools/inProcess";
import { AUTH_TOOL_NAMES, needsApproval, UNSUPPORTED_TOOL_NAMES } from "../../src/tools/payloadToolSource";
import { describeCall } from "../../src/toolCalls";
import { PLUGIN_MCP_FIXTURES, type ToolFixtures } from "../fixtures/pluginMcp";

/**
 * plugin-mcp's tool calls as they really are: every tool the assistant offers, called through
 * plugin-mcp's endpoint as a signed-in user, on real Payload 4 (SQLite). The calls and their
 * results are checked in as `tests/fixtures/plugin-mcp.json`, which `tests/toolCalls.test.ts`
 * runs `describeCall` / `parseResult` against.
 *
 * Re-record after a plugin-mcp bump: `RECORD_PLUGIN_MCP_FIXTURES=1 pnpm vitest run tests/integration/toolFixtures.test.ts`.
 * Without the variable this test only checks that `describeCall` knows every tool plugin-mcp
 * lists, with the approval rule its annotations give.
 */
const KEY = "assistant-tool-fixtures";
const ORIGIN = "http://localhost:3000";
const FIXTURES = fileURLToPath(PLUGIN_MCP_FIXTURES);
const RECORD = process.env.RECORD_PLUGIN_MCP_FIXTURES === "1";
const DROPPED = new Set<string>([...AUTH_TOOL_NAMES, ...UNSUPPORTED_TOOL_NAMES]);

/** The approval rule `createPayloadToolSource` applies, from the tool's MCP annotations. */
const approvalOf = (tool: { metadata?: unknown }) =>
  needsApproval({ annotations: (tool.metadata as { mcp?: { annotations?: { readOnlyHint?: boolean } } } | undefined)?.mcp?.annotations });

let payload: Payload;
let config: SanitizedConfig;
let client: MCPClient;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "assistant-tool-fixtures-"));
  config = await buildConfig({
    secret: "test-secret",
    db: sqliteAdapter({ client: { url: `file:${join(tmpDir, "fixtures.db")}` }, push: true }),
    admin: { user: "users" },
    editor: lexicalEditor(),
    collections: [
      { slug: "users", auth: true, fields: [] },
      {
        slug: "pages",
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: "richText" },
        ],
      },
      { slug: "strict", fields: [{ name: "title", type: "text", required: true }] },
      {
        slug: "locked",
        access: { read: () => true, create: () => false, update: () => false, delete: () => false },
        fields: [{ name: "title", type: "text" }],
      },
    ],
    globals: [{ slug: "settings", versions: { drafts: true }, fields: [{ name: "siteName", type: "text" }] }],
    plugins: [
      mcpPlugin({
        collections: { pages: withMarkdownRichText("pages"), strict: {}, locked: {} },
        globals: { settings: {} },
      }),
    ],
  });
  payload = await getPayload({ config, key: KEY });
  await payload.create({
    collection: "users" as CollectionSlug,
    data: { email: "editor@example.com", password: "test-password" } as never,
    overrideAccess: true,
  });
  const { token } = await payload.login({ collection: "users" as never, data: { email: "editor@example.com", password: "test-password" } });
  const dispatch = inProcessDispatch(config, { payloadInstanceCacheKey: KEY });
  client = await createMCPClient({
    transport: {
      type: "http",
      url: `${ORIGIN}/api/mcp`,
      headers: { cookie: `payload-token=${token}`, origin: ORIGIN },
      fetch: (input, init) => dispatch(new Request(input, init)),
    },
  });
}, 120_000);

afterAll(async () => {
  await client?.close();
  await (payload as unknown as { destroy?: () => Promise<void> })?.destroy?.();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Dates and ids vary per run: fixed values keep the fixture stable across re-recordings. */
const stable = (text: string) =>
  text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "2026-01-01T00:00:00.000Z")
    .replace(/"(_verificationToken|sessionId)":"[^"]*"/g, '"$1":"x"');

describe("plugin-mcp's tools", () => {
  it("describeCall knows every tool the assistant offers, with the approval its annotations give", async () => {
    const tools = (await client.tools()).filter((tool) => !DROPPED.has(tool.name));
    expect(tools.length).toBeGreaterThan(15);
    for (const tool of tools) {
      const call = describeCall(tool.name, { slug: "pages" });
      expect(call.known, tool.name).toBe(true);
      expect(call.needsApproval, tool.name).toBe(approvalOf(tool));
    }
    if (!RECORD) {
      const recorded = JSON.parse(readFileSync(FIXTURES, "utf8")) as ToolFixtures;
      expect(Object.keys(recorded.tools).sort()).toEqual(tools.map((tool) => tool.name).sort());
    }
  });

  it.runIf(RECORD)("records every tool's calls and results", async () => {
    const byName = new Map((await client.tools()).map((tool) => [tool.name, tool]));
    const calls: ToolFixtures["calls"] = [];
    const call = async (label: string, name: string, args: Record<string, unknown>) => {
      const tool = byName.get(name);
      if (!tool?.execute) throw new Error(`plugin-mcp lists no ${name}`);
      let result: unknown;
      try {
        result = await tool.execute(args, undefined as never);
      } catch (error) {
        // What chat() hands the model, the middleware and the stream for a tool that throws.
        result = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      const recorded = JSON.parse(stable(JSON.stringify(result))) as unknown;
      calls.push({ label, name, args, result: recorded });
      return result;
    };
    const create = (collection: string, data: Record<string, unknown>) =>
      payload.create({ collection: collection as CollectionSlug, data: data as never, overrideAccess: true });

    const home = await create("pages", { title: "Home" });
    const about = await create("pages", { title: "About" });
    const locked = await create("locked", { title: "Untouchable" });

    await call("config", "getConfigInfo", {});
    await call("collection schema", "getCollectionSchema", { slug: "pages" });
    await call("find, a page", "findDocuments", { slug: "pages", select: { title: true }, limit: 5, depth: 0 });
    await call("find by id", "findDocuments", { slug: "pages", id: String(home.id), depth: 0 });
    await call("count", "countDocuments", { slug: "pages", where: { title: { like: "o" } } });
    await call("distinct values", "findDistinct", { slug: "pages", field: "title" });

    await call("create two", "createDocuments", { slug: "pages", draft: true, documents: [{ data: { title: "Pricing" } }, { data: { title: "Team" } }] });
    await call("create, one fails", "createDocuments", { slug: "strict", documents: [{ data: { title: "Fine" } }, { data: {} }] });
    await call("create, all fail", "createDocuments", { slug: "strict", documents: [{ data: {} }] });

    await call("update by id", "updateDocument", { slug: "pages", id: String(home.id), data: { title: "Home page" }, locale: "en" });
    await call("update by where", "updateDocument", { slug: "pages", where: { title: { in: ["About", "Pricing"] } }, data: { title: "Renamed" } });
    await call("update by where, none match", "updateDocument", { slug: "pages", where: { title: { equals: "Nothing" } }, data: { title: "x" } });
    await call("update, refused", "updateDocument", { slug: "locked", id: String(locked.id), data: { title: "Changed" } });
    await call("rich text from Markdown", "setRichTextFromMarkdown", { slug: "pages", id: String(home.id), path: "body", markdown: "Hello **world**" });

    await call("duplicate", "duplicateDocument", { slug: "pages", id: String(about.id) });

    const versions = await payload.findVersions({ collection: "pages" as CollectionSlug, where: { parent: { equals: home.id } }, sort: "createdAt", limit: 1, overrideAccess: true });
    const versionId = String(versions.docs[0]!.id);
    await call("find versions", "findVersions", { slug: "pages", where: { "version.title": { equals: "Home" } }, sort: "-updatedAt", limit: 2 });
    await call("count versions", "countVersions", { slug: "pages", where: { parent: { equals: home.id } } });
    await call("find a version", "findVersionByID", { slug: "pages", id: versionId });
    await call("restore a version", "restoreVersion", { slug: "pages", id: versionId });

    await call("delete by id", "deleteDocuments", { slug: "pages", id: String(about.id) });
    await call("delete by where", "deleteDocuments", { slug: "pages", where: { title: { equals: "Renamed" } } });

    await call("global", "findGlobal", { slug: "settings" });
    await call("global schema", "getGlobalSchema", { slug: "settings" });
    await call("update global", "updateGlobal", { slug: "settings", data: { siteName: "Cargo" }, draft: true });
    await payload.updateGlobal({ slug: "settings" as GlobalSlug, data: { siteName: "Cargo 2" } as never, overrideAccess: true });
    const globalVersions = await payload.findGlobalVersions({ slug: "settings" as GlobalSlug, sort: "createdAt", limit: 1, overrideAccess: true });
    const globalVersionId = String(globalVersions.docs[0]!.id);
    await call("global versions", "findGlobalVersions", { slug: "settings", where: { "version.siteName": { exists: true } }, limit: 2 });
    await call("count global versions", "countGlobalVersions", { slug: "settings" });
    await call("a global version", "findGlobalVersionByID", { slug: "settings", id: globalVersionId });
    await call("restore a global version", "restoreGlobalVersion", { slug: "settings", id: globalVersionId });

    const offered = [...byName.values()].filter((tool) => !DROPPED.has(tool.name));
    const fixtures: ToolFixtures = {
      recordedWith: `@cargo/payload-plugin-mcp ${(JSON.parse(readFileSync(fileURLToPath(new URL("../../../payload-plugin-mcp/package.json", import.meta.url)), "utf8")) as { version: string }).version}`,
      tools: Object.fromEntries(offered.map((tool) => [tool.name, { needsApproval: approvalOf(tool) }]).sort(([a], [b]) => String(a).localeCompare(String(b)))),
      calls,
    };
    expect(new Set(calls.map((c) => c.name))).toEqual(new Set(offered.map((tool) => tool.name)));
    writeFileSync(FIXTURES, `${JSON.stringify(fixtures, null, 2)}\n`);
  });
});
