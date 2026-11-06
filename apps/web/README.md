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

If you rename the Worker, database or bucket, update the names in `wrangler.jsonc` (and in the `r2:lifecycle` script) too, then run `pnpm cf-typegen`. The assistant's `ASSISTANT_SELF` service binding names the Worker itself (`"service": "cargo-template"`), so it must follow a rename. The `ratelimits` bindings in `wrangler.jsonc` use account-wide `namespace_id`s: give each Worker on the account its own ids, or they share counters. Workers Rate Limiting is approximate (counts sync between machines eventually), so a burst can get past the limit.

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

The assistant's two Durable Object classes (`AssistantConversation`, `AssistantConversationIndex`, re-exported from `src/server.ts`) are declared in the `exports` field of `wrangler.jsonc`, Wrangler's declarative replacement for the `migrations` array. The first `pnpm run deploy` creates their namespaces (SQLite storage); there's nothing to create by hand. Keep in mind:

- Durable Object classes are created and deleted only by `wrangler deploy`. `wrangler versions upload` refuses a config with `exports` entries, so gradual deployments and preview (version) URLs aren't available for this Worker.
- Rollbacks can't cross a lifecycle change (adding, renaming or deleting a class).
- Once deployed with `exports`, the Worker can't go back to `migrations`. Removing a class means marking it `"state": "deleted"`, which deletes all of its data.
- An object's storage type (SQLite) is fixed once its namespace exists.

`pnpm run deploy` (not `pnpm deploy`, which is pnpm's own command) applies migrations to the remote D1 database, runs `PRAGMA optimize`, builds the Worker with `APP_ENV=production` and deploys it with `varlock-wrangler`. Non-sensitive values become Worker vars and sensitive ones become secrets. `varlock-wrangler deploy` replaces the Worker's vars and secrets with the schema's, so define any new ones in `.env.schema` rather than the dashboard. The build fails if `PAYLOAD_SECRET` doesn't resolve for production. If you add a named Wrangler environment, set `CLOUDFLARE_ENV` so the migration commands use the same bindings.

### Deploying to staging

Deploy-only behaviour (the assistant's Durable Objects, the `ASSISTANT_SELF` service binding, Workers Rate Limiting) can't be tried on a preview URL: `wrangler versions upload` refuses a config with Durable Object `exports`. Use the `staging` Wrangler environment instead: a second Worker, `cargo-template-staging` on `workers.dev`, with its own D1 databases, R2 bucket, Durable Object namespaces, rate-limit counters (`namespace_id` 1101–1105) and Analytics Engine datasets (`cargo_ab_staging`, `cargo_assistant_audit_staging`). Production's resources are never referenced by it. Its `ASSISTANT_SELF` binding points at `cargo-template-staging`, so the assistant's tool calls stay on staging.

Create the resources once, in the account that holds production, and put the printed `database_id`s in `env.staging.d1_databases` in `wrangler.jsonc`:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id>   # `wrangler whoami`; needed when the login sees several accounts
pnpm wrangler d1 create cargo-template-staging
pnpm wrangler d1 create cargo-template-seo-staging
pnpm wrangler r2 bucket create cargo-template-media-staging
pnpm r2:lifecycle:staging
```

Staging has its own `APP_ENV`, so varlock reads its values from `.env.staging.local` (gitignored), not production's:

```bash
echo "PAYLOAD_SECRET=$(openssl rand -hex 32)" > .env.staging.local
echo "OPENROUTER_API_KEY=..." >> .env.staging.local   # optional: the assistant and SEO AI features
```

Keep that `PAYLOAD_SECRET` for later deploys (a new one logs everyone out and invalidates API keys). Never set `ASSISTANT_TEST_MODEL` there; `APP_ENV=staging` ignores it anyway. Then deploy:

```bash
pnpm run deploy:staging
```

It runs `migrate:staging` and `seo-store:migrate:staging` (the Payload CLI and the SEO store against the staging D1s, through `CLOUDFLARE_ENV=staging`), `PRAGMA optimize`, then builds with `APP_ENV=staging CLOUDFLARE_ENV=staging` and deploys with `varlock-wrangler deploy`. The Cloudflare Vite plugin writes the staging environment, flattened, into `dist/server/wrangler.json`, which `wrangler deploy` picks up, so the deploy step takes no `--env`. The first deploy creates the Durable Object namespaces. Open `/admin` on the printed URL to create the first user. The cron trigger runs on staging too.

To remove staging, delete the Worker (which deletes its Durable Objects) and the resources: `pnpm wrangler delete --name cargo-template-staging`, `pnpm wrangler d1 delete cargo-template-staging`, `pnpm wrangler d1 delete cargo-template-seo-staging`, then empty and delete the bucket (`pnpm wrangler r2 bucket delete cargo-template-media-staging`).

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

Short-lived, event-shaped audit trails can go to Analytics Engine too (the assistant's write log does, see [Assistant](#assistant)); its data is kept 3 months, so archive to R2 what must last longer.

## Useful commands

Run these inside `apps/web`, or from the repo root as `pnpm web <command>` (e.g. `pnpm web migrate:create`).

| Command                   | Purpose                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                | Node dev server with local D1 and local-disk media                                                                    |
| `pnpm build`              | Build the Worker and static assets                                                                                    |
| `pnpm preview`            | Build and run in local workerd (local D1 + R2)                                                                        |
| `pnpm run deploy`         | Migrate remote D1, build and deploy                                                                                   |
| `pnpm run deploy:staging` | The same for the staging Worker (see Deploying to staging)                                                            |
| `pnpm r2:lifecycle`       | Add the R2 rule that expires stale SEO cache objects                                                                  |
| `pnpm generate:types`     | Regenerate Cloudflare (`cloudflare-env.d.ts`) and Payload types                                                       |
| `pnpm migrate:create`     | Create a migration in `src/db/migrations`                                                                             |
| `pnpm migrate`            | Apply migrations to the local D1 database                                                                             |
| `pnpm migrate:remote`     | Apply migrations to the remote D1 database                                                                            |
| `pnpm test:int`           | Run Local API integration tests                                                                                       |
| `pnpm test:e2e`           | Run Playwright against `pnpm dev` (`E2E_PORT`, default 3000; `E2E_BASE_URL` for a server you started on the local D1) |
| `pnpm lint`               | Run ESLint                                                                                                            |

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

A/B measurement (`src/plugins/abMeasurement.ts`) writes to Workers Analytics Engine (`AB_ANALYTICS`, dataset `cargo_ab` in `wrangler.jsonc`; no personal data). `loadPage` counts an **impression** once per visitor, experiment run and bucket (an HttpOnly `payload_ab_seen_<path>` cookie holding `<bucket>:<run>` marks the visitor as counted, so server-function re-runs on client navigation don't add more; the run's start comes from the manifest entry, so this costs no extra read), and a click on a **call-to-action** block's link posts a **conversion** to `/api/_ab/convert`, which reads the bucket from the visitor's cookies and counts once per visitor, run and bucket too. That endpoint is unauthenticated, so it's rate-limited per client IP (`AB_RATE_LIMIT_CONVERT` in `wrangler.jsonc`, 20 a minute; over that it answers 429 and records nothing). An experiment's run ends when its page has no published variant left; publishing one again starts a new run, counted from then. The Variants panel shows impressions, conversions and rate per bucket since the experiment started, read through the Analytics Engine SQL API: set `AB_ANALYTICS_ACCOUNT_ID` and `AB_ANALYTICS_API_TOKEN` (a token with only "Account Analytics: Read"); without them the panel says measurement isn't configured. Analytics Engine keeps 90 days of data, so an experiment older than that only counts its last 90 days. Local dev stores nothing (no real dataset).

**GA4 (optional, next to Analytics Engine).** Set `GA_MEASUREMENT_ID` (a `G-XXXXXXXXXX` id from Google Analytics > Admin > Data streams; it's public, not a secret: set it in `.env.production`, like `SITE_URL`) and public pages load gtag.js (`async`, from `https://www.googletagmanager.com/gtag/js?id=…`) through the page's `<head>` (`gtagScripts` in `src/utilities/googleAnalytics.ts`); a page that runs an experiment also renders the plugin's `<ExperimentTracker>`, which tags GA4 events with the experiment, the visitor's bucket and their visitor id. Unset, nothing GA-related renders or loads: no script tag, no inline snippet, no request. `loadPage` returns the id as `gaMeasurementId`, and `null` for every draft (live preview, on-page editing, preview links) and for 404s and redirects, so those never load it; the admin isn't a frontend route and never does. Create these **event-scoped custom dimensions** in GA4 (Admin > Custom definitions) to report on them; the parameter names are what the tracker sets:

| Dimension name | Event parameter                                                |
| -------------- | -------------------------------------------------------------- |
| A/B experiment | `fr_ab_experiment` (the page's path, e.g. `/pricing`)          |
| A/B variant    | `fr_ab_variant` (the bucket: `original` or the variant's slug) |
| A/B visitor ID | `fr_ab_visitor_id`                                             |

The tracker reads the experiment (`exp_<path>`) and visitor id (`ab_visitor_id`) cookies the A/B resolver already sets; they aren't HttpOnly, and nothing is added to the page for it beyond the experiment's path. The bucket and visitor id go to GA4 as `fr_ab_*` parameters, so mention them in your privacy policy and consent flow: this template adds no consent banner, so gate `GA_MEASUREMENT_ID` on your own consent requirements. On a full page load the first page view carries the dimensions (`GoogleAnalyticsConfig` sends GA4's `config` after the tracker's `set`, and gtag runs its queue in order); on client-side navigation the tracker sets them again when an experiment page mounts, and they apply to the events GA4 sends after that. GA4 and Analytics Engine **don't count the same thing**: GA4 counts events, users and sessions (every page view, filtered by its own consent, ad-blockers and sampling), while Analytics Engine counts one impression per visitor, experiment run and bucket, and one conversion per visitor, run and bucket, server-side and unaffected by blockers. Expect GA4 numbers to be larger for views and smaller for users, and don't compare the two directly.

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

### Assistant

[`@cargo/payload-plugin-assistant`](../../packages/payload-plugin-assistant) adds a chat at `/admin/assistant` ("Assistant › Chat" in the admin sidebar) that reads and edits content through the MCP tools above, **as the signed-in admin user**: Payload's access control applies to every call. It runs on [OpenRouter](https://openrouter.ai). Registered in `src/payload.config.ts`, after `mcpPlugin`.

**The key.** Create a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) and set it as `OPENROUTER_API_KEY` (`.env.development.local` for `pnpm dev`, `.env.production.local` or CI for deploys; it's `@sensitive`, so `varlock-wrangler deploy` uploads it as a Worker secret). The SEO analyzer's AI features use the same key. **Give the key a credit limit in OpenRouter**: that is the real cap on spend. The per-user daily budget and the rate limit below come on top of it. Without a key, the view and the endpoints still exist and say the assistant isn't configured; nothing else changes (the schema, the import map and CI don't need it).

**Models.** The allowlist is one model, DeepSeek V4.1 Flash (`deepseek/deepseek-v4.1-flash`), which is also the default. It handles tool calls well and is cheap: a turn is usually 2–4 model calls of about 10,000 prompt tokens each (mostly the tool definitions, which OpenRouter caches between calls). When the plugin was built, such turns measured around $0.0002–$0.001. Check [the model's page](https://openrouter.ai/deepseek/deepseek-v4.1-flash) for current prices. To offer more models, add `{ id, label }` entries to `models` (any OpenRouter model that supports tool calling and `data_collection: deny`; the picker appears with two or more). Requests are routed with `require_parameters` and `data_collection: deny`, so drafts never reach providers that log or train on prompts.

**Approvals.** Reads (find, count, schemas) run without asking. Every write (create, update, delete, duplicate, restore) pauses on a card that shows the change field by field against the current document. Nothing is written until you approve; a rejection, with an optional reason, goes back to the model. The assistant saves drafts and only publishes when asked to in so many words.

**Rich text as Markdown.** Pages and reusable sections (through their blocks) and Media's caption are registered with `withMarkdownRichText` in `mcpPlugin`: `findDocuments` returns their rich text as Markdown, and the assistant changes a rich text field with `setRichTextFromMarkdown` (a data path such as `layout.2.richText` plus the whole new Markdown, saved as a draft). Its approval card shows the field's text before and after. This applies to external MCP clients too. The app's editors keep paragraphs, headings (the levels each block allows), bold, italic and links to URLs; they have no list feature, so Markdown lists are kept as plain text (the tool says so). Underline, alignment, internal links to pages and new-tab links can't be expressed in Markdown: when a field holds them the tool refuses until the editor agrees to lose them. A new collection with rich text should get `withMarkdownRichText` too (`tests/int/assistantRichText.int.spec.ts` fails otherwise).

**Conversations live in Durable Objects, not D1.** One `AssistantConversation` per conversation keeps its transcript, runs, pending approvals and stream log in its own SQLite, and runs the chat turn itself, so a reply survives a closed tab and a reload rejoins it. One `AssistantConversationIndex` per user lists their conversations. Conversations idle for 30 days are deleted. The conversation object calls this Worker's own `/api/mcp` through the `ASSISTANT_SELF` service binding with the user's session cookie. `pnpm dev` can't run Durable Objects that the Worker defines itself, so the Node dev server keeps conversations in memory (lost on restart; `src/plugins/assistant.ts`). Use `pnpm preview` to exercise the real objects. Wrangler's proxy also warns on every Node start that the two classes aren't exported; that warning is harmless.

**Daily budget.** Each admin user may spend $5 of OpenRouter cost per UTC day (`budget` in `src/payload.config.ts`), counted from the cost OpenRouter reports for every model call and stored in the user's index Durable Object. Once it is used up, a message or an approval answer gets "You have used today's assistant budget" until midnight UTC; a reply already running finishes, so the last one may go a little over. The chat header shows what is left today and what the open conversation has cost, and the list shows each conversation's cost. The key's credit limit in OpenRouter still caps the whole account.

**Hidden fields.** The model never sees users' email, API key, sessions or auth state (password hash, reset and verification tokens, lockout): the plugin removes them from every tool result, from what conversations store and from the current values on approval cards, for every auth collection. Add other fields with the plugin's `redact` option (`{ slug: ['field', 'group.field'] }`; arrays and blocks rows are walked).

**Audit log.** Every write the assistant applies (user, tool, collection, document id, conversation, model; no content) is one data point in the `cargo_assistant_audit` Analytics Engine dataset (`ASSISTANT_AUDIT` in `wrangler.jsonc`; `cargo_assistant_audit_staging` on staging). Reads, rejected changes and failed writes aren't logged. The conversation Durable Object writes them on Workers (the `AssistantConversation` subclass in `src/server.ts`), the plugin's `audit` option under `pnpm dev`. Query it with the [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/): `SELECT timestamp, blob1 AS user, blob2 AS tool, blob3 AS collection, blob4 AS document, blob5 AS conversation FROM cargo_assistant_audit ORDER BY timestamp DESC`. Analytics Engine keeps data for 3 months.

**Rate limit.** `ASSISTANT_RATE_LIMIT` (`wrangler.jsonc`, `namespace_id` 1005) allows 20 chat turns per minute per admin user, where a turn is a message or an approval answer. It's wired to the plugin's `rateLimit` hook in `src/plugins/assistantRateLimit.ts`. Without the binding there's no limit.

**Tests.** `tests/e2e/assistant.e2e.spec.ts` sends a message, approves and rejects an update to a draft page, and rewrites a paragraph of a Rich text block from Markdown. It needs no key: `playwright.config.ts` starts the dev server with `ASSISTANT_TEST_MODEL=1`, which turns on the plugin's scripted test model. Only requests to `localhost` use it, and `APP_ENV=production` or `staging` ignores the flag, so a deployed Worker always uses OpenRouter.

### Current limitations

- No image resizing or cropping on Workers (no `sharp`).
- Payload is patched (`patches/` at the repo root) to hash passwords with 100,000 PBKDF2 iterations instead of 600,000, because deployed Workers reject anything higher. Without the patch, every admin login fails as "incorrect password" on a deployed Worker, even though it works in `pnpm dev` and `pnpm preview`. A hash made by unpatched Payload only verifies under Node. To fix one, set that password again through the Local API in a `pnpm web payload run` script with `PAYLOAD_MIGRATE_REMOTE=true`, which writes a new 100k hash to the remote database.
- GraphQL on Workers isn't guaranteed to work yet; the REST and Local APIs are.

## Questions

If you have any issues or questions, reach out on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
