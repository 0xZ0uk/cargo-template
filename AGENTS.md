# AI Agent

For any Payload-related work, reference the skill at `.claude/skills/payload/SKILL.md`.

## Cloudflare D1 / R2

The app runs on Cloudflare Workers with D1 (10 GB max per database) and R2. Keep D1 small:

- Files go to R2 (`@payloadcms/storage-r2`); never store file contents or large blobs in D1.
- Versions are capped by `limitVersions` in `src/payload.config.ts`. Only override `maxPerDoc`/`max` with a reason.
- Analytics and events go to Workers Analytics Engine. Form submissions and logs go to R2 or a separate D1 database, not the main one.
- Bindings come from `#cloudflare-runtime` (`src/runtime/`). Run `pnpm cf-typegen` after editing `wrangler.jsonc`.
- After schema changes, run `pnpm migrate:create` and commit the migration in `src/db/migrations`.
