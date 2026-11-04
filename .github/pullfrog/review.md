This repo is a Payload 4 + TanStack Start app on Cloudflare Workers (D1 + R2), plus in-house Payload plugins in `packages/*`. Read `AGENTS.md` first. Besides defects, flag these, at their real severity:

Workers runtime (`apps/web/src`, `packages/*/src`):
- Node-only APIs without a Workers path (`fs`, `child_process`, `net`, sync `node:crypto` KDFs, `setInterval` background work), and PBKDF2 above 100,000 iterations.
- Work that must finish after the response but isn't awaited or passed to `waitUntil`; module-level caches the admin UI depends on (they're per isolate).
- Whole-site scans or loops over every document with no cap or step budget (Workers CPU limits; see Performance in `packages/payload-seo-analyzer/README.md`).
- Outbound `fetch` of user-supplied URLs that skips `helpers/ssrfGuard.ts`; redirect targets that skip `validateRedirectTarget`.

Data:
- File contents or large blobs in D1; time-series rows (history, logs, imports) in the main D1 instead of `SEO_D1` through the plugin's `dataStore`.
- Payload schema changes (collections, fields, enabling a plugin feature that adds a collection) without a new migration in `apps/web/src/db/migrations`, and any edit to a migration that's already on `master`.
- A plugin collection without `versions: false`; an SEO store migration (`SEO_STORE_MIGRATIONS`) that isn't append-only or isn't safe to run twice.

Access:
- Request handlers calling the Local API with `overrideAccess: true` on behalf of a user, endpoints with no auth or role check, and expensive endpoints without the plugin's rate limiter.

Conventions that break things:
- `payload`, `@payloadcms/*`, React or TypeScript versions set in a package instead of the `pnpm-workspace.yaml` catalog.
- New env vars not declared in `apps/web/.env.schema` (secrets need `@sensitive`), and any `NEXT_*` / `PAYLOAD_PUBLIC_*` read.
- Hard-coded `/api/seo-plugin` or `/admin` paths in the plugin (use `useSeoApi` / `formatAdminURL`).
- A literal dynamic `import('pkg')` of an optional dependency (breaks Vite's optimizer; see `optionalImports.test.ts`).
- SEO analyzer admin UI that ignores `packages/payload-seo-analyzer/src/ui/README.md`: hard-coded colours, non-`@payloadcms/ui` components where one exists.

Also flag new plugin endpoints, analysis rules or store queries that come with no test.

Don't flag: French strings (the plugin ships `fr` and `en`), upstream code the PR doesn't touch, or formatting. Keep the summary short; put findings inline.
