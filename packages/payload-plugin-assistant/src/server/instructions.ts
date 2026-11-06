import type { PayloadRequest } from "payload";
import { payloadToolsSystemPrompt } from "../tools/payloadToolSource";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";

type Described = { slug: string; description?: string; drafts: boolean };

const MCP_PLUGIN_SLUG = "@payloadcms/plugin-mcp";

/** plugin-mcp's raw options (`collections.<slug>.description`, `globals.<slug>.description`), when it is installed. */
function mcpDescriptions(config: PayloadRequest["payload"]["config"]): {
  collections: Record<string, { description?: unknown } | undefined>;
  globals: Record<string, { description?: unknown } | undefined>;
} {
  const plugins = (config as { plugins?: Array<{ slug?: string; options?: Record<string, any> }> }).plugins ?? [];
  const options = plugins.find((plugin) => plugin?.slug === MCP_PLUGIN_SLUG)?.options ?? {};
  return { collections: options.collections ?? {}, globals: options.globals ?? {} };
}

/** The rich text tool's name (`src/richText/tool.ts`, not imported here: that pulls in plugin-mcp). */
const SET_RICH_TEXT_TOOL = "setRichTextFromMarkdown";

/** Collections whose plugin-mcp entry has the Markdown rich text tool (`withMarkdownRichText`). */
export function markdownRichTextCollections(config: PayloadRequest["payload"]["config"]): string[] {
  const { collections } = mcpDescriptions(config);
  return Object.entries(collections)
    .filter(([, entry]) => {
      const tools = (entry as { tools?: Record<string, unknown> } | undefined)?.tools;
      return Boolean(tools && tools[SET_RICH_TEXT_TOOL]);
    })
    .map(([slug]) => slug);
}

/** How to read and write rich text, when the app installed the Markdown tool. */
function richTextRules(slugs: string[]): string {
  if (!slugs.length) return "";
  return [
    `Rich text (${slugs.map((s) => `\`${s}\``).join(", ")}):`,
    "- findDocuments shows rich text fields as Markdown, never Lexical JSON.",
    `- To change one, call ${SET_RICH_TEXT_TOOL} with the document id, the field's data path from the document (e.g. \`layout.2.richText\`, \`layout.3.columns.0.content.1.richText\`, \`caption\`) and the field's whole new Markdown. Read the current value first and change only what was asked; keep the rest word for word.`,
    "- Never put rich text in updateDocument or createDocuments data: those take Lexical JSON. To create a document with rich text, create it without the rich text, then set each field with the Markdown tool.",
    "- Markdown keeps paragraphs, headings, bold, italic and links to URLs (lists and quotes only where the field allows them). Underline, alignment, indentation, internal links to documents, new-tab links and embedded uploads or relationships are lost: if the tool says a field holds them, tell the editor what would be lost and only pass `allowFormattingLoss: true` once they agree.",
  ].join("\n");
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * The collections and globals the model can work on, with the descriptions given to plugin-mcp
 * (falling back to the collection's own `admin.description` when it is a string). Payload's
 * internal collections (`payload-*`) are left out.
 */
export function describeContent(config: PayloadRequest["payload"]["config"]): { collections: Described[]; globals: Described[] } {
  const mcp = mcpDescriptions(config);
  const collections = (config.collections ?? [])
    .filter((collection) => !collection.slug.startsWith("payload-"))
    .map((collection) => ({
      slug: collection.slug,
      description: text(mcp.collections[collection.slug]?.description) ?? text(collection.admin?.description),
      drafts: Boolean((collection.versions as { drafts?: unknown } | undefined)?.drafts),
    }));
  const globals = (config.globals ?? []).map((global) => ({
    slug: global.slug,
    description: text(mcp.globals[global.slug]?.description) ?? text(global.admin?.description),
    drafts: Boolean((global.versions as { drafts?: unknown } | undefined)?.drafts),
  }));
  return { collections, globals };
}

const line = ({ slug, description, drafts }: Described) =>
  `- \`${slug}\`${drafts ? " (drafts)" : ""}${description ? `: ${description}` : ""}`;

/** Where the site and its admin live: `serverURL` when set, else the request's origin. */
export function siteUrls(req: PayloadRequest): { site: string; admin: string; api: string } {
  const config = req.payload.config;
  const site = (config.serverURL || (req.url ? new URL(req.url).origin : "")).replace(/\/$/, "");
  return {
    site,
    admin: `${site}${config.routes?.admin ?? "/admin"}`,
    api: `${site}${config.routes?.api ?? "/api"}`,
  };
}

/**
 * The system prompt for a turn: what the assistant is and where, the content it can reach, the
 * editing conventions, the app's own `instructions`, then the tool guidance
 * (`payloadToolsSystemPrompt`). Built on the Worker (it needs `req` and the config) and sent to
 * the conversation with the turn. Fixed per site, so it stays a cacheable prefix.
 */
export async function buildSystemPrompt(req: PayloadRequest, options: NormalizedAssistantOptions): Promise<string> {
  const { site, admin } = siteUrls(req);
  const { collections, globals } = describeContent(req.payload.config);
  const own =
    typeof options.instructions === "function" ? await options.instructions({ req }) : options.instructions;

  const sections = [
    [
      `You are the content assistant in the Payload CMS admin panel of the website at ${site || "this site"}.`,
      "You help the signed-in editor find, review and change the site's content. Answer in the editor's language, briefly.",
    ].join(" "),
    collections.length ? `Collections:\n${collections.map(line).join("\n")}` : "",
    globals.length ? `Globals:\n${globals.map(line).join("\n")}` : "",
    [
      "Conventions:",
      "- Save changes as drafts (`draft: true`). Never publish (`_status: \"published\"`) unless the editor asks you to, in so many words.",
      "- Call getCollectionSchema (or getGlobalSchema) before creating or updating, and write only fields that exist.",
      "- Prefer small, targeted updates: send only the fields you change, never a whole document back.",
      `- After a change, say what changed and link to it in the admin: ${admin}/collections/<slug>/<id> for a document, ${admin}/globals/<slug> for a global.`,
      "- If something is ambiguous (which document, which wording), ask before writing.",
      "- For collections with drafts, read with `draft: true` when you discuss or edit a document, so you see the latest draft and not the published copy; say which one you mean when they differ.",
    ].join("\n"),
    richTextRules(markdownRichTextCollections(req.payload.config)),
    own?.trim() ?? "",
  ].filter(Boolean);

  return payloadToolsSystemPrompt(sections.join("\n\n"));
}
