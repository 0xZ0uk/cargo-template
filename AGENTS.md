# AI Agent

For any Payload-related work, reference the skill at `.claude/skills/payload/SKILL.md`.

## Monorepo

pnpm + Turborepo workspace. Run commands from the repo root.

- `apps/web` (`@cargo/web`): the Payload + TanStack Start app on Cloudflare Workers. App scripts run as `pnpm web <script>` from the root.
- Frontend UI is shadcn/ui on Base UI (`base-nova` style, `apps/web/components.json`). Add components with the pinned CLI, `pnpm web exec shadcn add <name>`, then format them with `pnpm web exec oxfmt src/components/ui`. Theme tokens live in `apps/web/src/app/_frontend/styles.css`; dark mode keys off Payload's `[data-theme='dark']`, not shadcn's `.dark` class. Base UI has no `asChild`: compose with the `render` prop, and style links with `buttonVariants` rather than wrapping them in `Button`.
- `packages/*` (`@cargo/*`): in-house Payload plugins, built with tsup and consumed by the app as `workspace:*`. The SEO analyzer's admin UI must follow `packages/payload-seo-analyzer/src/ui/README.md`.
- `packages/onpage/*` (`@cargo/onpage-*`): our fork of payload-onpage, the on-page editor ("Edit on page"). The exception to tsup: its five packages build with `tsc -b` (one file per source keeps `'use client'` and the lazy editor chunk); tests, lint and typecheck run from `packages/onpage` (`@cargo/onpage`). Read `packages/onpage/README.md` before changing it: it lists what the fork changed from upstream and the invariants (visitors pay nothing, markers never persist, package boundaries).
- `payload`, `@payloadcms/*`, React and TypeScript versions come from the catalog in `pnpm-workspace.yaml` (`"catalog:"`). Change them there, never per package: two copies of `payload` / `@payloadcms/ui` break the admin. Lexical and TanStack Router/Start are in the catalog for the same reason (onpage shares them with the app); bump Lexical to whatever `@payloadcms/richtext-lexical` depends on.
- `payload` is patched (`patches/`, `patchedDependencies` in `pnpm-workspace.yaml`) so password hashes use at most 100,000 PBKDF2 iterations, the Workers limit; upstream uses 600,000 and admin login fails on a deployed Worker. When bumping `payload`, port the patch to the new version (`pnpm patch payload@<version>`) unless upstream has fixed it.

## Cloudflare D1 / R2

The app runs on Cloudflare Workers with D1 (10 GB max per database) and R2. Keep D1 small:

- Files go to R2 (`@payloadcms/storage-r2`); never store file contents or large blobs in D1.
- Versions are capped by `limitVersions` in `apps/web/src/payload.config.ts`. Only override `maxPerDoc`/`max` with a reason.
- Analytics and events go to Workers Analytics Engine. Form submissions and logs go to R2 or a separate D1 database, not the main one.
- Bindings come from `#cloudflare-runtime` (`apps/web/src/runtime/`). Run `pnpm web cf-typegen` after editing `apps/web/wrangler.jsonc`.
- Env vars are declared in `apps/web/.env.schema` and loaded by [varlock](https://varlock.dev). Add new variables there (mark secrets `@sensitive`), not in `.dev.vars` or the Cloudflare dashboard, then run `pnpm web cf-typegen`. Deploy with `varlock-wrangler`, not `wrangler deploy`.
- After schema changes (including enabling plugin features that add collections), run `pnpm web migrate:create` and commit the migration in `apps/web/src/db/migrations`.
