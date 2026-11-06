import type { PayloadHandler } from "payload";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";

/**
 * `POST /api/assistant/chat`. Order of checks: signed in (401), `access` (403), configured
 * (503), `rateLimit` (429), then the turn. The endpoint is registered whether or not an API key
 * is set, so the config's shape never depends on a secret.
 */
export const buildChatHandler =
  (options: NormalizedAssistantOptions): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await options.access(req.user))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!options.configured) {
      return Response.json({ error: "not configured", configured: false }, { status: 503 });
    }
    if (options.rateLimit && !(await options.rateLimit(req))) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }

    // Lazy on purpose: see server/chat.ts.
    const { handleChat } = await import("../server/chat");
    return handleChat(req, options);
  };
