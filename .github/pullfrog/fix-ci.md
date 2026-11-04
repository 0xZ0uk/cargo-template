CI is `.github/workflows/ci.yml`. Reproduce with the same commands from the repo root (`pnpm lint`, `pnpm typecheck`, `pnpm --filter @cargo/payload-seo-analyzer test`, `pnpm --filter @cargo/onpage test`, `PAYLOAD_SECRET=test-secret pnpm web test:int`, `pnpm build`).

- Never weaken an assertion, skip a test or loosen a CI step to make it pass.
- "Generated files are stale": run `pnpm web generate:importmap` and `pnpm web generate:types` and commit the output; don't hand-edit generated files.
- "Schema changed without a migration": run `pnpm web migrate:create <name>` and commit the new migration. Never edit a migration that's already on `master`.
- E2E failures: the specs start `vite dev` on a fresh local D1. If the failure is flaky (SQLite `database is locked` between the dev server and the test process), say so and change nothing.
