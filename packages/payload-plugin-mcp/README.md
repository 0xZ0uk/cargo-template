# @shipment/payload-plugin-mcp

Our fork of [`@payloadcms/plugin-mcp`](https://github.com/payloadcms/payload/tree/main/packages/plugin-mcp) `4.0.0-beta.6`: Payload's MCP server at `POST /api/mcp`, plus an **OAuth 2.1 authorization server**, so ChatGPT and claude.ai (which only connect to MCP servers over OAuth) can connect. Every site built on this template gets it with `oauth: true` instead of hand-writing the OAuth server each time.

Upstream's documentation still applies to everything else (tools, prompts, resources, `overrideGetAuthorizedMCP`, hooks): see [UPSTREAM-README.md](./UPSTREAM-README.md) and the [Payload docs](https://payloadcms.com/docs/beta/plugins/mcp).

```ts
import { mcpPlugin } from '@shipment/payload-plugin-mcp'

mcpPlugin({
  collections: { pages: { description: 'Website pages.' } },
  mcp: { serverOptions: { serverInfo: { name: 'Acme' } } },
  oauth: true, // or { canConnect, canManageAllConnections, consentDescription, … }
})
```

## What the fork changes

Kept as a small diff on upstream's source, so updates can be merged in:

- **Added**: `src/oauth/` (the OAuth server), `src/exports/wellKnown.ts` (the `./well-known` entry), `src/exports/client.tsx` (the `./client` entry: one admin view), `tests/`.
- **Changed**: `src/endpoint/access.ts` (OAuth tokens, the 401 challenge), `src/index.ts` (adds the OAuth collections, endpoints and view), `src/mcp/sanitizeMCPConfig.ts` (sanitizes `oauth`; the OAuth collections never get tools), `src/types.ts` (the `oauth` option). Each change is marked `Fork`.
- **Removed**: the stdio server (`./stdio`, the `payload-mcp` bin) and the empty `./client` export: Workers serve HTTP only.
- **Kept**: the plugin slug `@payloadcms/plugin-mcp`, so `getPluginConfig`, the `RegisteredPlugins` key and plugins that look for it (our assistant) work unchanged. Don't install upstream next to the fork.
- Built with tsup like our other packages.

Without `oauth` the plugin behaves exactly like upstream.

## OAuth

Per the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), the site is both the authorization server (issuer = its origin) and the only protected resource (`<origin>/api/mcp`):

| | |
| --- | --- |
| Discovery | RFC 9728 protected resource metadata and RFC 8414 authorization server metadata, at `/api/oauth/well-known/*` and, through the app, at `/.well-known/*`. |
| `401` | `/api/mcp` without credentials, or with an unknown, expired or revoked one, answers `401` with `WWW-Authenticate: Bearer resource_metadata="…"`. |
| Registration | `POST /api/oauth/register` (RFC 7591), public clients only (`token_endpoint_auth_method: none`), `https` redirect URIs (or `http` on loopback), matched exactly. A client that never completes an authorization is deleted after an hour. Registration is public, so at most `maxPendingClients` such clients are kept (past it: `429`), and `rateLimit` can throttle it per IP. |
| Authorize | `GET /api/oauth/authorize`: the admin login if signed out, then a consent page (client name, the host it returns to, the user). PKCE `S256` only. The page can't be framed (`frame-ancestors 'none'`); the decision is a same-origin `POST` with an HMAC CSRF token bound to the user and the request. |
| Token | `POST /api/oauth/token`: `authorization_code` and `refresh_token`. Codes are single use and live 60 s, access tokens an hour; refresh tokens rotate, and presenting a used one revokes the whole connection. |
| Use | `Authorization: Bearer pmcp_at_…` on `/api/mcp`. The token acts as its user (`req.user`, `_strategy: 'mcp-oauth'`) with `overrideAccess: false`, and is re-checked on every request: a revoked connection, a deleted user or one `canConnect` now refuses stops working at once. |

**Credentials stay out of reach.** Revoking a connection must end the client's access, so a request made with an OAuth token can't create accounts in any auth collection, restore their versions, run the auth operations, or write credentials (`email`, `username`, `password`, `apiKey`, `enableAPIKey`, and the other auth fields): a `beforeOperation` hook on every auth collection (`src/oauth/guard.ts`) refuses it. Other fields stay editable within the user's access.

API keys and the admin's session keep working on `/api/mcp` as before (the assistant uses the session).

**Storage.** Three collections, closed to REST, GraphQL and the MCP tools: `mcp-oauth-clients` and `mcp-oauth-tokens` (hidden), and `mcp-oauth-connections`, shown in the admin as **AI connections**, where users see and revoke (delete) theirs. Codes and tokens are stored as SHA-256 hashes. Adding `oauth` changes the schema: run a migration. It only adds tables.

**Database.** Any Payload database adapter; built for Cloudflare D1: bulk deletes are one `DELETE … WHERE` on the collection's own columns (never an `IN` list past D1's 100 parameters), and exchanging a code or refresh token is atomic without transactions (an insert on a unique index, see `claim` in `src/oauth/store.ts`). Web Crypto only (SHA-256, HMAC-SHA-256), so it runs on Workers.

### Options

| Option | Default | |
| --- | --- | --- |
| `canConnect({ req, user })` | every user of `userCollection` | Who may approve a client, and whose connections keep working (checked on every request). |
| `canManageAllConnections({ req, user })` | nobody | Who sees and revokes every user's connections; everyone else only their own. |
| `maxPendingClients` | 1000 | Most registered clients that haven't authorized yet (about 10 KB each at most); past it, registration answers `429`. |
| `rateLimit({ endpoint, req })` | none | Return `false` to answer `429` on `register` or `token`. Key it by client IP (`CF-Connecting-IP` on Workers). |
| `consentDescription` | a generic sentence | What a client can do, on the consent page: a string, or `{ en, pt }`. |
| `resourceName` | `mcp.serverOptions.serverInfo.name`, else "Payload" | Shown on the consent page and as `resource_name`. |
| `serverURL` | `serverURL` of the Payload config, else each request's origin | The public origin (issuer). |
| `ttl` | `access` 3600, `code` 60, `consent` 600, `refresh` 30 days, `unusedClient` an hour | Lifetimes in seconds. |
| `userCollection` | `admin.user` | The auth collection whose users connect. |

The consent page is in English or Portuguese, following the admin language.

### Setting up a site

1. `oauth: true` (or options) in `mcpPlugin`, then `payload generate:importmap` (the plugin adds an admin view) and a migration.
2. Serve the discovery documents at the site root. OAuth clients look for `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp` outside Payload's `/api`, so forward them to the plugin's endpoints. `@shipment/payload-plugin-mcp/well-known` exports `oauthWellKnownTarget(pathname, apiRoute)`, which maps a root path to the endpoint path (or `null`):
   - **TanStack Start**: a `/.well-known/$` route that hands the request to Payload's API handler with that path. This template's [`apps/web/src/app/[.]well-known.$.ts`](../../apps/web/src/app/[.]well-known.$.ts) does it; copy it.
   - **Next.js**: a rewrite in `next.config`: `{ source: '/.well-known/:path(oauth-authorization-server|oauth-protected-resource)/:rest*', destination: '/api/oauth/well-known/:path' }`.
3. Put the site on a public HTTPS URL: ChatGPT and claude.ai connect from their servers.

**Why an admin view?** The authorize endpoint sends a signed-out user to the admin login with a `redirect` back. The login form navigates with the admin's client-side router, which can't open an API route (TanStack Start renders a 404). So the login redirects to `/admin/mcp-oauth/continue?to=…`, a view that finishes with a full page load, and only ever to this site's authorize endpoint.

## Updating from upstream

Upstream ships its `src` in the npm package. To take a new version: diff the new `src` against the version above (`4.0.0-beta.6`), apply the changes here, keeping the `Fork` changes, bump `@modelcontextprotocol/server` to upstream's version, and run `pnpm test` here and the app's checks. Update the version in this README.

## Development

```bash
pnpm --filter @shipment/payload-plugin-mcp build
pnpm --filter @shipment/payload-plugin-mcp test       # OAuth flow on real Payload + SQLite
pnpm --filter @shipment/payload-plugin-mcp typecheck
```

The app's `tests/e2e/mcp-oauth.e2e.spec.ts` runs the browser part (root discovery, admin login back to the consent page, Allow, a working token).

## License

MIT, like upstream ([LICENSE.md](./LICENSE.md), © Payload CMS, LLC).
