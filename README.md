# Cargo

A Payload 4 + TanStack Start template on Cloudflare Workers (D1 + R2), and the in-house Payload plugins it uses, in one pnpm + Turborepo workspace.

| Path | Package | What it is |
| --- | --- | --- |
| [`apps/web`](apps/web) | `@cargo/web` | The template app: Payload admin + TanStack Start frontend, deployed as one Worker. See its [README](apps/web/README.md). |
| [`packages/payload-seo-analyzer`](packages/payload-seo-analyzer) | `@cargo/payload-seo-analyzer` | SEO analysis plugin (Payload 4 port of `@consilioweb/payload-seo-analyzer`). See its [README](packages/payload-seo-analyzer/README.md). |

## Quick start

```sh
echo "PAYLOAD_SECRET=$(openssl rand -hex 32)" > apps/web/.env.development.local
pnpm install
pnpm dev
```

`pnpm dev` builds the plugins once, keeps them rebuilding on change (`tsup --watch`), and starts the app at `http://localhost:3000`.

## Commands

| Command | Runs |
| --- | --- |
| `pnpm dev` | Plugins in watch mode + the app's dev server |
| `pnpm build` | `build` in every package, plugins first |
| `pnpm typecheck` / `pnpm lint` | Across all packages |
| `pnpm test` | Plugin unit tests + the app's integration and e2e tests |
| `pnpm test:int` | The app's Local API integration tests |
| `pnpm web <script>` | Any app script, e.g. `pnpm web migrate:create`, `pnpm web deploy`, `pnpm web generate:importmap` |
| `pnpm --filter @cargo/payload-seo-analyzer <script>` | Any plugin script |

Turbo caches `build`, `typecheck` and `lint`; anything that depends on a plugin builds it first (`dependsOn: ["^build"]`).

## Workspace conventions

- **Shared versions live in the pnpm catalog** (`pnpm-workspace.yaml`): `payload`, every `@payloadcms/*` package, React and TypeScript. Packages reference them as `"catalog:"`. Upgrade Payload by editing the catalog once. Keeping them shared also guarantees one copy of `payload` and `@payloadcms/ui` at runtime; two copies break the admin's React contexts.
- **Plugins** go in `packages/<name>`, named `@cargo/<name>`, `"private": true`, built with tsup to `dist/`, and consumed by the app as `"workspace:*"`. Declare `payload` / `@payloadcms/ui` / `react` as peer dependencies and take the dev versions from the catalog.
- **Plugin admin UI** follows [`packages/payload-seo-analyzer/src/ui/README.md`](packages/payload-seo-analyzer/src/ui/README.md): `@payloadcms/ui` components and Payload 4 tokens only.
- **Upstream code** imported with `git subtree` keeps its history. Pull upstream fixes with `git subtree pull --prefix=packages/<name> <repo-url> <branch>`.
