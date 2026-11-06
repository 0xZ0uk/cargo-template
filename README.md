# Cargo

A Payload 4 + TanStack Start template on Cloudflare Workers (D1 + R2), and the in-house Payload plugins it uses, in one pnpm + Turborepo workspace.

| Path | Package | What it is |
| --- | --- | --- |
| [`apps/web`](apps/web) | `@cargo/web` | The template app: Payload admin + TanStack Start frontend, deployed as one Worker. See its [README](apps/web/README.md). |
| [`packages/payload-seo-analyzer`](packages/payload-seo-analyzer) | `@cargo/payload-seo-analyzer` | SEO analysis plugin (Payload 4 port of `@consilioweb/payload-seo-analyzer`). See its [README](packages/payload-seo-analyzer/README.md). |
| [`packages/payload-plugin-socials`](packages/payload-plugin-socials) | `@cargo/payload-plugin-socials` | Social publishing to Pinterest, Instagram, Facebook Pages and Google Business Profile (Payload 4 port of `payload-plugin-socials`). Not registered in the app yet. See its [README](packages/payload-plugin-socials/README.md). |
| [`packages/payload-plugin-ab`](packages/payload-plugin-ab) | `@cargo/payload-plugin-ab` | A/B testing: page variants with traffic shares in the admin, and a framework-agnostic request resolver (Payload 4 port of `@focus-reactive/payload-plugin-ab`). Registered on Pages; `loadPage` routes visitors. See its [README](packages/payload-plugin-ab/README.md). |
| [`packages/payload-plugin-assistant`](packages/payload-plugin-assistant) | `@cargo/payload-plugin-assistant` | Admin assistant: chat with the content through the MCP tools (TanStack AI + OpenRouter, a Durable Object per conversation). Scaffold only: the chat endpoint answers 501. Not registered in the app yet. See its [README](packages/payload-plugin-assistant/README.md). |

## Quick start

```sh
echo "PAYLOAD_SECRET=$(openssl rand -hex 32)" > apps/web/.env.development.local
pnpm install
pnpm web migrate
pnpm dev
```

`pnpm web migrate` builds the local D1 database from the committed migrations; run it again after pulling new ones. `pnpm dev` builds the plugins once, keeps them rebuilding on change (`tsup --watch`), and starts the app at `http://localhost:3000`.

## Commands

| Command | Runs |
| --- | --- |
| `pnpm dev` | Plugins in watch mode + the app's dev server |
| `pnpm build` | `build` in every package, plugins first |
| `pnpm typecheck` / `pnpm lint` | Across all packages |
| `pnpm test` | Plugin unit tests + the app's integration and e2e tests |
| `pnpm test:int` | The app's Local API integration tests |
| `pnpm web <script>` | Any app script, e.g. `pnpm web migrate:create`, `pnpm web run deploy` (`run` is needed: `deploy` is also a pnpm command), `pnpm web generate:importmap` |
| `pnpm --filter @cargo/payload-seo-analyzer <script>` | Any plugin script |

Turbo caches `build`, `typecheck` and `lint`; anything that depends on a plugin builds it first (`dependsOn: ["^build"]`).

## Workspace conventions

- **Shared versions live in the pnpm catalog** (`pnpm-workspace.yaml`): `payload`, every `@payloadcms/*` package, React and TypeScript. Packages reference them as `"catalog:"`. Upgrade Payload by editing the catalog once. Keeping them shared also guarantees one copy of `payload` and `@payloadcms/ui` at runtime; two copies break the admin's React contexts.
- **Plugins** go in `packages/<name>`, named `@cargo/<name>`, `"private": true`, built with tsup to `dist/`, and consumed by the app as `"workspace:*"`. Declare `payload` / `@payloadcms/ui` / `react` as peer dependencies and take the dev versions from the catalog.
- **Plugin admin UI** follows [`packages/payload-seo-analyzer/src/ui/README.md`](packages/payload-seo-analyzer/src/ui/README.md): `@payloadcms/ui` components and Payload 4 tokens only.
- **Upstream code** imported with `git subtree` keeps its history. Pull upstream fixes with `git subtree pull --prefix=packages/<name> <repo-url> <branch>`.

## CI and code review

- **CI** (`.github/workflows/ci.yml`) runs on every PR and push to `master`.
  - The checks job runs lint, typecheck, the plugin's unit tests, the app's integration tests and the production build. It also fails when the Payload schema changed without a migration, or when the import map or generated types are stale.
  - The e2e job migrates a fresh local D1 and runs the Playwright suite (frontend, admin and SEO views).
  - It needs no secrets.
- **Reviews:** [Pullfrog](https://docs.pullfrog.com) reviews PRs with DeepSeek V4.1 Flash on OpenCode Go (`.github/workflows/pullfrog.yml`). Its instructions and console setup are in [`.github/pullfrog/`](.github/pullfrog/README.md).
- Workflow actions are pinned to commit SHAs, and Dependabot bumps them.
