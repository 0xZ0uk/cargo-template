import type { Config, Plugin } from "payload";
import { buildChatHandler } from "./endpoints/chat";
import {
  CHAT_ENDPOINT_PATH,
  VIEW_COMPONENT_PATH,
  VIEW_KEY,
  VIEW_PATH,
} from "./constants";
import type { AssistantPluginOptions } from "./types/options";
import { normalizeOptions } from "./utils/normalizeOptions";

/**
 * The admin assistant. `enabled: false` returns the config untouched. Otherwise it adds
 * `POST /api/assistant/chat` and the `/admin/assistant` view, with or without an API key: the
 * view's import-map entry and the endpoint must not depend on a secret (as with the socials
 * plugin), so a missing key only makes both report "not configured".
 */
export const assistantPlugin =
  (pluginOptions: AssistantPluginOptions): Plugin =>
  (incomingConfig: Config): Config => {
    if (pluginOptions.enabled === false) return incomingConfig;

    const options = normalizeOptions(pluginOptions);

    return {
      ...incomingConfig,
      endpoints: [
        ...(incomingConfig.endpoints ?? []),
        { path: CHAT_ENDPOINT_PATH, method: "post", handler: buildChatHandler(options) },
      ],
      admin: {
        ...incomingConfig.admin,
        components: {
          ...incomingConfig.admin?.components,
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
