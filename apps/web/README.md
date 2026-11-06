# Cargo Template

A Payload 4 + TanStack Start template that runs as a single Cloudflare Worker, with **D1** for the database and **R2** for media.

> [!IMPORTANT]
> Payload's TanStack Start adapter is only available in the Payload 4 beta. The Worker bundle is larger than the free plan's script-size limit, so deploying needs a paid Workers plan.

## Quick Start

### Development

The app lives in `apps/web` of the Cargo monorepo (see the [root README](../../README.md)).

1. `echo "PAYLOAD_SECRET=$(openssl rand -hex 32)" > apps/web/.env.development.local`
2. `pnpm install && pnpm web migrate && pnpm dev` from the repo root
3. Open `http://localhost:3000/admin` and create your first user.

`pnpm dev` at the root builds the workspace plugins, keeps them rebuilding on change, and runs TanStack's Node dev server. Wrangler's `getPlatformProxy` provides a local D1 database (stored in `.wrangler/state`). It gets its schema from the committed migrations, like production: run `pnpm migrate` after pulling new migrations or creating one. Payload's dev schema push is off (`push: false`) because it rebuilds tables with `DROP TABLE`, which on D1 cascade-deletes their child rows. Media uploads go to the local `media/` directory.

### Environment variables

[Varlock](https://varlock.dev) loads and validates env vars against [`.env.schema`](./.env.schema), which lists every variable and whether it's sensitive. `APP_ENV` picks the environment (`development` by default, `production` for deploys). Keep values in gitignored `.env.[APP_ENV].local` files, or pass them in the process environment. `pnpm exec varlock load` shows what resolves. The Node scripts run under `varlock run`, the Worker build uses `varlockCloudflareVitePlugin`, and deploys use `varlock-wrangler`. After changing the schema, run `pnpm cf-typegen` to update `env.d.ts` and `cloudflare-env.d.ts`.

### Preview in the Workers runtime

`pnpm preview` builds the Worker and serves it from workerd at `http://localhost:4173`, with the same runtime and storage path as production. It uses a local D1 database and a local R2 bucket (no remote resources). Run `pnpm migrate` first so the local database has the schema.

## Deployment

Create the Cloudflare resources once:

```bash
pnpm wrangler login
pnpm wrangler d1 create cargo-template
pnpm wrangler r2 bucket create cargo-template-media
```

Put the production secret in `.env.production.local` (`PAYLOAD_SECRET=...`), or set `PAYLOAD_SECRET` in your CI environment. If you're migrating an existing Worker, reuse its current value; a new value logs every user out.

> [!IMPORTANT]
> [`wrangler.jsonc`](./wrangler.jsonc) ships with the `database_id` of the template's own D1 database, which your account can't reach. **Replace it with the `database_id` printed by `d1 create`** before you run `pnpm run deploy`, or the migrations and the deploy fail.

Then add the bucket's lifecycle rule. It expires the SEO analyzer's cache objects under `seo-analyzer/cache/` after 7 days, so keys left behind by an old config or locale don't pile up. Cache entries live 15 minutes anyway; if a key that's still in use expires (an invalidation marker on a site with no edits for a week), the next request just rebuilds.

```bash
pnpm r2:lifecycle
```

If you rename the Worker, database or bucket, update the names in `wrangler.jsonc` (and in the `r2:lifecycle` script) too, then run `pnpm cf-typegen`. The `ratelimits` bindings in `wrangler.jsonc` use account-wide `namespace_id`s: give each Worker on the account its own ids, or they share counters. Workers Rate Limiting is approximate (counts sync between machines eventually), so a burst can get past the limit.

Wrangler stores the local D1 database under `.wrangler/state` by `database_id`, so changing the id gives `pnpm dev` a new, empty local database. To keep your local data, change the id before you start developing. Otherwise, copy the old `.sqlite` file in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` to the new file name.

Whenever the Payload schema changes, create a migration, apply it to your local database and commit it:

```bash
pnpm migrate:create
pnpm migrate
```

Read the generated SQL before committing. When a change rebuilds a table (`CREATE TABLE __new_x … DROP TABLE x`), D1 ignores the `PRAGMA foreign_keys=OFF` around it, so dropping `x` deletes or nulls every row that references it. Copy those rows aside first and put them back afterwards; `20261105_163314_page_blocks.ts` shows how. Test the migration on a local database that has content, not an empty one.

Then deploy:

```bash
pnpm run deploy
```

The Worker's entry is [`src/server.ts`](./src/server.ts): TanStack Start's `fetch` plus a `scheduled` handler. A Cron Trigger (`triggers.crons` in `wrangler.jsonc`, every 5 minutes) runs the due Payload jobs through it. Today that's the SEO analyzer's `seo` queue, which finishes dashboard audits too big for one request. To run a tick locally against `pnpm preview`, open `/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*`.

`pnpm run deploy` (not `pnpm deploy`, which is pnpm's own command) applies migrations to the remote D1 database, runs `PRAGMA optimize`, builds the Worker with `APP_ENV=production` and deploys it with `varlock-wrangler`. Non-sensitive values become Worker vars and sensitive ones become secrets. `varlock-wrangler deploy` replaces the Worker's vars and secrets with the schema's, so define any new ones in `.env.schema` rather than the dashboard. The build fails if `PAYLOAD_SECRET` doesn't resolve for production. If you add a named Wrangler environment, set `CLOUDFLARE_ENV` so the migration commands use the same bindings.

## Staying under D1's 10 GB limit

A D1 database is capped at 10 GB. Most Payload sites never get close, as long as heavy or ever-growing data stays out of D1. This template is set up for that:

- **Media lives in R2.** `@payloadcms/storage-r2` stores the files, and D1 only keeps their metadata. The R2 adapter is enabled only in the Workers runtime; `pnpm dev` writes to local disk instead.
- **Versions are capped at 20 per document.** The `limitVersions` plugin (`src/plugins/limitVersions.ts`) applies the cap to every versioned collection (`maxPerDoc`) and global (`max`) that doesn't set its own. Payload's default is 100.
- **Finished jobs are deleted.** `jobs.deleteJobOnComplete` is on, so completed jobs and their logs don't pile up.
- **Logs go to Workers Logs**, not the database (`observability` is enabled in `wrangler.jsonc`).

When you add features that produce append-only data, keep it out of the main D1 database:

| Data                                     | Where it should go                         |
| ---------------------------------------- | ------------------------------------------ |
| Analytics, page views, events            | Workers Analytics Engine                   |
| Form submissions                         | A separate D1 database, or R2 for archives |
| Audit/activity logs, exports, large JSON | R2 (or Workers Logs for operational logs)  |

## Useful commands

Run these inside `apps/web`, or from the repo root as `pnpm web <command>` (e.g. `pnpm web migrate:create`).

| Command               | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `pnpm dev`            | Node dev server with local D1 and local-disk media              |
| `pnpm build`          | Build the Worker and static assets                              |
| `pnpm preview`        | Build and run in local workerd (local D1 + R2)                  |
| `pnpm run deploy`     | Migrate remote D1, build and deploy                             |
| `pnpm r2:lifecycle`   | Add the R2 rule that expires stale SEO cache objects            |
| `pnpm generate:types` | Regenerate Cloudflare (`cloudflare-env.d.ts`) and Payload types |
| `pnpm migrate:create` | Create a migration in `src/db/migrations`                       |
| `pnpm migrate`        | Apply migrations to the local D1 database                       |
| `pnpm migrate:remote` | Apply migrations to the remote D1 database                      |
| `pnpm test:int`       | Run Local API integration tests                                 |
| `pnpm test:e2e`       | Run Playwright against `pnpm dev` (`E2E_PORT`, default 3000; `E2E_BASE_URL` for a server you started on the local D1) |
| `pnpm lint`           | Run ESLint                                                      |

## How it works

### Runtime bindings

`src/payload.config.ts` imports its Cloudflare bindings from `#cloudflare-runtime`, which resolves to one of two modules:

- `src/runtime/cloudflare.ts` for builds and `pnpm preview`. It reads the bindings from `cloudflare:workers`.
- `src/runtime/node.ts` for `pnpm dev`, tests and the Payload CLI. It gets the bindings from Wrangler's `getPlatformProxy`. `migrate:remote` sets `PAYLOAD_MIGRATE_REMOTE=true`, which points D1 at the remote database. That's why D1 is marked `"remote": true` in `wrangler.jsonc`; dev and preview opt out of remote bindings, so they stay local.

`vite.config.ts` only adds `@cloudflare/vite-plugin` (through `varlockCloudflareVitePlugin`) for builds and `pnpm preview`. A small build-only plugin bundles the packages Payload normally leaves external, because workerd has no Node module loader.

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- **Users (Authentication):** auth-enabled collection with access to the admin panel. See the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.
- **Pages:** the website's pages, ported from Payload's `website` template. Each page has a hero (`src/heros`), a `layout` of blocks (`src/blocks`: Call to Action, Content, Media) and an SEO tab from `@payloadcms/plugin-seo`, analyzed by the workspace plugin `@cargo/payload-seo-analyzer` (score sidebar, `/admin/seo` dashboard, redirects, sitemap/robots under `/api/seo-plugin`). Pages have drafts with autosave, a preview button and live preview.
- **Header / Footer (globals):** up to six navigation links each, pointing at a page or a custom URL.
- **Media:** upload-enabled collection, stored in R2 in production. Cropping and focal points are disabled because they need `sharp`, which Workers can't run. The optional `caption` is rendered under media blocks.
- **Folders / Tags:** used to organise media.

### Frontend

Pages render at `/$slug` (`src/app/_frontend/$slug.tsx`). The page with the slug `home` renders at `/`, and `/home` redirects there. Until a `home` page exists, `/` shows a static placeholder (`src/collections/Pages/homeStatic.ts`). Both routes load data through the `loadPage` server function in `src/app/_frontend/pages.functions.ts`, which queries the Local API with the visitor's access, so anonymous visitors only see published pages. `head()` turns each page's SEO fields into the title, description and Open Graph tags.

The `_frontend` layout route loads the Header and Footer globals once per full page load (`src/app/_frontend/layout.functions.ts`); client-side navigation reuses them. When a page has a high-impact hero, the header switches to its dark theme so it stays readable over the image. Pages that don't exist render the 404 inside the layout, with the header and footer.

Drafts render only for logged-in users who add `?draft=true`, which is the URL the admin's Preview and Live Preview use. In live preview, `LivePreviewListener` reloads the route data each time the document saves. Every request is server-rendered from D1, so publishing needs no revalidation step.

A/B tests (`@cargo/payload-plugin-ab`, registered in `src/payload.config.ts`): the **Variants** panel in a page's sidebar clones it into variants (`<slug>--<hash>`, created as drafts) and sets each one's share of traffic. Once a variant is published, `loadPage` assigns each visitor of the original's URL a bucket (sticky, by the `payload_ab_bucket_<path>` cookie) and renders that bucket's page there. Drafts, live preview, on-page editing and preview links always show the page asked for. Pages with an experiment are sent `Cache-Control: private, no-store`; other pages are unaffected. The manifest of which pages run experiments is read through the Workers Cache API (`src/plugins/abTesting.ts`): its entries are per data centre, so a change can take up to 30 seconds to reach visitors served elsewhere. Variants get no "Edit on page"; edit them in the panel's drawer. Visitors only reach a variant through the original's URL: a published variant asked for at its own URL answers with a 302 to the original's (editors in draft, preview or on-page mode can still open it there). Every page emits a `<link rel="canonical">`, and it, `og:url` and the JSON-LD URLs use the requested slug, so a served variant (or one an editor opens) points at the original. The SEO analyzer's `excludeDocs` option leaves variants out of `sitemap.xml` and its extensions, `llms.txt`, IndexNow and the whole-site scans; the sidebar still scores a variant you open.

The frontend uses Tailwind CSS 4 (`src/app/_frontend/styles.css`, `tailwind.config.mjs`) with the website template's shadcn/ui tokens. Tailwind only processes that stylesheet, and only frontend routes load it, so admin styles are unaffected. Images render as plain `<img>` tags because Workers can't run sharp to create resized variants.

### MCP

[`@payloadcms/plugin-mcp`](https://payloadcms.com/docs/beta/plugins/mcp) serves an MCP server at `POST /api/mcp` (Streamable HTTP), so AI clients can read and edit content. Every collection gets the built-in tools (`findDocuments`, `createDocuments`, `updateDocument`, `deleteDocuments`, and so on), except that `users` can't be created or deleted over MCP. Tools run with the caller's Payload access control, and anonymous callers get none.

To connect a client:

1. In the admin panel, open your user, check **Enable API Key**, and save. Keys are encrypted with `PAYLOAD_SECRET`, so changing the secret invalidates them.
2. Add the server to your client with the header `Authorization: users API-Key <key>`. For Claude Code:

   ```bash
   claude mcp add --transport http payload http://localhost:3000/api/mcp --header "Authorization: users API-Key <key>"
   ```

   Clients that only support stdio can use `npx -y mcp-remote <url> --header "Authorization: users API-Key <key>"`.

In development you can skip auth with `http://localhost:3000/api/mcp?overrideAccess=true`; the endpoint rejects that parameter in production. Configure descriptions, tools, prompts and resources in the `mcpPlugin` call in `src/payload.config.ts`.

### Current limitations

- No image resizing or cropping on Workers (no `sharp`).
- Payload is patched (`patches/` at the repo root) to hash passwords with 100,000 PBKDF2 iterations instead of 600,000, because deployed Workers reject anything higher. Without the patch, every admin login fails as "incorrect password" on a deployed Worker, even though it works in `pnpm dev` and `pnpm preview`. A hash made by unpatched Payload only verifies under Node. To fix one, set that password again through the Local API in a `pnpm web payload run` script with `PAYLOAD_MIGRATE_REMOTE=true`, which writes a new 100k hash to the remote database.
- GraphQL on Workers isn't guaranteed to work yet; the REST and Local APIs are.

## Questions

If you have any issues or questions, reach out on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
