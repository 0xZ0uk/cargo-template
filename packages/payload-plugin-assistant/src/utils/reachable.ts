/**
 * The collections and globals the assistant can work on: those plugin-mcp exposes
 * (`mcpPlugin({ collections, globals })`), since every tool goes through it. Without plugin-mcp in
 * the config, every collection except Payload's own (`payload-*`) and every global. Works on the
 * raw config (the plugin, at build time) and the sanitized one (the endpoints).
 */

// The fork (`@cargo/payload-plugin-mcp`) keeps upstream's slug.
export const MCP_PLUGIN_SLUG = "@payloadcms/plugin-mcp";

interface ConfigLike {
  collections?: ReadonlyArray<{ slug: string }>;
  globals?: ReadonlyArray<{ slug: string }>;
  plugins?: ReadonlyArray<unknown>;
}

export interface ReachableEntities {
  collections: Set<string>;
  globals: Set<string>;
}

/** plugin-mcp's raw options, when it is installed (its plugin function carries `slug` and `options`). */
export function mcpPluginOptions(config: ConfigLike): { collections?: Record<string, unknown>; globals?: Record<string, unknown> } | undefined {
  const plugin = (config.plugins ?? []).find(
    (p) => Boolean(p) && (p as { slug?: unknown }).slug === MCP_PLUGIN_SLUG
  ) as { options?: Record<string, any> } | undefined;
  return plugin ? (plugin.options ?? {}) : undefined;
}

export function reachableEntities(config: ConfigLike): ReachableEntities {
  const collections = (config.collections ?? []).map((c) => c.slug);
  const globals = (config.globals ?? []).map((g) => g.slug);
  const mcp = mcpPluginOptions(config);
  if (!mcp) {
    return { collections: new Set(collections.filter((slug) => !slug.startsWith("payload-"))), globals: new Set(globals) };
  }
  const listed = (entries: Record<string, unknown> | undefined) =>
    new Set(Object.entries(entries ?? {}).filter(([, entry]) => Boolean(entry)).map(([slug]) => slug));
  const mcpCollections = listed(mcp.collections);
  const mcpGlobals = listed(mcp.globals);
  return {
    collections: new Set(collections.filter((slug) => mcpCollections.has(slug))),
    globals: new Set(globals.filter((slug) => mcpGlobals.has(slug))),
  };
}
