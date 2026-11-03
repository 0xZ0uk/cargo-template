# AI Agent

For any Payload-related work, reference the skill at `.claude/skills/payload/SKILL.md`.

## Monorepo

pnpm + Turborepo workspace. Run commands from the repo root.

- `apps/web` (`@cargo/web`): the Payload + TanStack Start app on Cloudflare Workers. App scripts run as `pnpm web <script>` from the root.
- `packages/*` (`@cargo/*`): in-house Payload plugins, built with tsup and consumed by the app as `workspace:*`. The SEO analyzer's admin UI must follow `packages/payload-seo-analyzer/src/ui/README.md`.
- `payload`, `@payloadcms/*`, React and TypeScript versions come from the catalog in `pnpm-workspace.yaml` (`"catalog:"`). Change them there, never per package: two copies of `payload` / `@payloadcms/ui` break the admin.

## Cloudflare D1 / R2

The app runs on Cloudflare Workers with D1 (10 GB max per database) and R2. Keep D1 small:

- Files go to R2 (`@payloadcms/storage-r2`); never store file contents or large blobs in D1.
- Versions are capped by `limitVersions` in `apps/web/src/payload.config.ts`. Only override `maxPerDoc`/`max` with a reason.
- Analytics and events go to Workers Analytics Engine. Form submissions and logs go to R2 or a separate D1 database, not the main one.
- Bindings come from `#cloudflare-runtime` (`apps/web/src/runtime/`). Run `pnpm web cf-typegen` after editing `apps/web/wrangler.jsonc`.
- Env vars are declared in `apps/web/.env.schema` and loaded by [varlock](https://varlock.dev). Add new variables there (mark secrets `@sensitive`), not in `.dev.vars` or the Cloudflare dashboard, then run `pnpm web cf-typegen`. Deploy with `varlock-wrangler`, not `wrangler deploy`.
- After schema changes (including enabling plugin features that add collections), run `pnpm web migrate:create` and commit the migration in `apps/web/src/db/migrations`.
