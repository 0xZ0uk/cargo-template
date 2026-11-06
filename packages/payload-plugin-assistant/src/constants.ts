export const PLUGIN_NAME = "payload-plugin-assistant";

/** Package name, used to build import-map paths. */
export const PACKAGE_NAME = "@cargo/payload-plugin-assistant";

/** Chat endpoint, relative to Payload's API route: `POST /api/assistant/chat`. */
export const CHAT_ENDPOINT_PATH = "/assistant/chat";

/** Admin view key and route: `/admin/assistant`. */
export const VIEW_KEY = "assistant";
export const VIEW_PATH = "/assistant";

/** Import-map path of the admin view. Same whether or not the plugin is configured. */
export const VIEW_COMPONENT_PATH = `${PACKAGE_NAME}/admin/AssistantView#AssistantView`;

export const DEFAULT_MAX_STEPS = 10;

/** Conversations idle this long are deleted (Durable Object alarm). */
export const DEFAULT_RETENTION_DAYS = 30;
