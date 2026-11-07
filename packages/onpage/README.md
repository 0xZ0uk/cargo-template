# onpage: on-page editing for Shipment

Shipment's fork of [payload-onpage](https://github.com/jellologic/payload-onpage) (MIT, by jellologic): editors press **Edit on page** in the admin, click the text, images and sections they see on the live page, and change them in place. Edits autosave as Payload drafts through Payload's REST API, so access control, hooks, validation, drafts and versions behave as in the admin. **Share** (or **Copy preview link** in the admin) makes a signed, expiring link that shows one page's draft to anyone holding it.

Forked from upstream `91b6117` (v0.7.0, 2026-10-25). Diff against that commit to see what we changed, or to pick up upstream fixes.

## Packages

| Package                        | Path              |                                                                                                            |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `@shipment/onpage-core`           | `core/`           | Framework-free: refs, schema, autosave, session, stega markers, sealing, ports. `/payload`: REST adapters. |
| `@shipment/onpage-plugin`         | `plugin/`         | Payload plugin: `/api/onpage/*` endpoints, access, marker hooks, preview tokens. `/admin`: admin controls. |
| `@shipment/onpage-react`          | `react/`          | Editor UI: overlay, dock, panels, field editors, annotations, client mode.                                 |
| `@shipment/onpage-lexical`        | `lexical/`        | Inline rich-text editing on Payload's Lexical JSON (the editor loads on first use).                        |
| `@shipment/onpage-tanstack-start` | `tanstack-start/` | `<OnPage />`, the cookie session (`/session`), the router-invalidate renderer.                             |

All are private workspace packages. `packages/onpage` itself is the private `@shipment/onpage` package that owns the shared tests, lint and type checks.

## What the fork changed

- **Dropped the Next.js adapter** (`@payload-onpage/next`) and Payload 3 support. Renamed `@payload-onpage/*` to `@shipment/onpage-*`.
- **Payload 4.0.0-beta.6** (upstream tests beta.0–beta.4):
  - `blockReferences` is gone from blocks fields; shared blocks are listed by slug in `blocks`. The schema serializer and conditions walker read `blocks` only.
  - Globals take document controls under `admin.components.edit` (like collections), not `admin.components.elements`.
  - `@payloadcms/ui`'s `Button` lost the `subtle` style; "Copy preview link" uses `ghost`.
  - The Local API now defaults to `overrideAccess: false`. Every call in the plugin already passes it explicitly; the integration tests' seeding now does too.
- **Lexical 0.53** (Payload beta.6's version; upstream allows `~0.50 || ~0.52`). Peers and dev dependencies come from the workspace catalog.
- **Tooling**: pnpm + Turborepo instead of Bun + changesets. Packages still build with `tsc -b` (one output file per source, which keeps `'use client'` directives and the lazy editor chunk), not tsup.
- **`previewGrantFor(pathname)`** (`@shipment/onpage-tanstack-start/session`): the document a live preview-link grant shares at a server-derived path. Unlike `isDraftEnabled()` it doesn't depend on the request URL, so it holds when a route loader re-runs as a server-function call; callers read the returned document by id (see the app's `loadPage`).
- **Link viewers' full-page navigation uses `location.replace`**: the router has already pushed the entry, and `assign` added a second one, so Back took two presses.
- **`hideEditWhen`** (per collection/global option): the admin hides **Edit on page** while the open document has a value in the named field. The app uses it to hide the control on A/B variants (`_abVariantOf`), which the Variants panel edits.
- **Docs** trimmed to what applies here (`docs/`); screenshots, the Next guides and the upstream issue links are gone.

## Commands

From the repo root:

```bash
pnpm turbo run build --filter='./packages/onpage/*'   # tsc -b → <package>/dist
pnpm --filter @shipment/onpage test                       # Vitest, against source (unit, component, Payload on in-memory SQLite)
pnpm --filter @shipment/onpage typecheck                  # sources and tests
pnpm --filter @shipment/onpage lint                       # ESLint, including the package-boundary rules
pnpm --filter @shipment/onpage format                     # Prettier (this fork keeps upstream's style)
```

The app's end-to-end spec is `apps/web/tests/e2e/onpage.e2e.spec.ts` (visitors, "Edit on page", a rich-text edit saved as a draft, preview links).

## How the app uses it

- `apps/web/src/payload.config.ts`: `onpage({ collections: { pages: { url, hideEditWhen: '_abVariantOf' } }, session: tanstackSession({ secret }) })`. Pages only: Header and Footer have no drafts, so edits there would publish at once. `comments` and `patterns` stay off; each adds a collection to the main D1. Without them the plugin adds no schema, so no migration.
- `apps/web/src/app/_frontend.tsx`: `<OnPage />` in the frontend layout.
- `apps/web/src/app/_frontend/pages.functions.ts`: draft reads. Logged-in users see drafts with `?draft=true` (live preview) or in edit mode, read with their own access. Preview-link viewers have no Payload user: `previewGrantFor(pagePath(slug))` returns the granted document when the grant was made for this page's path, and the loader reads that document by id with `overrideAccess` (that query only). A page that later takes over the slug isn't covered. `onpageContext()` adds the field markers in edit mode. `PageTemplate` mounts Payload's live-preview listener only for the admin's `?draft=true` flow: it re-runs the loader on mount.
- `apps/web/vite.config.ts`: Lexical in `optimizeDeps.include`, so `vite dev` doesn't re-bundle and reload when an editor first opens a rich-text field.

## Invariants (from upstream; don't break these)

1. **Visitors pay nothing.** No extra markup or requests without the hint cookie; annotations return `{}` when disabled.
2. **Markers never persist.** `stripMarkers` runs on `beforeValidate` and `beforeChange`; only reads with `context.onpage` get markers.
3. **Authorization goes through `plugin/src/access.ts`** (Payload's access operations). Every endpoint that changes state calls `rejectCrossSite` and an access check.
4. **Package boundaries** (lint-enforced): core imports no framework; react/lexical import no TanStack or Payload; plugin imports React only in `admin/`.
5. **Sources import siblings with `.ts`/`.tsx` extensions** (rewritten to `.js` by `tsc`).
6. **Every UI string goes through `t()`** (`react/src/messages.ts`); interactive UI uses `Dialog` and keeps WCAG AA contrast.

## Known gaps

- **Not yet tried on a deployed Worker.** The e2e spec passes on `vite dev` and on `vite preview` (workerd, local D1). A deployed Worker adds HTTPS (`Secure` cookies) and real isolates.
- **`serverURL` warning.** In production the plugin warns once per isolate when Payload's `serverURL` is unset. Without it, the plugin uses the request's origin, which is correct on Workers.
- **Edit-mode markers reach `<title>` and JSON-LD.** Only editors see them, and they're invisible.
- **Size budgets.** Upstream checks bundle sizes with size-limit (visitor mount < 1.5 KB). Not ported yet.
