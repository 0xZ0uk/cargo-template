export const PLUGIN_NAME = "payload-plugin-assistant";

/** Package name, used to build import-map paths. */
export const PACKAGE_NAME = "@cargo/payload-plugin-assistant";

/** Chat endpoint, relative to Payload's API route: `POST|GET /api/assistant/chat`. */
export const CHAT_ENDPOINT_PATH = "/assistant/chat";
/** Stop a run: `POST /api/assistant/chat/stop`. */
export const STOP_ENDPOINT_PATH = "/assistant/chat/stop";
/** The caller's conversations: `GET /api/assistant/conversations`, then `/:threadId`. */
export const CONVERSATIONS_ENDPOINT_PATH = "/assistant/conversations";
/** What each pending approval would change: `GET /api/assistant/approvals?threadId=`. */
export const APPROVALS_ENDPOINT_PATH = "/assistant/approvals";
/** The caller's usage today and the budget (#68): `GET /api/assistant/usage?threadId=`. */
export const USAGE_ENDPOINT_PATH = "/assistant/usage";
/** The `@` search: `GET /api/assistant/documents?q=`. */
export const DOCUMENTS_ENDPOINT_PATH = "/assistant/documents";
/** What the admin UI needs first: `GET /api/assistant/config`. */
export const CONFIG_ENDPOINT_PATH = "/assistant/config";

/** Admin view key and route: `/admin/assistant`. */
export const VIEW_KEY = "assistant";
export const VIEW_PATH = "/assistant";

/** Import-map path of the admin view. Same whether or not the plugin is configured. */
export const VIEW_COMPONENT_PATH = `${PACKAGE_NAME}/admin/AssistantView#AssistantView`;

/** Import-map path of the nav link (`admin.components.afterNavLinks`), a server component. */
export const NAV_LINK_COMPONENT_PATH = `${PACKAGE_NAME}/admin/AssistantNavLink#AssistantNavLink`;

/** Import-map path of the edit view's "Ask the assistant" control (`beforeDocumentControls`), a server component. */
export const DOCUMENT_CONTROLS_COMPONENT_PATH = `${PACKAGE_NAME}/admin/AssistantDocumentControls#AssistantDocumentControls`;

export const DEFAULT_MAX_STEPS = 10;

/**
 * Cloudflare's cap on one request: "A single request has a maximum of 32 Worker invocations, and
 * each call to a Service binding counts towards this limit. Subsequent calls will throw an
 * exception." (https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/#limits).
 * Every MCP request of a run goes to `/api/mcp` through `ASSISTANT_SELF`, so it counts.
 */
export const WORKER_INVOCATIONS_PER_REQUEST = 32;

/**
 * The MCP requests one run may make, counted as if the whole chain shares the 32: the Worker that
 * took the turn (1), the conversation's Durable Object (1), then everything the run sends to
 * `/api/mcp`, with 2 spare. A run connects once (3 requests: `server/discover`,
 * `subscriptions/listen`, `tools/list`) and each tool call is one more.
 */
export const MCP_REQUESTS_PER_RUN = WORKER_INVOCATIONS_PER_REQUEST - 4;

/** MCP requests a run makes to connect, before its first tool call (measured: see the README). */
export const MCP_SETUP_REQUESTS = 3;

/** The most `maxToolCalls` can be: what fits in {@link MCP_REQUESTS_PER_RUN} after connecting. */
export const MAX_TOOL_CALLS_LIMIT = MCP_REQUESTS_PER_RUN - MCP_SETUP_REQUESTS;

/** Tool calls one run may make by default (an approved write, run in its resume, counts there). */
export const DEFAULT_MAX_TOOL_CALLS = 20;

/** Compaction budget (estimated tokens of the transcript sent to the model). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 64_000;

/** OpenRouter attribution (`X-OpenRouter-Title`). */
export const DEFAULT_APP_TITLE = "Payload admin assistant";

/** Conversations idle this long are deleted (Durable Object alarm). */
export const DEFAULT_RETENTION_DAYS = 30;
