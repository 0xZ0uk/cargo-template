# AI Agent

For any Payload-related work, reference the skill at `.claude/skills/payload/SKILL.md`.

## Monorepo

pnpm + Turborepo workspace. Run commands from the repo root.

- `apps/web` (`@cargo/web`): the Payload + TanStack Start app on Cloudflare Workers. App scripts run as `pnpm web <script>` from the root.
- Frontend UI is shadcn/ui on Base UI (`base-nova` style, `apps/web/components.json`). Add components with the pinned CLI, `pnpm web exec shadcn add <name>`, then format them with `pnpm web exec oxfmt src/components/ui`. Theme tokens live in `apps/web/src/app/_frontend/styles.css`; dark mode keys off Payload's `[data-theme='dark']`, not shadcn's `.dark` class. Base UI has no `asChild`: compose with the `render` prop (plus `nativeButton={false}` when the rendered element is not a `<button>`), and style links with `buttonVariants` rather than wrapping them in `Button`.
- `packages/*` (`@cargo/*`): in-house Payload plugins, built with tsup and consumed by the app as `workspace:*`. The SEO analyzer's admin UI must follow `packages/payload-seo-analyzer/src/ui/README.md`.
- `packages/onpage/*` (`@cargo/onpage-*`): our fork of payload-onpage, the on-page editor ("Edit on page"). The exception to tsup: its five packages build with `tsc -b` (one file per source keeps `'use client'` and the lazy editor chunk); tests, lint and typecheck run from `packages/onpage` (`@cargo/onpage`). Read `packages/onpage/README.md` before changing it: it lists what the fork changed from upstream and the invariants (visitors pay nothing, markers never persist, package boundaries).
- `payload`, `@payloadcms/*`, React and TypeScript versions come from the catalog in `pnpm-workspace.yaml` (`"catalog:"`). Change them there, never per package: two copies of `payload` / `@payloadcms/ui` break the admin. Lexical and TanStack Router/Start are in the catalog for the same reason (onpage shares them with the app); bump Lexical to whatever `@payloadcms/richtext-lexical` depends on.
- `payload` is patched (`patches/`, `patchedDependencies` in `pnpm-workspace.yaml`) so password hashes use at most 100,000 PBKDF2 iterations, the Workers limit; upstream uses 600,000 and admin login fails on a deployed Worker. When bumping `payload`, port the patch to the new version (`pnpm patch payload@<version>`) unless upstream has fixed it.

## Page blocks

Pages are built from section blocks in `apps/web/src/blocks/` (Hero, Pricing, FAQ…). Editors pick a block, choose a variant and fill in content, in the admin or with the on-page editor; nobody writes CSS. `RichText/` is the reference block: copy its shape.

- **One folder per block**, `src/blocks/<Name>/`:
  - `meta.ts`: slug, labels, picker group, `variants` and an `example`, via `defineBlockMeta<XBlock>()`. Client-safe: no Payload or Lexical runtime imports (type imports are fine), because the gallery imports it. Build rich text in examples with `../shared/lexical`. Leave uploads and relationships out of examples.
  - `thumbnail.ts`: a 480×320 SVG wireframe string for the block pickers (neutral greys, no text).
  - `config.ts`: `export const <Name>Config = defineBlock({ meta, interfaceName: '<Name>Block', thumbnail, fields })`. `defineBlock` adds the `variant` radio, the section settings, the picker group and thumbnail, the on-page example, and a row label on every array (the row's `title`, `name`, `question`… instead of "Item 01"; name your fields that way).
  - `Component.tsx`: `export const <Name>Block: React.FC<<Name>Block>` from `@/payload-types`. Render inside a `container` (or full-bleed when the variant calls for it). `RenderBlocks` wraps it in `<Section>`, which owns background, vertical spacing and the anchor id, so blocks never set their own outer padding or background.
- **Register** a new block in `src/blocks/index.ts` (configs), `components.ts` (components) and `gallery.ts` (metas). `components.ts` and `gallery.ts` are typed against the generated `Page` type, so a missing entry fails typecheck after `pnpm web generate:types`.
- **Shared fields** (`src/blocks/shared/fields.ts`): `headingFields()` (eyebrow, title, description; render with `@/components/SectionHeading`, `as="h1"` only in heroes), `mediaField()` (render with `@/components/Media/BlockMedia`, which shows a placeholder when empty), `iconField()` (render with `@/components/Icon`), `blockRichText()`, plus `link()` / `linkGroup()` from `src/fields` (render with `CMSLink`). Never make media required.
- **Variants, not knobs.** Each variant is a designed layout. No free colours, font sizes, spacing or class names in fields: colours come from the shadcn tokens, so blocks work in the `dark` section background without per-block dark styles.
- **Robust to empty data.** The admin's block drawer creates blocks with defaults only; every optional field, array and upload may be missing. Render what's there; skip what isn't.
- **On-page editing** maps strings to fields with invisible markers (`packages/onpage/docs/concepts/auto-mapping.md`). Render CMS strings as they are, each in its own element; use CSS for case and truncation; pass strings that go into attributes (`title`, `aria-label`, `alt`) or comparisons through `stegaClean` from `@cargo/onpage-core`.
- **shadcn components** come from the CLI (see above). Use them for buttons, cards, accordions and so on rather than hand-rolled markup.
- **Storage**: blocks are stored as JSON (`blocksAsJSON` in `payload.config.ts`), so new blocks and nested arrays add no D1 tables. A new block still changes the schema snapshot: run `pnpm web migrate:create`.
- **Check your work**: `pnpm web generate:types`, `pnpm web typecheck`, `pnpm web lint`, `pnpm web test:int` (`tests/int/blocks.int.spec.tsx` renders every block's example in every variant, and with empty data). With `pnpm web dev`, `/dev/blocks` shows every block (`?block=<slug>`, `?background=dark`).

## Cloudflare D1 / R2

The app runs on Cloudflare Workers with D1 (10 GB max per database) and R2. Keep D1 small:

- Files go to R2 (`@payloadcms/storage-r2`); never store file contents or large blobs in D1.
- Versions are capped by `limitVersions` in `apps/web/src/payload.config.ts`. Only override `maxPerDoc`/`max` with a reason.
- Analytics and events go to Workers Analytics Engine. Form submissions and logs go to R2 or a separate D1 database, not the main one.
- Bindings come from `#cloudflare-runtime` (`apps/web/src/runtime/`). Run `pnpm web cf-typegen` after editing `apps/web/wrangler.jsonc`.
- Env vars are declared in `apps/web/.env.schema` and loaded by [varlock](https://varlock.dev). Add new variables there (mark secrets `@sensitive`), not in `.dev.vars` or the Cloudflare dashboard, then run `pnpm web cf-typegen`. Deploy with `varlock-wrangler`, not `wrangler deploy`.
- The Socials plugin (`apps/web/src/plugins/socials.ts`) is `disabled` without `SOCIALS_ENCRYPTION_KEY`: same schema, but no admin components. Set the key whenever the import map is generated (`pnpm web generate:importmap`, `payload build`, CI sets a throwaway one; turbo's build task passes it through), or the committed map loses the Socials entries.
- After schema changes (including enabling plugin features that add collections), run `pnpm web migrate:create`, apply it with `pnpm web migrate` and commit the migration in `apps/web/src/db/migrations`. There is no dev schema push (`push: false`): the local D1 only changes through migrations.
- D1 ignores `PRAGMA foreign_keys=OFF`. A generated migration that rebuilds a table (`CREATE TABLE __new_x`, `DROP TABLE x`) runs the `ON DELETE` actions of every table referencing `x` (cascade-deleting locales, rels, focus keywords; nulling versions' `parent_id`), and fails on references without `ON DELETE`. Copy the child rows aside and restore them, as `20261105_163314_page_blocks.ts` does, and test on a local D1 with content.
