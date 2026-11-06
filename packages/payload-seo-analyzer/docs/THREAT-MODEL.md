# Threat model — `@cargo/payload-seo-analyzer`

The plugin's security model and deliberate design choices. Inherited from upstream `@consilioweb/payload-seo-analyzer`, updated for the Payload 4 + Cloudflare Workers fork; the Workers-specific parts are in *Workers deployment* at the end.

## Surface & posture

- Every plugin endpoint requires an **admin-panel session** — not merely `req.user`. No mutating endpoint is anonymous.
  > A Payload app may expose several auth collections (staff `users` **and** front-office `customers`, members, subscribers…). Any of them populates `req.user` on every route, this plugin's endpoints included. `!!req.user` therefore never meant "an admin is calling". The gate is `helpers/isAdmin.ts::isSeoPanelUser`, which compares `req.user.collection` with `req.payload.config.admin.user`.
- Intentionally **public**, read-only, non-sensitive endpoints: `/robots.txt`, `/sitemap.xml`, `/sitemap-*.xml`, and the opt-in `/llms.txt`. These are deliberately **not** rate-limited (to avoid blocking Googlebot); the shared cache is what bounds their cost instead — see *Public endpoints* below.
- The plugin's **admin views** (`/admin/seo`, `/admin/redirects`, …) enforce the same admin-panel rule as the endpoints, in `helpers/viewAccess.ts`. Declaring a custom view with a non-root `path` takes its route OUT of Payload's own `canAccessAdmin` redirect (Payload matches custom views on the path and never reads `view.public`), so a `!!req.user` check there would have let a front-office session into the admin shell — and the layout serializes the whole `clientConfig` to whoever renders it. A foreign session is sent to `/admin/unauthorized`, an anonymous one to `/admin/login`.

## Access control (RBAC)

- Two layers, both mandatory, in `helpers/isAdmin.ts`:
  1. `isSeoPanelUser(req)` — the session must come from the host's admin-panel collection (`config.admin.user`). Hosts with several admin-capable collections widen it with `SEO_ADMIN_USER_COLLECTIONS=users,staff`. When neither the user's collection nor the host's admin collection is known (mocks, non-sanitized config), the legacy authenticated-only behaviour applies — we never lock an admin out on missing information.
  2. `isSeoAdmin(user)` — the role check below. `isSeoAdminRequest(req)` is layer 1 + layer 2 and is what endpoints and collection `access` rules call.
- The same two layers apply to the plugin's **collections** (`seo-settings`, `seo-redirects`, `seo-gsc-auth`, and, without a `dataStore`, `seo-performance`, `seo-logs`, `seo-score-history`, `seo-rank-history`): Payload auto-exposes their REST API, so an endpoint-only gate is bypassable. With a `dataStore` the time-series data has no collection, hence no REST API: only the plugin's gated endpoints reach it.
- **Fail-open by default** on a role-less Payload setup (a `users` collection with no `role`/`roles` field): any admin-panel user is treated as privileged — otherwise legitimate admins would be locked out. The test is the **presence** of the field, not its shape: a `role` relationship (a number at `auth.depth: 0`, an object once populated) or a single-value `roles` select is a role scheme, and closes the fallback. `admin` is recognised through all of those shapes — string, array, populated relationship (`name`/`slug`/`value`/`role`/`label`/`title`) — so a real admin still passes. A role field that yields no readable name at all denies, and logs once per collection to say so.
- **Opt-in strict mode**: `SEO_REQUIRE_ADMIN_ROLE=1` rejects users without an explicit `admin` role. Recommended for multi-user setups with roles.
- **Admin-only** endpoints (redirects CRUD, settings, robots, seo-logs `POST`/`DELETE`, GSC disconnect, IndexNow, alerts) are gated by `isSeoAdminRequest`. `POST /seo-logs` writes a collection whose ACL is `create: isSeoAdminRequest`, so a panel session alone is not enough; a host that wants anonymous 404 middleware to log must configure `seoLogsSecret`. Row creation is capped by `SEO_LOGS_MAX_ROWS` — increments of known URLs continue past the cap, so the report keeps working.
- Rate-limit buckets are keyed by `collection:id`, not by `id` alone — ids only being unique within one auth collection. One helper (`rateLimiter.ts::rateLimitKey`) builds that key for every limited path, `POST /seo-logs` included, so no path can drift back to an IP-only bucket (`X-Forwarded-For` is client-controlled: varying it hands the caller a fresh bucket on every request).

## `overrideAccess: true` — a deliberate choice (not a bug)

Two endpoint families, two rationales:

1. **Site-wide aggregation endpoints** (audit, sitemap-audit, link-graph, cannibalization, keyword-research, duplicate-content) intentionally use `overrideAccess: true`. An SEO audit must see **all** documents to be correct (orphan detection, broken links, duplicates); filtering by the current user's ACL would produce **false orphans**. These endpoints are admin tooling and go through `withRateLimit`.
2. **Single-document endpoints** (validate, generate, breadcrumb, schema-generator, ai-*) read a **specific** document the user requested. They are protected by a strict **allowlist**:
   - `collectionSlug` must be in `targetCollections` (else 403).
   - `globalSlug` must be in `targetGlobals` (else 403) — the IDOR fix in `generate.ts` and `validate.ts`.
   The user is editing/optimizing that document, so `overrideAccess` is acceptable within that restricted scope.

3. **`POST /sidebar-content`** is the exception: it never overrides access. It populates the relation IDs in values the *client* posts (the edit form), so with `overrideAccess: true` a panel user could name any ID and read that document's text back through the extracted content. It runs Payload's `afterRead` traversal with `overrideAccess: false` and the caller's `user`, so a relation the editor can't read stays an ID (it counts as nothing in the sidebar, where `/validate` without `SEO_STRICT_READ_ACCESS` would count it). Same collection allowlist and panel-user gate as `/validate`.

> For maximum hardening (field-level ACL on single-doc reads), switching these reads to `overrideAccess: false, user: req.user` is possible but **degrades** the analysis when the host hides fields from the user — not enabled by default, to avoid regressions for the published plugin.

## Open redirect

`helpers/redirectSafety.ts` validates every redirect `to`/`from`: it rejects `//evil.com`, `/\evil.com`, dangerous schemes (`javascript:`, `data:`, …) and CRLF. Applied in the redirect endpoints, the auto-redirect hook, **and** as a field-level `validate` on the `seo-redirects` collection (covering direct admin-UI edits).

**Absolute (cross-origin) destinations are refused by default.** `validateRedirectTarget` only *flags* them `external`; `validateRedirectDestination(raw, allowExternal)` is the gate every writer now goes through. A 301 from one of your own paths to another origin carries your domain's authority (phishing, OAuth `redirect_uri` abuse), so it is opt-in: set the plugin option `allowExternalRedirects: true`.

The gate fires only on a destination that **changes**. Payload revalidates the whole merged document on every write, so refusing an external value outright would freeze every row stored back when they were allowed — you could not even flip its 301/302 type. `validateRedirectDestinationChange()` (collection field) and the PATCH handler (which re-reads the stored value) therefore accept an unchanged legacy destination, without rewriting it, and refuse anything else.

The auto-redirect hook treats the new **slug** with `normalizeFromPath`, never `validateRedirectTarget`: a document slug can never legitimately produce an off-site destination.

## SSRF

- Outbound fetches target **fixed hosts** (OpenRouter, or the operator's `SEO_AI_BASE_URL`; googleapis.com) — never a user-supplied host.
- `core-web-vitals`: origin restricted to the configured site.
- `ai-alt-text`: reads the image through Payload's own file route in-process (with the caller's cookie/authorization, so the caller's read access applies); only when that has no file does it fetch, behind an origin allowlist + http/https only. 5 MB cap.
- `external-links`: `helpers/ssrfGuard.ts` + `redirect: 'manual'` with **per-hop re-validation** (a 302 to `169.254.169.254`/localhost is blocked). The guard:
  - parses IPv6 properly (8 expanded groups) instead of `startsWith`, so `http://[::ffff:169.254.169.254]/` — normalized by `new URL()` to `[::ffff:a9fe:a9fe]` — is recognised. Embedded IPv4 (`::ffff:` mapped, `::` compatible, 6to4 `2002::/16`, NAT64 `64:ff9b::/96`) is re-checked with the IPv4 rules;
  - covers 0/8, 10/8, 127/8, 100.64/10 (CGNAT), 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/4 and 240/4, plus `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`;
  - allows only ports 80/443 and the http/https schemes (no internal port scanning);
  - checks **every** address a host resolves to, not just the first. The resolver is pluggable: `resolve4` + `resolve6` on Workers (where `dns.lookup` is documented as not implemented), `dns.lookup(host, { all: true })` on Node. Non-IP answers (CNAME targets mixed into workerd's results) never count as public, a failed AAAA query fails the lookup instead of hiding a private IPv6 address, and IP literals (decimal and octal forms normalised first) skip DNS;
  - **residual gap on Node:** `fetch` re-resolves the host, so the guard can't pin the address it checked (DNS rebinding). On Workers, `fetch` can't reach private networks anyway.
- Every block carries a reason (`private-address`, `dns-not-found`, `dns-timeout`, …), and a scan is bounded: 100 unique URLs, 1,000 subrequests per call, 5 s per request, 5 redirect hops.

## Secrets

- GSC OAuth tokens: encrypted at rest with WebCrypto AES-256-GCM (random salt and IV, auth tag; format `v2:`), `read: () => false` field, never logged. The key comes from HKDF-SHA-256 over `SEO_GSC_ENCRYPTION_KEY` (32 bytes, recommended in production) or, without it, `payload.secret`. Legacy `v1:` tokens (scrypt) still decrypt through a lazy `node:crypto` import. A wrong key or tampered ciphertext throws an explicit error; the token and key never reach the log.
- API keys (OpenRouter, PageSpeed, IndexNow): read **only** from environment variables, never stored in the DB.
- LLM prompts carry page content (drafts included). `SEO_AI_DATA_COLLECTION=deny` (default) has OpenRouter route only to providers that don't store or train on prompts.

## Rate limiting

- `rateLimiter.ts`: buckets in `SEO_RATE_LIMITS`, backed by the host's `rateLimit` option (Workers Rate Limiting bindings in `apps/web`) with an in-memory limiter per isolate as the fallback (also when the host's limiter throws, logged once). Workers Rate Limiting counts per machine and syncs eventually, so these limits are a brake, not a hard cap. Key = **`user.collection` + `user.id`** when authenticated (not spoofable); falls back to IP (`cf-connecting-ip` first, then `X-Forwarded-For`, best-effort) for public endpoints.
- Applied to expensive endpoints: crawls, audit (poll-friendly), sitemap-audit, link-graph, performance, keyword-research, duplicate-content, cannibalization, external-links.
- LLM endpoints: `/ai-alt-text`, `/ai-content-brief` and `/ai-optimize-bulk` are on the 10 req/min expensive limiter. `/ai-rewrite` and `/ai-optimize` used to be registered with **no limiter at all**; they are driven one document at a time by a human click, so they run on a dedicated 30 req/min bucket — enough for a legitimate pass over a list. On Workers the shared limiter is approximate, so the hard cap on spend is a credit limit on the OpenRouter key.
- A rate limit alone did not bound the site-wide audit: `/audit?nocache=1` dropped the cache and restarted a full rebuild as soon as the previous one finished. The manual refresh is now **admin-only** and throttled to one full rebuild per `SEO_AUDIT_MIN_REFRESH_MS` (default 5 min) per locale; a refused refresh returns the cached audit with `refreshThrottled: true`, not an error.
- `?nocache=1` forces the site-wide recomputation the aggregation endpoints exist to cache. On `/audit` it is admin-only **and** throttled (above); on `/cannibalization`, `/core-web-vitals`, `/duplicate-content`, `/external-links`, `/keyword-research`, `/link-graph`, `/redirect-chains` and `/sitemap-audit` it is admin-only — a panel user without the role silently gets the cached result rather than a 403.
- `/ai-content-brief` bounds its free-text `keyword` at 120 characters before it reaches the model — unbounded, it billed the site owner for arbitrary prompt length.
- **Recommendation**: also enforce a rate limit at the reverse-proxy level in production.

## robots.txt

`helpers/robotsSafety.ts::sanitizeRobotsRules` filters custom rules line by line (allowlisted directives only, control-char/CRLF stripping) — on both read (defense-in-depth) and write.

## Security-related environment variables

| Variable | Effect |
|----------|--------|
| `SEO_REQUIRE_ADMIN_ROLE=1` | Disable the RBAC fail-open (require an explicit admin role). |
| `SEO_ADMIN_USER_COLLECTIONS` | Comma-separated slugs accepted as admin-panel collections (default: `config.admin.user`). |
| `SEO_AUDIT_MIN_REFRESH_MS` | Minimum delay between two manual site-wide audit rebuilds (default 300000). |
| `SEO_GSC_ENCRYPTION_KEY` | Dedicated 32-byte key to encrypt GSC tokens (recommended). |
| `SEO_FETCH_MAX_DOCS` | Memory cap on the documents loaded by aggregation endpoints, `sitemap.xml` included (default 5000). |
| `SEO_SITEMAP_MAX_DOCS` | Same cap for the public sitemaps only (`sitemap.xml`, `sitemap-news/images/video.xml`); overrides `SEO_FETCH_MAX_DOCS` there. Counts every document **read**, not only those emitted. |
| `SEO_LOGS_MAX_ROWS` | Ceiling on the rows `POST /seo-logs` may create (default 5000). |
| `SEO_AI_MODEL` | OpenRouter model override (default `deepseek/deepseek-v4.1-flash`). |

## Public endpoints & content exposure

`sitemap.xml`, the `sitemap-*.xml` extensions and `llms.txt` are anonymous and built with
`overrideAccess: true`. They skip drafts **and** documents flagged `noindex`
(`doc.noindex` or `doc.meta.noindex`) — publishing the URL of a page the editor removed
from indexing is a leak, and it contradicted `/llms.txt`, which already honoured the flag.

Cost per request: `sitemap.xml` used to re-scan the whole corpus on every anonymous hit,
with a hard-coded 10 000-document read that ignored `SEO_FETCH_MAX_DOCS`. It now honours
the cap above and serves the rendered XML from the shared cache, invalidated by the same
`afterChange` hook as the other caches. The document is identical for every anonymous
caller, so the shared entry is neither an oracle nor a cross-user leak.

The same mitigation now covers `sitemap-news.xml`, `sitemap-images.xml` and `sitemap-video.xml`,
which are **more** expensive than `sitemap.xml`: the image and video ones read at `depth: 1`
(every relation populated) and walk each document's tree looking for uploads. They were the only
public routes with neither a cache nor a working cap — `SEO_SITEMAP_MAX_DOCS` counted emitted
documents only, so a corpus of drafts or `noindex` pages was paginated in full whatever the cap
said. The cap now counts every document read, exactly like `fetchAllDocs`.

## Dashboard exports (CSV)

Every CSV the dashboard produces goes through `helpers/csv.ts::toCsv`, which prefixes any cell
starting with `=`, `+`, `-`, `@`, a tab or a CR with a single quote (CWE-1236). Quoting alone is not
protection: Excel and LibreOffice strip the quotes before deciding whether a cell is a formula, and
these cells carry text a low-privileged editor writes (page title, meta title/description, focus
keyword, slug) and an admin later opens. Plain numbers are left numeric.

`overrideAccess: true` means these endpoints are **not** an access-control boundary:
a collection whose `read` is restricted to a subset of users must not be listed in
`targetCollections`.

## Workers deployment

What changes when the plugin runs on Cloudflare Workers, as in `apps/web`:

- **Data placement.** Time-series rows (score history, Search Console imports, rank history, 404 log) live in a separate D1 database (`SEO_D1`) through `dataStore`, with mandatory retention, so they can't grow the main database. `seo-gsc-auth` stays in the main D1.
- **The cache store holds audit data.** `cacheStore` objects (`seo-analyzer/cache/` in R2) contain the site audit, sitemap audit and external-link results: titles, slugs, scores and URLs of every analyzed document. `apps/web` keeps them in the media bucket, which must stay private (served only through Payload's file route). Before giving that bucket a public domain or `r2.dev` access, move the cache to its own bucket. Objects expire after 7 days (R2 lifecycle rule).
- **404 recording is in-process.** `recordSeoNotFound` writes from the frontend's not-found path without going through `POST /seo-logs`, so it skips that route's rate limit. Growth is bounded by the row cap (`SEO_LOGS_MAX_ROWS`) and the 90-day retention; the query string is stripped before storage.
- **Secrets.** On Workers, env vars reach the plugin only when declared in `apps/web/.env.schema`; secrets are marked `@sensitive`, and uploaded as Worker secrets by `varlock-wrangler`. `OPENROUTER_API_KEY` needs a credit limit at OpenRouter: that, not the rate limiter, is the cap on AI spend.
- **Same-origin fetches.** The plugin never fetches the Worker's own origin: the root files are served by calling Payload's API handler in-process, and AI alt text reads uploads through Payload's file route in-process, with the caller's credentials.
