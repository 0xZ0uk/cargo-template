import type { PayloadRequest } from "payload";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";

/**
 * The chat turn. Loaded with `await import("./server/chat")` from the endpoint, so the AI runtime
 * (`@tanstack/ai`, `@tanstack/ai-mcp`, the OpenRouter adapter…) stays out of the import graph of
 * `payload.config` and of the admin bundle. Import it from here only, never statically.
 *
 * Stub: the real turn (MCP tools, `chat()` in the conversation's Durable Object, SSE) lands
 * with #61–#63.
 */
export async function handleChat(
  _req: PayloadRequest,
  _options: NormalizedAssistantOptions
): Promise<Response> {
  return Response.json({ error: "not implemented" }, { status: 501 });
}
