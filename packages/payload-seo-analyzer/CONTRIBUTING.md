# Contributing to @consilioweb/seo-analyzer

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/pOwn3d/payload-seo-analyzer.git
cd payload-seo-analyzer
pnpm install
pnpm build
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build with tsup (ESM + CJS + types) |
| `pnpm test` | Run tests with vitest |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | TypeScript type checking |

## Project Structure

```
src/
├── index.ts              # Main entry (plugin, analyzer, types, helpers)
├── client.ts             # Client entry (React components)
├── views.ts              # Server views entry (admin pages)
├── plugin.ts             # Payload plugin registration
├── analyzer.ts           # Core SEO analysis engine
├── rules/                # SEO rule implementations (17 groups)
├── components/           # React components (dashboard, sidebar, meta fields)
├── endpoints/            # REST API endpoint handlers
├── hooks/                # Payload hooks (auto-redirect, score tracking)
├── helpers/              # Utility functions
├── i18n.ts               # Analysis engine strings (English)
├── dashboard-i18n.ts     # Dashboard UI strings (English, ~500 strings)
├── translations.ts       # Meta field labels (Payload plugin-seo languages)
└── types.ts              # TypeScript type definitions
```

## Guidelines

- **TypeScript** — All code must be typed, no `any` unless strictly necessary
- **No dependencies** — The plugin has zero runtime dependencies (only peer deps)
- **Backward compatibility** — The package is private and consumed only by `apps/web`; exports can change, as long as the app is updated in the same change
- **Strings** — All user-facing strings are English and live in `i18n.ts` / `dashboard-i18n.ts`
- **Tests** — Add tests for new rules or helpers

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run `pnpm build && pnpm test`
5. Commit using [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`)
6. Open a Pull Request

## Reporting Bugs

Use the [bug report template](https://github.com/pOwn3d/payload-seo-analyzer/issues/new?template=bug_report.yml) on GitHub Issues.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
