import type { Endpoint, PayloadRequest } from "payload";
import {
  APPROVALS_ENDPOINT_PATH,
  CHAT_ENDPOINT_PATH,
  CONFIG_ENDPOINT_PATH,
  CONVERSATIONS_ENDPOINT_PATH,
  STOP_ENDPOINT_PATH,
} from "../constants";
import type { ChatDeps } from "../server/chat";
import type { NormalizedAssistantOptions } from "../utils/normalizeOptions";

type Handlers = typeof import("../server/chat");
type Guard = { configured?: boolean; rateLimit?: boolean };

const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error: message, code, ...extra }, { status });

/**
 * The assistant's REST endpoints (the contract is in the README). Every one checks, in order:
 * signed in (401), `access` (403); the chat turn also: configured (503), `rateLimit` (429).
 * Registered whether or not an API key is set, so the config's shape never depends on a secret.
 * Handlers load lazily (`await import("../server/chat")`): the AI runtime stays out of the
 * config's import graph.
 */
export function buildEndpoints(options: NormalizedAssistantOptions, deps: ChatDeps = {}): Endpoint[] {
  const guarded =
    (guard: Guard, run: (handlers: Handlers, req: PayloadRequest) => Promise<Response>) =>
    async (req: PayloadRequest): Promise<Response> => {
      if (!req.user) return error(401, "unauthorized", "Unauthorized");
      if (!(await options.access({ user: req.user, req }))) return error(403, "forbidden", "Forbidden");
      if (guard.configured && !options.configured) {
        return error(503, "not_configured", "not configured", { configured: false });
      }
      if (guard.rateLimit && options.rateLimit && !(await options.rateLimit(req))) {
        return error(429, "rate_limited", "Too many requests");
      }
      return run(await import("../server/chat"), req);
    };

  return [
    {
      path: CONFIG_ENDPOINT_PATH,
      method: "get",
      handler: guarded({}, async () =>
        Response.json({
          configured: options.configured,
          models: options.models,
          defaultModel: options.defaultModel,
          maxSteps: options.maxSteps,
        })
      ),
    },
    {
      path: CHAT_ENDPOINT_PATH,
      method: "post",
      handler: guarded({ configured: true, rateLimit: true }, (h, req) => h.handleChat(req, options, deps)),
    },
    { path: CHAT_ENDPOINT_PATH, method: "get", handler: guarded({}, (h, req) => h.handleChatGet(req, options, deps)) },
    { path: APPROVALS_ENDPOINT_PATH, method: "get", handler: guarded({}, (h, req) => h.handleApprovals(req, options, deps)) },
    { path: STOP_ENDPOINT_PATH, method: "post", handler: guarded({}, (h, req) => h.handleStop(req, options, deps)) },
    {
      path: CONVERSATIONS_ENDPOINT_PATH,
      method: "get",
      handler: guarded({}, (h, req) => h.handleListConversations(req, options, deps)),
    },
    {
      path: `${CONVERSATIONS_ENDPOINT_PATH}/:threadId`,
      method: "get",
      handler: guarded({}, (h, req) => h.handleGetConversation(req, options, deps)),
    },
    {
      path: `${CONVERSATIONS_ENDPOINT_PATH}/:threadId`,
      method: "patch",
      handler: guarded({}, (h, req) => h.handleRenameConversation(req, options, deps)),
    },
    {
      path: `${CONVERSATIONS_ENDPOINT_PATH}/:threadId`,
      method: "delete",
      handler: guarded({}, (h, req) => h.handleDeleteConversation(req, options, deps)),
    },
  ];
}
