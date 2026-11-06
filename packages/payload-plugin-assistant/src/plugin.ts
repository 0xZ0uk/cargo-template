import type { Config, Plugin } from "payload";
import { buildEndpoints } from "./endpoints";
import { NAV_LINK_COMPONENT_PATH, VIEW_COMPONENT_PATH, VIEW_KEY, VIEW_PATH } from "./constants";
import type { ChatDeps } from "./server/chat";
import type { AssistantPluginOptions } from "./types/options";
import { normalizeOptions } from "./utils/normalizeOptions";
import { withAuthRedactions } from "./redaction";

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

    return {
      ...incomingConfig,
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
