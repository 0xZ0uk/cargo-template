import { defineCollectionTool, type MCPPluginConfig } from "@payloadcms/plugin-mcp";
import { parseDocumentID, type CollectionSlug, type PayloadRequest } from "payload";
import {
  blocksBySlugOf,
  collectionOf,
  fieldsOf,
  hasDrafts,
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
  "Markdown keeps paragraphs, headings, bold, italic, links (to URLs) and, where the field's editor has them, lists, quotes and strikethrough/inline code. " +
  "It cannot keep underline, sub/superscript, text alignment, indentation, internal links to documents, links set to open in a new tab, or upload/relationship/block nodes.";

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

type CollectionEntry = NonNullable<NonNullable<MCPPluginConfig["collections"]>[string]>;

/**
 * A plugin-mcp collection entry with rich text as Markdown: adds `setRichTextFromMarkdown` and
 * the Markdown read conversion on `findDocuments` (unless `find` is disabled there).
 */
export function withMarkdownRichText<T extends CollectionEntry>(slug: string, entry: T = {} as T): T {
  const tools = (entry.tools ?? {}) as CollectionToolsMap;
  const find = tools.find;
  return {
    ...entry,
    tools: {
      ...tools,
      ...(find === false ? {} : { find: { ...(isRecord(find) ? find : {}), overrideResponse: richTextAsMarkdown(slug) } }),
      [SET_RICH_TEXT_TOOL_NAME]: setRichTextFromMarkdownTool,
    },
  } as T;
}
