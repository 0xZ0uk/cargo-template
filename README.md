# Cargo Template

A Payload 4 + TanStack Start template that runs as a single Cloudflare Worker, with **D1** for the database and **R2** for media.

> [!IMPORTANT]
> Payload's TanStack Start adapter is only available in the Payload 4 beta. The Worker bundle is larger than the free plan's script-size limit, so deploying needs a paid Workers plan.

## Quick Start

### Development

1. `cp .env.example .env` and set `PAYLOAD_SECRET` (`openssl rand -hex 32`).
2. `pnpm install && pnpm dev`
3. Open `http://localhost:3000/admin` and create your first user.

`pnpm dev` runs TanStack's Node dev server. Wrangler's `getPlatformProxy` provides a local D1 database (stored in `.wrangler/state`). Payload pushes schema changes to it automatically, so you don't need migrations while you develop. Media uploads go to the local `media/` directory.

### Preview in the Workers runtime

`pnpm preview` builds the Worker and serves it from workerd at `http://localhost:4173`, with the same runtime and storage path as production. It uses a local D1 database and a local R2 bucket (no remote resources). Run `pnpm migrate` first so the local database has the schema.

## Deployment

Create the Cloudflare resources once:

```bash
pnpm wrangler login
pnpm wrangler d1 create cargo-template
pnpm wrangler r2 bucket create cargo-template-media
pnpm wrangler secret put PAYLOAD_SECRET
```

Copy the `database_id` printed by `d1 create` into [`wrangler.jsonc`](./wrangler.jsonc). If you rename the Worker, database or bucket, update the names there too, then run `pnpm cf-typegen`.

Whenever the Payload schema changes, create a migration and commit it:

```bash
pnpm migrate:create
```

Then deploy:

```bash
pnpm deploy
```

`pnpm deploy` applies migrations to the remote D1 database, runs `PRAGMA optimize`, builds the Worker and deploys it with Wrangler. If you add a named Wrangler environment, set `CLOUDFLARE_ENV` so the migration commands use the same bindings.

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

| Command               | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `pnpm dev`            | Node dev server with local D1 and local-disk media              |
| `pnpm build`          | Build the Worker and static assets                              |
| `pnpm preview`        | Build and run in local workerd (local D1 + R2)                  |
| `pnpm deploy`         | Migrate remote D1, build and deploy                             |
| `pnpm generate:types` | Regenerate Cloudflare (`cloudflare-env.d.ts`) and Payload types |
| `pnpm migrate:create` | Create a migration in `src/db/migrations`                       |
| `pnpm migrate`        | Apply migrations to the local D1 database                       |
| `pnpm migrate:remote` | Apply migrations to the remote D1 database                      |
| `pnpm test:int`       | Run Local API integration tests                                 |
| `pnpm lint`           | Run ESLint                                                      |

## How it works

### Runtime bindings

`src/payload.config.ts` imports its Cloudflare bindings from `#cloudflare-runtime`, which resolves to one of two modules:

- `src/runtime/cloudflare.ts` for builds and `pnpm preview`. It reads the bindings from `cloudflare:workers`.
- `src/runtime/node.ts` for `pnpm dev`, tests and the Payload CLI. It gets the bindings from Wrangler's `getPlatformProxy`. `migrate:remote` sets `PAYLOAD_MIGRATE_REMOTE=true`, which points D1 at the remote database. That's why D1 is marked `"remote": true` in `wrangler.jsonc`; dev and preview opt out of remote bindings, so they stay local.

`vite.config.ts` only adds `@cloudflare/vite-plugin` for builds and `pnpm preview`. A small build-only plugin bundles the packages Payload normally leaves external, because workerd has no Node module loader.

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- **Users (Authentication):** auth-enabled collection with access to the admin panel. See the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.
- **Media:** upload-enabled collection, stored in R2 in production. Cropping and focal points are disabled because they need `sharp`, which Workers can't run.
- **Folders / Tags:** used to organise media.

### Current limitations

- No image resizing or cropping on Workers (no `sharp`).
- GraphQL on Workers isn't guaranteed to work yet; the REST and Local APIs are.

## Questions

If you have any issues or questions, reach out on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
