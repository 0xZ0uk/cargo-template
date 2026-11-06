/** Anything with a Workers-style `fetch`: a service binding (`Fetcher`), or a test double. */
export interface FetcherLike {
  fetch(input: Request): Promise<Response>;
}

export interface ServiceBindingMcpFetchOptions {
  /**
   * The Worker's binding to itself (`services: [{ binding: "ASSISTANT_SELF", service: "<this worker>" }]`).
   * A call goes into the Worker's own `fetch` handler, so `POST /api/mcp` runs through the same
   * TanStack Start → Payload path as an external MCP client's request.
   */
  fetcher: FetcherLike;
  /** The admin's `Cookie` header (the `payload-token`), from the request that started the turn. */
  cookie: string;
  /** The admin request's origin. Payload checks it against `csrf` when `serverURL`/`csrf` is set. */
  origin: string;
}

/**
 * A `fetch` for the MCP HTTP transport (#61's injectable dispatcher) that reaches the Worker's own
 * `/api/mcp` through a service binding, authenticated as the admin who started the turn.
 *
 * Every call re-authenticates from the forwarded `Cookie` (plugin-mcp runs `payload.auth()` per
 * POST), so the tools act with that user's access, and the forwarded `Origin` keeps Payload's
 * CSRF check meaningful. Headers the transport sets (`Content-Type`, `Accept`, `Mcp-*`) are kept;
 * `Cookie` and `Origin` are always ours, so nothing upstream can swap the identity.
 */
export function serviceBindingMcpFetch({ fetcher, cookie, origin }: ServiceBindingMcpFetchOptions): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("Cookie", cookie);
    headers.set("Origin", origin);
    // Rebuild so the URL keeps its path/query and the body streams through unchanged.
    return fetcher.fetch(new Request(request, { headers }));
  }) as typeof fetch;
}

/** A dispatcher that fails loudly: the Durable Object has no `ASSISTANT_SELF` binding. */
export const missingSelfBinding: typeof fetch = (async () => {
  throw new Error(
    "[payload-plugin-assistant] the conversation Durable Object needs a service binding to its own Worker " +
      '(`services: [{ "binding": "ASSISTANT_SELF", "service": "<worker name>" }]` in wrangler.jsonc) to reach /api/mcp.'
  );
}) as typeof fetch;
