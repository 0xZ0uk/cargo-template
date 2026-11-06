import { createMCPClient, type MCPClient, type McpTool } from "@tanstack/ai-mcp";
import type { ChatMCPOptions } from "@tanstack/ai";
import { PLUGIN_NAME } from "../constants";
import type { AssistantToolInfo } from "../types/options";

/**
 * Delivers one MCP request (a `POST` to plugin-mcp's `/api/mcp`) and returns the response.
 *
 * - On the Worker that serves the admin request: {@link inProcessDispatch}, which hands the
 *   request to Payload's router in the same isolate (no network hop).
 * - Anywhere that has no Payload instance (the conversation's Durable Object, #62): any
 *   `fetch`-shaped function that reaches the same Worker, e.g. a self service binding
 *   (`(request) => env.SELF.fetch(request)`).
 *
 * The request already carries the admin's auth headers; the dispatcher must not add or drop any.
 */
export type McpDispatch = (request: Request) => Promise<Response>;

/** Where tool-source problems are reported. Payload's logger fits. */
export interface ToolSourceLogger {
  warn: (message: string) => void;
}

export interface PayloadToolSourceOptions {
  /** Absolute URL of plugin-mcp's endpoint, e.g. `https://example.com/api/mcp`. */
  endpoint: string | URL;
  /**
   * The signed-in admin's credentials, copied from the incoming admin request: `Cookie`
   * (`payload-token`), `Origin`, and `Authorization` when present. See {@link authHeadersFrom}.
   * Every MCP request re-authenticates from these: plugin-mcp never sees `req.user`.
   */
  headers: Record<string, string>;
  /** How MCP requests reach `/api/mcp`. */
  dispatch: McpDispatch;
  /** Extra filter, after the built-in one (the plugin's `toolFilter` option). */
  toolFilter?: (tool: AssistantToolInfo) => boolean;
  logger?: ToolSourceLogger;
}

/**
 * plugin-mcp's auth tools. Off by default in plugin-mcp (an LLM with `login` can probe
 * passwords), and never offered to the model even if someone enables them: the assistant
 * already runs as the signed-in user.
 */
export const AUTH_TOOL_NAMES = [
  "auth",
  "forgotPassword",
  "login",
  "resetPassword",
  "unlock",
  "verify",
] as const;

/**
 * Tools the assistant never offers, besides the auth tools.
 *
 * `getUploadInstructions` prepares a file upload: it returns a presigned request (or an
 * endpoint) that a client must then send the file's bytes to. The model has no bytes and no
 * way to send them, so the tool is useless here, costs prompt tokens on every call, and, being
 * annotated `readOnlyHint: false`, would raise an approval card for an instruction-only call.
 * Dropping it is simpler and more honest than exempting it from approval by name.
 */
export const UNSUPPORTED_TOOL_NAMES = ["getUploadInstructions"] as const;

const DROPPED = new Set<string>([...AUTH_TOOL_NAMES, ...UNSUPPORTED_TOOL_NAMES]);

/**
 * Approval rule: only tools the server declares read-only run without asking. No annotations,
 * or `readOnlyHint` anything but `true`, means the user approves first. Annotations are hints
 * from our own server (plugin-mcp), and Payload's access control still applies to every call.
 */
export const needsApproval = (tool: Pick<McpTool, "annotations">): boolean =>
  tool.annotations?.readOnlyHint !== true;

/** The built-in filter plus the plugin's `toolFilter`. */
export const buildToolFilter =
  (extra?: (tool: AssistantToolInfo) => boolean) =>
  (tool: McpTool): boolean =>
    !DROPPED.has(tool.name) && (extra ? extra(tool as AssistantToolInfo) : true);

/** The signed-in user's session was not accepted by `/api/mcp` (missing, expired, or refused). */
export class AssistantNotSignedInError extends Error {
  override readonly name = "AssistantNotSignedInError";
  constructor(options?: { cause?: unknown }) {
    super(
      "The assistant is not signed in: Payload's MCP endpoint did not accept the session forwarded from the admin request. Sign in again.",
      options
    );
  }
}

/** Listing the tools failed for any other reason. Never silently continue with no tools. */
export class AssistantToolDiscoveryError extends Error {
  override readonly name = "AssistantToolDiscoveryError";
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`The assistant could not list Payload's tools: ${detail}`, options);
  }
}

/** JSON-RPC "Method not found": plugin-mcp advertises no `tools` capability to an anonymous caller. */
const METHOD_NOT_FOUND = -32601;

/**
 * The JSON-RPC error code behind an MCP failure. The SDK reports it either on the error itself
 * (`McpError.code`) or, when the server answered with an HTTP error status, inside the response
 * text of an `SdkHttpError` (`data.text`: `{"jsonrpc":"2.0","error":{"code":-32601,...}}`).
 */
function jsonRpcErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, data } = error as { code?: unknown; data?: { text?: unknown } };
  if (typeof code === "number") return code;
  if (typeof data?.text === "string") {
    try {
      const parsed = JSON.parse(data.text) as { error?: { code?: unknown } };
      if (typeof parsed.error?.code === "number") return parsed.error.code;
    } catch {
      // Not JSON: no code.
    }
  }
  return undefined;
}

/** Maps an error from connecting or `tools/list` to one of the two errors above. */
export function toDiscoveryError(error: unknown): Error {
  if (error instanceof AssistantNotSignedInError || error instanceof AssistantToolDiscoveryError) {
    return error;
  }
  if (jsonRpcErrorCode(error) === METHOD_NOT_FOUND) return new AssistantNotSignedInError({ cause: error });
  const detail = error instanceof Error ? error.message : String(error);
  return new AssistantToolDiscoveryError(detail, { cause: error });
}

/**
 * The tool source `chat({ mcp: { clients: [source] } })` takes. It connects lazily, on the
 * first `tools()`, so building one costs nothing; `close()` ends the connection and the next
 * `tools()` opens a new one. One per run: it holds the user's credentials, so never share it
 * between requests or keep it in module state.
 */
export interface PayloadToolSource {
  tools: (options?: { lazy?: boolean; signal?: AbortSignal }) => ReturnType<MCPClient["tools"]>;
  close: () => Promise<void>;
}

/**
 * Payload's tools for the model, from plugin-mcp's `POST /api/mcp`, as the signed-in user.
 *
 * - Tools: everything plugin-mcp lists for this user, minus {@link AUTH_TOOL_NAMES},
 *   {@link UNSUPPORTED_TOOL_NAMES} and `toolFilter`. plugin-mcp lists one tool per operation for
 *   all collections (the collection is the `slug` argument), so the list is not per collection.
 * - Calls run as the user: a call on a collection the user can't access comes back to the model
 *   as a tool error (`{ error: "MCP tool \"updateDocument\" returned an error: ..." }`), and
 *   nothing changes. `chat()` does not retry it.
 * - Approval: {@link needsApproval}.
 * - Discovery fails loudly: {@link AssistantNotSignedInError} or
 *   {@link AssistantToolDiscoveryError}. Pair with {@link payloadToolsMcpOptions}.
 */
export function createPayloadToolSource(options: PayloadToolSourceOptions): PayloadToolSource {
  const endpoint = new URL(options.endpoint).toString();
  const filter = buildToolFilter(options.toolFilter);
  const transportFetch: typeof fetch = (input, init) =>
    options.dispatch(input instanceof Request && !init ? input : new Request(input, init));

  let client: Promise<MCPClient> | undefined;
  const connect = (signal?: AbortSignal) =>
    (client ??= createMCPClient({
      name: PLUGIN_NAME,
      transport: { type: "http", url: endpoint, headers: { ...options.headers }, fetch: transportFetch },
      toolFilter: filter,
      needsApproval,
      ...(signal ? { signal } : {}),
      onClose: () => options.logger?.warn(`[${PLUGIN_NAME}] the MCP connection closed unexpectedly`),
    }).catch((error: unknown) => {
      client = undefined;
      throw error;
    }));

  return {
    async tools(toolsOptions) {
      try {
        const connected = await connect(toolsOptions?.signal);
        return await connected.tools(toolsOptions);
      } catch (error) {
        throw toDiscoveryError(error);
      }
    },
    async close() {
      const pending = client;
      client = undefined;
      if (!pending) return;
      try {
        await (await pending).close();
      } catch {
        // A connection that never opened has nothing to close.
      }
    },
  };
}

/**
 * The `mcp` option of `chat()` for one Payload tool source: closes the connection when the run
 * ends, and turns a discovery failure into a clear error instead of a run with no tools.
 */
export function payloadToolsMcpOptions(source: PayloadToolSource): ChatMCPOptions {
  return {
    clients: [source],
    connection: "close",
    onDiscoveryError: (error) => {
      throw toDiscoveryError(error);
    },
  };
}

/** Header names forwarded from the admin request to `/api/mcp`. */
const FORWARDED_HEADERS = ["cookie", "authorization", "origin"] as const;

/**
 * The admin's credentials from the incoming request: `Cookie`, `Authorization` (when set) and
 * `Origin`. `Origin` falls back to the request's own origin: Payload's CSRF check requires an
 * allowed `Origin` with cookie auth as soon as `serverURL`/`csrf` is set, and an internal
 * request sends no `Sec-Fetch-Site` to fall back on.
 */
export function authHeadersFrom(request: { headers: Headers; url?: string }): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  if (!headers.origin && request.url) headers.origin = new URL(request.url).origin;
  return headers;
}

/**
 * Tool guidance for the system prompt. Measured in the spike (#59): `findDocuments` without
 * `select`/`limit` returns every field of every document, which floods the context.
 */
export const PAYLOAD_TOOLS_SYSTEM_PROMPT = [
  "You work inside the Payload CMS admin, as the signed-in user, through Payload's tools.",
  "Call getConfigInfo to learn the collection and global slugs before guessing them, and getCollectionSchema before writing to a collection.",
  "On findDocuments, always pass `select` with only the fields you need, a small `limit` (10 or fewer unless the user asks for more) and `depth: 0`. Use countDocuments to answer how-many questions.",
  "The draft/published status of a versioned document is the `_status` field. Write drafts (`draft: true`) unless the user asks you to publish.",
  "Tools that change content wait for the user's approval. If a tool returns an access error, tell the user you are not allowed to do that; do not retry it or look for a workaround.",
].join("\n");

/** {@link PAYLOAD_TOOLS_SYSTEM_PROMPT}, after the site's own `instructions` when given. */
export function payloadToolsSystemPrompt(instructions?: string): string {
  const own = instructions?.trim();
  return own ? `${own}\n\n${PAYLOAD_TOOLS_SYSTEM_PROMPT}` : PAYLOAD_TOOLS_SYSTEM_PROMPT;
}
