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
    ].join("\n"),
    own?.trim() ?? "",
  ].filter(Boolean);

  return payloadToolsSystemPrompt(sections.join("\n\n"));
}
