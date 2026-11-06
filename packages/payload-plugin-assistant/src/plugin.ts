import type { Config, Plugin } from "payload";
import { buildEndpoints } from "./endpoints";
import {
  DOCUMENT_CONTROLS_COMPONENT_PATH,
  NAV_LINK_COMPONENT_PATH,
  VIEW_COMPONENT_PATH,
  VIEW_KEY,
  VIEW_PATH,
} from "./constants";
import type { ChatDeps } from "./server/chat";
import type { AssistantPluginOptions } from "./types/options";
import { normalizeOptions } from "./utils/normalizeOptions";
import { withAuthRedactions } from "./redaction";
import { reachableEntities } from "./utils/reachable";

type EditComponents = { beforeDocumentControls?: unknown[] } & Record<string, unknown>;
type WithEditAdmin = { slug: string; admin?: { components?: { edit?: EditComponents } & Record<string, unknown> } & Record<string, unknown> };

/**
 * Appends "Ask the assistant" to an edit view's document controls (`beforeDocumentControls`), as
 * payload-onpage does: a server component that asks `access` and renders nothing for users it
 * refuses (and nothing on a collection's create view: there is no saved document yet).
 */
function withDocumentControls<T extends WithEditAdmin>(entity: T, kind: "collection" | "global", options: { access: unknown }): T {
  const edit = entity.admin?.components?.edit ?? {};
  return {
    ...entity,
    admin: {
      ...entity.admin,
      components: {
        ...entity.admin?.components,
        edit: {
          ...edit,
          beforeDocumentControls: [
            ...(edit.beforeDocumentControls ?? []),
            {
              path: DOCUMENT_CONTROLS_COMPONENT_PATH,
              clientProps: { kind, slug: entity.slug },
              serverProps: { access: options.access },
            },
          ],
        },
      },
    },
  };
}

/**
 * The admin assistant. `enabled: false` returns the config untouched. Otherwise it adds the
 * `/api/assistant/*` endpoints (chat, rejoin, stop, conversations), the `/admin/assistant` view and its nav
 * link, with or without an API key: the
 * view's import-map entry and the endpoint must not depend on a secret (as with the socials
 * plugin), so a missing key only makes both report "not configured".
 */
export const assistantPlugin = (pluginOptions: AssistantPluginOptions): Plugin =>
  assistantPluginWith(pluginOptions);

/**
 * {@link assistantPlugin} with the endpoints' seams (model adapter, MCP dispatcher) set. Internal:
 * the tests run real turns through Payload's router with `fakeText()`.
 */
export const assistantPluginWith =
  (pluginOptions: AssistantPluginOptions, deps: ChatDeps = {}): Plugin =>
  (incomingConfig: Config): Config => {
    if (pluginOptions.enabled === false) return incomingConfig;

    const normalized = normalizeOptions(pluginOptions);
    // Every auth collection's email, API key, sessions and auth state stay hidden from the model (#68).
    const options = { ...normalized, redact: withAuthRedactions(normalized.redact, incomingConfig.collections) };
    const afterNavLinks = incomingConfig.admin?.components?.afterNavLinks;
    // The collections and globals the model's tools reach (plugin-mcp's), to put the button on.
    const reachable = reachableEntities(incomingConfig);

    return {
      ...incomingConfig,
      collections: (incomingConfig.collections ?? []).map((collection) =>
        reachable.collections.has(collection.slug) ? withDocumentControls(collection, "collection", options) : collection
      ),
      globals: (incomingConfig.globals ?? []).map((global) =>
        reachable.globals.has(global.slug) ? withDocumentControls(global, "global", options) : global
      ),
      endpoints: [
        ...(incomingConfig.endpoints ?? []),
        ...buildEndpoints(options, deps),
      ],
      admin: {
        ...incomingConfig.admin,
        components: {
          ...incomingConfig.admin?.components,
          // A server component: it asks the same `access` as the view and renders nothing for
          // users it refuses, so the link and the view always agree.
          afterNavLinks: [
            ...(Array.isArray(afterNavLinks) ? afterNavLinks : afterNavLinks ? [afterNavLinks] : []),
            { path: NAV_LINK_COMPONENT_PATH, serverProps: { access: options.access } },
          ],
          views: {
            ...incomingConfig.admin?.components?.views,
            [VIEW_KEY]: {
              Component: {
                path: VIEW_COMPONENT_PATH,
                // Server-side only (a function is fine here): never reaches the client config.
                serverProps: { configured: options.configured, access: options.access },
              },
              path: VIEW_PATH,
            },
          },
        },
      },
    };
  };
