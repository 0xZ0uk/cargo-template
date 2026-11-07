import { defineCollectionTool, type MCPPluginConfig } from "@shipment/payload-plugin-mcp";
import { parseDocumentID, type CollectionSlug, type PayloadRequest } from "payload";
import {
  blocksBySlugOf,
  collectionOf,
  fieldsOf,
  hasDrafts,
  internalLinkTargets,
  internalLinkUrl,
  markdownLosses,
  resolveRichText,
  richTextCollections,
  richTextToMarkdownDeep,
  rootConverters,
  RichTextPathError,
  setAtPath,
  toMarkdown,
  unsupportedMarkdown,
  SET_RICH_TEXT_TOOL_NAME,
} from "./fields";

/**
 * Rich text as Markdown for plugin-mcp (#67): the write tool and the read conversion. Both are
 * plugin-mcp items, so the assistant and any external MCP client get the same tool layer (#58).
 *
 * ```ts
 * mcpPlugin({ collections: { pages: withMarkdownRichText('pages', { description: '…' }) } })
 * ```
 */

export { SET_RICH_TEXT_TOOL_NAME };

type MCPResponseOverride = NonNullable<NonNullable<MCPPluginConfig["collections"]>[string]>["overrideResponse"] & {};
type MCPToolResponse = Parameters<MCPResponseOverride>[0];
type CollectionToolsMap = NonNullable<NonNullable<MCPPluginConfig["collections"]>[string]>["tools"] & {};

const FIDELITY =
  "Markdown keeps paragraphs, headings, bold, italic, links to URLs, internal links to documents (written `[text](payload://<collection>/<id>)`, e.g. `payload://pages/12`) and, where the field's editor has them, lists, quotes and strikethrough/inline code. " +
  "It cannot keep underline, sub/superscript, text alignment, indentation, links set to open in a new tab, or upload/relationship/block nodes.";

const DESCRIPTION = [
  "Replace one rich text field of a document with Markdown. Use this, never updateDocument, for any rich text field: updateDocument would need Lexical JSON.",
  "`path` is the field's data path from the document as findDocuments returns it: field names and row numbers from 0, e.g. `caption`, `layout.2.richText` or `layout.3.columns.0.content.1.richText`.",
  "`markdown` is the whole new value of that field (read it first: findDocuments shows rich text as Markdown). Saved as a draft unless `draft: false` (only when the editor asked to publish).",
  `${FIDELITY} If the field holds any of those, the tool refuses and says what would be lost: tell the editor, and only with their agreement call again with \`allowFormattingLoss: true\`.`,
  "The editor approves the change before it is written.",
].join(" ");

const INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["id", "path", "markdown"],
  properties: {
    id: { type: ["string", "number"], description: "The document's id." },
    path: { type: "string", description: "Data path of the rich text field, e.g. `layout.2.richText`." },
    markdown: { type: "string", description: "The field's whole new content, as Markdown." },
    draft: { type: "boolean", description: "Save as a draft (default true). `false` publishes the document." },
    locale: { type: "string", description: "Locale to write, for localized fields." },
    allowFormattingLoss: {
      type: "boolean",
      description: "Write even though the field holds formatting Markdown can't keep (see the description). Only after the editor agreed.",
    },
  },
} as const;

interface SetRichTextInput {
  id: string | number;
  path: string;
  markdown: string;
  draft?: boolean;
  locale?: string;
  allowFormattingLoss?: boolean;
}

const text = (value: string, isError = false): MCPToolResponse => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

/** Whitespace-insensitive comparison of two Markdown texts (line ends, blank lines, emphasis marker). */
export const sameMarkdown = (a: string, b: string): boolean => {
  const norm = (s: string) =>
    s
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd().replace(/^(\s*)[*+] /, "$1- "))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\*\*(.+?)\*\*/g, "__$1__")
      .replace(/(?<![*\w])\*(?!\s)(.+?)\*(?![*\w])/g, "_$1_")
      .trim();
  return norm(a) === norm(b);
};

/** The document a rich text write targets, read as the user (drafts included). */
export async function readTargetDocument(
  req: PayloadRequest,
  slug: string,
  input: { id: unknown; locale?: unknown },
  overrideAccess: boolean
): Promise<Record<string, unknown> | null> {
  const collection = collectionOf(req, slug);
  if (!collection) return null;
  const id = typeof input.id === "string" || typeof input.id === "number" ? input.id : undefined;
  if (id === undefined || id === "") return null;
  try {
    const doc = await req.payload.findByID({
      collection: slug as CollectionSlug,
      id: parseDocumentID({ id, collectionSlug: slug as CollectionSlug, payload: req.payload }),
      depth: 0,
      draft: hasDrafts(collection),
      overrideAccess,
      req,
      disableErrors: true,
      ...(typeof input.locale === "string" && input.locale ? { locale: input.locale } : {}),
    } as Parameters<typeof req.payload.findByID>[0]);
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Internal links in a converted state whose document doesn't exist, or the user can't read, as
 * `payload://<collection>/<id>`: a link Lexical would store pointing nowhere.
 */
async function brokenInternalLinks(req: PayloadRequest, state: unknown, overrideAccess: boolean): Promise<string[]> {
  const broken: string[] = [];
  for (const target of internalLinkTargets(state)) {
    const url = internalLinkUrl(target.relationTo, target.id);
    const collection = collectionOf(req, target.relationTo);
    if (!collection) {
      broken.push(`${url} (no collection "${target.relationTo}")`);
      continue;
    }
    try {
      const found = await req.payload.findByID({
        collection: target.relationTo as CollectionSlug,
        id: parseDocumentID({ id: target.id, collectionSlug: target.relationTo as CollectionSlug, payload: req.payload }),
        depth: 0,
        draft: hasDrafts(collection),
        overrideAccess,
        req,
        disableErrors: true,
        select: {},
      } as Parameters<typeof req.payload.findByID>[0]);
      if (!found) broken.push(url);
    } catch {
      broken.push(url);
    }
  }
  return broken;
}

/**
 * `setRichTextFromMarkdown`: convert Markdown with the field's own editor and write it as the
 * user. Updates the path's top-level field with the document's current value (ids intact), so
 * block and array rows keep their ids and siblings. Never returns Lexical JSON.
 */
export const setRichTextFromMarkdownTool = defineCollectionTool({
  access: ({ req, permissions, slug }) => Boolean(req.user) && Boolean(permissions?.collections?.[slug]?.update),
  annotations: {
    title: "Set rich text from Markdown",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: DESCRIPTION,
  input: INPUT as unknown as Record<string, unknown>,
}).handler(async ({ slug, input: raw, req, authorizedMCP }) => {
  const input = raw as unknown as SetRichTextInput;
  const collection = collectionOf(req, slug);
  if (!collection) {
    const slugs = richTextCollections(req);
    return text(`Error: "${slug}" is not a collection. Collections with rich text: ${slugs.join(", ") || "none"}.`, true);
  }
  if (typeof input.markdown !== "string") return text('Error: "markdown" must be a string (the field\'s whole new content).', true);
  try {
    const doc = await readTargetDocument(req, slug, input, authorizedMCP.overrideAccess);
    if (!doc) return text(`Error: document "${String(input.id)}" not found in "${slug}", or you can't read it.`, true);
    const blocks = blocksBySlugOf(req);
    const location = resolveRichText(collection, doc, input.path, blocks);

    const losses = markdownLosses(location.value);
    if (losses.length && input.allowFormattingLoss !== true) {
      return text(
        `Not written: "${location.path}" contains ${losses.join(", ")}, which Markdown can't keep; rewriting it would remove ${losses.length === 1 ? "it" : "them"}. ` +
          "Tell the editor what would be lost and, only if they agree, call again with allowFormattingLoss: true.",
        true
      );
    }

    const state = location.converters.fromMarkdown({ markdown: input.markdown });
    const broken = await brokenInternalLinks(req, state, authorizedMCP.overrideAccess);
    if (broken.length) {
      return text(
        `Not written: ${broken.length === 1 ? "this internal link points" : "these internal links point"} to no document you can read: ${broken.join(", ")}. ` +
          "Write internal links as [text](payload://<collection>/<id>) with the id of an existing document (find it with findDocuments).",
        true
      );
    }
    const next = structuredClone(doc);
    setAtPath(next, location.path, state);
    const top = location.path.split(".")[0]!;
    const drafts = hasDrafts(collection);
    const asDraft = drafts && input.draft !== false;
    const data: Record<string, unknown> = { [top]: next[top] };
    if (drafts && !asDraft) data._status = "published";

    await req.payload.update({
      collection: slug as CollectionSlug,
      id: doc.id as string | number,
      data,
      depth: 0,
      draft: asDraft,
      overrideAccess: authorizedMCP.overrideAccess,
      req,
      ...(input.locale ? { locale: input.locale } : {}),
    } as Parameters<typeof req.payload.update>[0]);

    const stored = toMarkdown(location.converters, state);
    const how = drafts ? (asDraft ? "saved as a draft" : "published") : "saved";
    const unsupported = unsupportedMarkdown(state);
    const note = unsupported.length
      ? `\nThis field's editor doesn't support ${unsupported.join(", ")}: that Markdown was kept as plain text. It now holds:\n${stored}`
      : "";
    return {
      content: [{ type: "text", text: `Updated "${location.path}" of ${slug} ${String(doc.id)} (${how}).${note}` }],
      doc: { id: doc.id, path: location.path, markdown: stored },
    };
  } catch (error) {
    if (error instanceof RichTextPathError) return text(`Error: ${error.message}`, true);
    return text(`Error: could not update "${String(input.path)}" of ${slug} ${String(input.id)}: ${error instanceof Error ? error.message : String(error)}`, true);
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const READ_NOTE = `Rich text fields are shown as Markdown; change them with ${SET_RICH_TEXT_TOOL_NAME}.`;

/**
 * `overrideResponse` for `findDocuments` on one collection: every rich text value in the result
 * becomes Markdown (the field's own converters), and the response text is rebuilt from the
 * converted documents in plugin-mcp's format (it prints the documents itself, so changing `doc`
 * alone would leave the JSON). Errors and unknown response shapes pass through unchanged.
 *
 * This changes the output for external MCP clients too, on purpose: one tool layer (#58).
 */
export function richTextAsMarkdown(slug: string): MCPResponseOverride {
  return (response, doc, req) => {
    if (response.isError || !isRecord(doc)) return response;
    const first = response.content?.[0];
    const original = first && first.type === "text" ? first.text : undefined;
    if (typeof original !== "string") return response;
    const collection = collectionOf(req, slug);
    if (!collection) return response;
    const blocks = blocksBySlugOf(req);
    const fallback = rootConverters(req);
    const convert = (value: unknown) => richTextToMarkdownDeep(value, fieldsOf(collection), blocks, fallback);

    if (Array.isArray(doc.docs) && original.startsWith(`Collection: "${slug}"`)) {
      const docs = doc.docs.map(convert);
      if (JSON.stringify(docs) === JSON.stringify(doc.docs)) return response;
      let body = `Collection: "${slug}"\nTotal: ${String(doc.totalDocs)} documents\nPage: ${String(doc.page)} of ${String(doc.totalPages)}\n`;
      for (const d of docs) body += `\n\`\`\`json\n${JSON.stringify(d)}\n\`\`\``;
      return { ...response, content: [{ type: "text", text: `${body}\n${READ_NOTE}` }, ...response.content.slice(1)], doc: { ...doc, docs } };
    }
    const prefix = `Document from collection "${slug}":\n`;
    if (original.startsWith(prefix)) {
      const converted = convert(doc);
      if (JSON.stringify(converted) === JSON.stringify(doc)) return response;
      return {
        ...response,
        content: [{ type: "text", text: `${prefix}${JSON.stringify(converted)}\n${READ_NOTE}` }, ...response.content.slice(1)],
        doc: converted as Record<string, unknown>,
      };
    }
    return response;
  };
}

const JSON_BLOCK = /```json\n([\s\S]*?)\n```/g;

/**
 * Every document in a plugin-mcp result, converted: a page (`docs`), a create result's rows
 * (`{ doc, index }`), a version (`version` is the document) or a document itself.
 */
function convertResult(value: unknown, convert: (doc: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => convertResult(item, convert));
  if (!isRecord(value)) return value;
  if (Array.isArray(value.docs)) return { ...value, docs: value.docs.map((item) => convertResult(item, convert)) };
  if (isRecord(value.version)) return { ...value, version: convert(value.version) };
  if (isRecord(value.doc) && "index" in value) return { ...value, doc: convert(value.doc) };
  return convert(value);
}

/**
 * `overrideResponse` for the tools that print documents in fenced JSON (`updateDocument` with
 * `returning`, `createDocuments`, `duplicateDocument`, `deleteDocuments`, `findVersions`,
 * `findVersionByID`, `restoreVersion`): every rich text value in those blocks becomes Markdown, as
 * in {@link richTextAsMarkdown}; the rest of the text (and any schema block) is kept. The internal
 * `doc` and `structuredContent` are converted the same way. Errors pass through unchanged.
 */
export function richTextResultsAsMarkdown(slug: string): MCPResponseOverride {
  return (response, doc, req) => {
    if (response.isError) return response;
    const first = response.content?.[0];
    const original = first && first.type === "text" ? first.text : undefined;
    if (typeof original !== "string") return response;
    const collection = collectionOf(req, slug);
    if (!collection) return response;
    const blocks = blocksBySlugOf(req);
    const fallback = rootConverters(req);
    const convert = (value: unknown) => richTextToMarkdownDeep(value, fieldsOf(collection), blocks, fallback);
    const convertAny = (value: unknown) => convertResult(value, convert);

    let changed = false;
    const body = original.replace(JSON_BLOCK, (whole, json: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return whole;
      }
      if (isJsonSchema(parsed)) return whole; // "Use this schema for data": not documents
      const converted = JSON.stringify(convertAny(parsed));
      if (converted === JSON.stringify(parsed)) return whole;
      changed = true;
      return `\`\`\`json\n${converted}\n\`\`\``;
    });
    if (!changed) return response;
    const structured = (response as { structuredContent?: unknown }).structuredContent;
    return {
      ...response,
      content: [{ type: "text", text: `${body}\n${READ_NOTE}` }, ...response.content.slice(1)],
      ...(isRecord(doc) && Object.keys(doc).length ? { doc: convertAny(doc) as Record<string, unknown> } : {}),
      ...(isRecord(structured) ? { structuredContent: { ...(convertAny(structured) as Record<string, unknown>), ...(structured.schema ? { schema: structured.schema } : {}) } } : {}),
    } as MCPToolResponse;
  };
}

/** plugin-mcp's input schemas carry `$schema`; documents never do. */
const isJsonSchema = (value: unknown): boolean => isRecord(value) && typeof value.$schema === "string";

/** A JSON Schema node for a Lexical rich text value: `{ properties: { root: { properties: { type: { const: "root" } } } } }`. */
function isRichTextSchema(node: Record<string, unknown>): boolean {
  const root = isRecord(node.properties) ? node.properties.root : undefined;
  const type = isRecord(root) && isRecord(root.properties) ? root.properties.type : undefined;
  return isRecord(type) && type.const === "root";
}

const RICH_TEXT_SCHEMA_DESCRIPTION = `Rich text, read as Markdown (findDocuments). Write it only with ${SET_RICH_TEXT_TOOL_NAME} (Markdown, after the document exists), never in createDocuments or updateDocument data.`;

/**
 * A collection input schema with every rich text field described as Markdown written through
 * {@link setRichTextFromMarkdownTool} instead of the Lexical JSON schema, and the `$defs` only
 * those schemas used dropped. The field stays in the schema, so the model knows it exists.
 */
export function describeRichTextAsMarkdown(schema: unknown): { schema: unknown; changed: boolean } {
  let changed = false;
  if (!isRecord(schema)) return { schema, changed };
  // Payload deduplicates repeated subschemas into `$defs` (two rich text fields on the same editor
  // become `{ $ref: "#/$defs/shared_0" }`), so a `$ref` to a rich text def is a rich text field too.
  const rootDefs = isRecord(schema.$defs) ? schema.$defs : {};
  const richDefs = new Set(Object.entries(rootDefs).filter(([, def]) => isRecord(def) && isRichTextSchema(def)).map(([name]) => name));
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isRecord(node)) return node;
    const ref = typeof node.$ref === "string" ? /^#\/\$defs\/(.+)$/.exec(node.$ref)?.[1] : undefined;
    if (isRichTextSchema(node) || (ref !== undefined && richDefs.has(ref))) {
      changed = true;
      return { description: RICH_TEXT_SCHEMA_DESCRIPTION };
    }
    // `$defs` are visited too, so a shared block def's own rich text fields are described as well.
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, visit(value)]));
  };
  const next = visit(schema) as Record<string, unknown>;
  if (!changed) return { schema, changed };
  // Keep only the $defs still reachable from the rest of the schema.
  const defs = isRecord(next.$defs) ? next.$defs : undefined;
  if (defs) {
    const used = new Set<string>();
    const refs = (value: unknown) => {
      const text = JSON.stringify(value);
      for (const match of text.matchAll(/"#\/\$defs\/([^"]+)"/g)) {
        const name = match[1]!;
        if (!used.has(name) && name in defs) {
          used.add(name);
          refs(defs[name]);
        }
      }
    };
    const { $defs: _defs, ...rest } = next;
    refs(rest);
    const kept = Object.fromEntries(Object.entries(defs).filter(([name]) => used.has(name)));
    if (Object.keys(kept).length) next.$defs = kept;
    else delete next.$defs;
  }
  return { schema: next, changed };
}

/** `overrideResponse` for `getCollectionSchema`: rich text fields described as Markdown ({@link describeRichTextAsMarkdown}). */
export function richTextSchemaAsMarkdown(): MCPResponseOverride {
  return (response) => {
    if (response.isError) return response;
    const first = response.content?.[0];
    const original = first && first.type === "text" ? first.text : undefined;
    if (typeof original !== "string") return response;
    let changed = false;
    let described: unknown;
    const text = original.replace(JSON_BLOCK, (whole, json: string) => {
      if (changed) return whole; // the first block is the schema; the next is the upload config
      try {
        const result = describeRichTextAsMarkdown(JSON.parse(json));
        if (!result.changed) return whole;
        changed = true;
        described = result.schema;
        return `\`\`\`json\n${JSON.stringify(result.schema)}\n\`\`\``;
      } catch {
        return whole;
      }
    });
    if (!changed) return response;
    const structured = (response as { structuredContent?: unknown }).structuredContent;
    return {
      ...response,
      content: [{ type: "text", text }, ...response.content.slice(1)],
      ...(isRecord(structured) ? { structuredContent: { ...structured, schema: described } } : {}),
    } as MCPToolResponse;
  };
}

type CollectionEntry = NonNullable<NonNullable<MCPPluginConfig["collections"]>[string]>;

/** plugin-mcp's built-in tools whose results print documents, by config key. */
const RESULT_TOOLS = ["create", "update", "duplicate", "delete", "findVersions", "findVersionByID", "restoreVersion"] as const;

/**
 * A plugin-mcp collection entry with rich text as Markdown: adds `setRichTextFromMarkdown`, the
 * Markdown read conversion on `findDocuments`, Markdown in the results of the tools that print
 * documents ({@link RESULT_TOOLS}) and rich text described as Markdown by `getCollectionSchema`.
 * A tool disabled in the entry (`false`) stays disabled; an entry's own `overrideResponse` on a
 * tool is replaced.
 */
export function withMarkdownRichText<T extends CollectionEntry>(slug: string, entry: T = {} as T): T {
  const tools = (entry.tools ?? {}) as CollectionToolsMap;
  const withOverride = (key: string, overrideResponse: MCPResponseOverride) => {
    const current = (tools as Record<string, unknown>)[key];
    return current === false ? {} : { [key]: { ...(isRecord(current) ? current : {}), overrideResponse } };
  };
  const results = richTextResultsAsMarkdown(slug);
  return {
    ...entry,
    tools: {
      ...tools,
      ...withOverride("find", richTextAsMarkdown(slug)),
      ...withOverride("getCollectionSchema", richTextSchemaAsMarkdown()),
      ...Object.assign({}, ...RESULT_TOOLS.map((key) => withOverride(key, results))),
      [SET_RICH_TEXT_TOOL_NAME]: setRichTextFromMarkdownTool,
    },
  } as T;
}
