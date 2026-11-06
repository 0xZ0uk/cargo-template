export const PLUGIN_NAME = "payload-plugin-assistant";

/** Package name, used to build import-map paths. */
export const PACKAGE_NAME = "@cargo/payload-plugin-assistant";

/** Chat endpoint, relative to Payload's API route: `POST|GET /api/assistant/chat`. */
export const CHAT_ENDPOINT_PATH = "/assistant/chat";
/** Stop a run: `POST /api/assistant/chat/stop`. */
export const STOP_ENDPOINT_PATH = "/assistant/chat/stop";
/** The caller's conversations: `GET /api/assistant/conversations`, then `/:threadId`. */
export const CONVERSATIONS_ENDPOINT_PATH = "/assistant/conversations";
/** What the admin UI needs first: `GET /api/assistant/config`. */
export const CONFIG_ENDPOINT_PATH = "/assistant/config";

/** Admin view key and route: `/admin/assistant`. */
export const VIEW_KEY = "assistant";
export const VIEW_PATH = "/assistant";

/** Import-map path of the admin view. Same whether or not the plugin is configured. */
export const VIEW_COMPONENT_PATH = `${PACKAGE_NAME}/admin/AssistantView#AssistantView`;

export const DEFAULT_MAX_STEPS = 10;

/** Compaction budget (estimated tokens of the transcript sent to the model). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 64_000;

/** OpenRouter attribution (`X-OpenRouter-Title`). */
export const DEFAULT_APP_TITLE = "Payload admin assistant";

/** Conversations idle this long are deleted (Durable Object alarm). */
export const DEFAULT_RETENTION_DAYS = 30;
