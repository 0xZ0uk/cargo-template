import type { PayloadRequest, SanitizedConfig } from "payload";
import { handleEndpoints } from "payload";
import { authHeadersFrom, createPayloadToolSource, type McpDispatch, type PayloadToolSource } from "./payloadToolSource";
import { PLUGIN_NAME } from "../constants";
import type { AssistantToolInfo } from "../types/options";

/*
 * The parts of the tool source that need a Payload instance (`handleEndpoints`). Kept apart from
 * `payloadToolSource.ts` so the conversation Durable Object, which reaches `/api/mcp` through a
 * service binding instead, never imports `payload` at runtime.
 */

/**
 * A dispatcher that runs the MCP request through Payload's own router in this isolate:
 * `handleEndpoints({ config, path: '/api/mcp', request })`. Only where a Payload instance lives
 * (the Worker serving the admin request, Node dev, tests).
 */
export const inProcessDispatch =
  (
    config: SanitizedConfig | Promise<SanitizedConfig>,
    options: { payloadInstanceCacheKey?: string } = {}
  ): McpDispatch =>
  (request) =>
    handleEndpoints({
      config,
      path: new URL(request.url).pathname,
      request,
      ...(options.payloadInstanceCacheKey
        ? { payloadInstanceCacheKey: options.payloadInstanceCacheKey }
        : {}),
    });

/** `${serverURL or the request's origin}${routes.api}/mcp`. */
export function mcpEndpointFor(req: Pick<PayloadRequest, "payload" | "url">): URL {
  const api = req.payload.config.routes?.api ?? "/api";
  const base = req.payload.config.serverURL || req.url;
  if (!base) throw new Error(`[${PLUGIN_NAME}] cannot build the MCP endpoint URL: the request has no URL`);
  return new URL(`${api}/mcp`, base);
}

/**
 * The tool source for an admin request on the Worker (or Node): the request's credentials,
 * plugin-mcp's endpoint on the same origin, and the in-process dispatcher.
 */
export function payloadToolSourceForRequest(
  req: PayloadRequest,
  options: { toolFilter?: (tool: AssistantToolInfo) => boolean; dispatch?: McpDispatch } = {}
): PayloadToolSource {
  return createPayloadToolSource({
    endpoint: mcpEndpointFor(req),
    headers: authHeadersFrom(req as unknown as { headers: Headers; url?: string }),
    dispatch: options.dispatch ?? inProcessDispatch(req.payload.config),
    ...(options.toolFilter ? { toolFilter: options.toolFilter } : {}),
    logger: { warn: (message) => req.payload.logger.warn(message) },
  });
}

