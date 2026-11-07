# @shipment/onpage-core

## 0.7.0

### Minor Changes

- Compatibility with payload 4.0.0-beta.4, proven by the nightly TanStack example run: the example's Payload REST route now calls `handleAPIRoute` directly (the `payloadApiHandlers` helper was removed in 4.0.0-beta.4; `handleAPIRoute` exists since 4.0.0-beta.0), and the "Upcoming Payload" workflow regenerates the example's import map for each Payload version it tests, since Payload renames its admin components between releases (`RecentlyViewedWidget` became `ActivityWidget` in 4.0.0-beta.4).

## 0.6.1

No changes in this release.

## 0.6.0

### Minor Changes

- [#23](https://github.com/jellologic/payload-onpage/pull/23) [`7e5837c`](https://github.com/jellologic/payload-onpage/commit/7e5837ce684a9312ce29bd00066d18c4bf9fdba5) Thanks [@jellologic](https://github.com/jellologic)! - Editor UI:

  - **Alt text:** uploading an image asks for its alt text first; it used to be taken from the filename ("IMG 2034"). The current image's alt text can be changed in the image editor; it's saved on the media document. New optional `MediaLibrary.updateAlt`, implemented by `payloadUploads()`.
  - **`uiLocale`** (on `<OnPage>`, `OnPageEditor` and `PreviewToolbar`): the language of your `messages`. Plurals, relative times and dates follow it rather than the browser's language. Default `"en"`.
  - **Plural forms:** a message with `{count}` can have a form per plural category, such as `'dock.documents.one'`.
  - **Shortcut hints** match the platform: `⌘Z` on Apple devices, `Ctrl+Z` elsewhere. `row.delete` now takes an `{undo}` variable.

- [#36](https://github.com/jellologic/payload-onpage/pull/36) [`7c1c9d7`](https://github.com/jellologic/payload-onpage/commit/7c1c9d735067a20520921eea65fb6f75dda9f73d) Thanks [@jellologic](https://github.com/jellologic)! - - **Writing assistant** (`assist`, an `AssistPort` you implement; no AI vendor is bundled): **✨** on text fields offers Shorter, Clearer, Friendlier, Fix spelling, or your own instruction. The answer replaces the text, still uncommitted. Pass it from your client mount. The examples include a signed-in-only endpoint that uses Claude when `ANTHROPIC_API_KEY` is set.
  - **`@shipment/onpage-core/testing`:** `memoryDataSource()`, an in-memory `DataSource` for testing custom editors and pages. It applies saves, checks for stale writes, and records saves.

- [#29](https://github.com/jellologic/payload-onpage/pull/29) [`9748d89`](https://github.com/jellologic/payload-onpage/commit/9748d8942bae6c89b0927f909c28c512eee464c3) Thanks [@jellologic](https://github.com/jellologic)! - **Comments and review requests** (opt-in: `comments: true`, or `{ guests: true }`):

  - **Editors** comment on a page or on the selected section, resolve and reopen comments, and **request a review**. That calls your `onReviewRequest` with a fresh share link to the draft, so you can notify reviewers. Comments are kept in an `onpage-comments` collection the plugin adds (generate a migration).
  - **Share-link viewers** (with `guests`) can comment on the page they were sent, quoting selected text. The plugin takes the page from their sealed grant, keeps the text short, and caps comments per link.
  - Editors who can't publish see Publish turned off, with a pointer to **Request review**. `DocumentSchema.canPublish` comes from the same check Payload's scheduler makes.

  New: plugin endpoints under `/onpage/comments` and `/onpage/review`; `DataSource.listComments`, `addComment`, `resolveComment` and `requestReview`; `PageComment`; `PreviewGrant.id`; and `commentsHref` on `PreviewToolbar`.

- [#27](https://github.com/jellologic/payload-onpage/pull/27) [`c6ebef6`](https://github.com/jellologic/payload-onpage/commit/c6ebef6fe77b917af23b3ea7df900e34abfd67a4) Thanks [@jellologic](https://github.com/jellologic)! - Editing:

  - **Drag and drop:** sections and list items have a drag handle on their toolbar; drop them anywhere in their list, side by side or stacked. The move buttons and ⌥↑/⌥↓ stay as the keyboard path.
  - **Lists in settings:** a list the page doesn't show (a hero's links, a card's tags) is edited in the section's settings: add, edit, move and remove its rows.
  - **Links to pages** in rich text: the link popover offers **Page** next to **Web address**. You search the site's pages (the collections enabled for on-page editing, `DocumentSchema.linkTargets`), and the link is stored as Payload's internal link (`linkType: 'internal'`, `doc`).

- [#25](https://github.com/jellologic/payload-onpage/pull/25) [`57ba823`](https://github.com/jellologic/payload-onpage/commit/57ba823ddb0bc1a924e0064845d2b022c85fdc95) Thanks [@jellologic](https://github.com/jellologic)! - Field conditions (`admin.condition`) apply in section and page settings, as in the admin. The plugin runs them on the server against the document as the editor has it, through `POST /onpage/conditions`, so a link shows `url` or `reference` depending on its type. New: `DataSource.hiddenFields`, and `DocumentSchema.conditions`.

- [#28](https://github.com/jellologic/payload-onpage/pull/28) [`88ae4bf`](https://github.com/jellologic/payload-onpage/commit/88ae4bff140cf749d97d81480be8e4fd2cebb17a) Thanks [@jellologic](https://github.com/jellologic)! - - **History** in the dock: a document's saved versions. **Outline what changed since published** marks every changed field on the page; **Restore** makes an older version the current draft (it isn't published). New: `DataSource.listVersions` and `restoreVersion` (implemented by `payloadRest`), `EditorSession.restoreVersion`, `changedPaths()`, `VersionSummary`.
  - Documents without drafts say so in the dock ("Header: changes go live").

- [#24](https://github.com/jellologic/payload-onpage/pull/24) [`2b2641d`](https://github.com/jellologic/payload-onpage/commit/2b2641dc5553cba042c1dc8d5185160303767c44) Thanks [@jellologic](https://github.com/jellologic)! - - **Page settings:** a dock button that lists the page's own fields that aren't on it (SEO meta, dates, references, toggles). It uses the same generator as section settings.
  - **Publish menu** (**▾** beside Publish): choose which of the page's documents to publish, or schedule them for collections with `versions.drafts.schedulePublish`. Scheduling queues Payload's own `schedulePublish` job through a new plugin endpoint, `POST /onpage/schedule`, which checks publish permission as Payload's scheduler does. New: `DataSource.schedulePublish`, `DocumentSchema.schedulePublish`, `EditorSession.hasUnpublished()`.
  - **Smaller first download:** the block picker, settings panels and publish menu now load on first use, prefetched when the browser is idle.

- [#31](https://github.com/jellologic/payload-onpage/pull/31) [`54a1db0`](https://github.com/jellologic/payload-onpage/commit/54a1db0301135cfde5b35391481ed27aa4891bb5) Thanks [@jellologic](https://github.com/jellologic)! - - **New pages from the page:** **Duplicate this page** and **New page** in Page settings create a draft at a unique address made from its title, and open it in edit mode. Payload checks the editor's create access. New plugin endpoint `POST /onpage/pages`, and `DataSource.duplicatePage` / `createPage`.
  - **Saved sections** (opt-in: `patterns: true`): **Save this section** on a section's toolbar keeps its content under a name in an `onpage-patterns` collection. It's listed under **Saved sections** in the block picker, inserted as a copy with fresh row ids, and previewed in client mode. New: `DataSource.listPatterns` / `savePattern`, `SavedSection`, `DocumentSchema.patterns`.

- [#26](https://github.com/jellologic/payload-onpage/pull/26) [`a1a358a`](https://github.com/jellologic/payload-onpage/commit/a1a358a7afda1879eab4b94679f75b72f71f7d85) Thanks [@jellologic](https://github.com/jellologic)! - Working with others:

  - **Document locks:** the editor holds Payload's document lock while editing, so admin users see the page is being edited. The dock says who else holds a lock ("Ada is editing this Page"). New plugin endpoint `POST /onpage/lock` and `DataSource.lock`.
  - **Keep my changes** on a conflict: loads the latest version and re-applies your unsaved changes field by field (`EditorSession.keepMine`). Before, the only choice was to reload and lose them.
  - **Invalid fields:** a failed save or publish keeps every field Payload's validation error names (`SaveResult.fields`, `PublishResult.fields`, `DocumentState.invalid`) and outlines them on the page.
  - **`onEvent`** on the editor and the client mounts: saves, failures, conflicts, publishes, scheduling and errors, for logging or error reporting (`OnPageEvent`). Errors no longer go only to the console.

### Patch Changes

- [#22](https://github.com/jellologic/payload-onpage/pull/22) [`0d4dfa7`](https://github.com/jellologic/payload-onpage/commit/0d4dfa7885ff4ec6f34ddef6764bd2cdffa43518) Thanks [@jellologic](https://github.com/jellologic)! - Fixes for Payload's website template and Payload 4:

  - **Installs on Payload 4:** the plugin's peer range now accepts `payload@^4.0.0-beta.0`, so `npm install` no longer fails with ERESOLVE on TanStack Start sites.
  - **Preview routes:** when `admin.preview` returns a preview route that carries a secret (the website template's `/next/preview?path=…&previewSecret=…`), the plugin uses its `path` and logs a warning. Before, edit and share links pointed at that route: share links got a 403 and carried the secret.
  - **Payload 4:** block slugs listed in `blocks` (`blocks: ['cta']`) and upload `variants` are read.
  - **Startup warning** for enabled collections or globals without drafts, whose on-page edits go live as they autosave.
  - **`isPayloadUser`** (`@shipment/onpage-next/proxy`): verifies a Payload login at the edge, for `allowDraft`, so your own preview route and Live Preview keep working behind the strict proxy on Vercel.
  - **TanStack Start:** preview-link viewers navigate with full page loads, so each page is checked by the server. Before, a client-side navigation back to the shared page showed published content.
  - New guide: [Payload's website template](https://github.com/jellologic/payload-onpage/blob/main/docs/guides/website-template.md).

- [#21](https://github.com/jellologic/payload-onpage/pull/21) [`4b3ed49`](https://github.com/jellologic/payload-onpage/commit/4b3ed49e75acd6765f9d8f7cc0e22e58bc8b5e33) Thanks [@jellologic](https://github.com/jellologic)! - Security: the editor's `onpage` mode cookie is now sealed with the plugin secret, so it can't be hand-made.

  - **TanStack Start:** a visitor could set `onpage=view` (or a forged session binding) and see every draft. Reads now verify the seal, and fail closed without `tanstackSession({ secret })`.
  - **Next.js:** a forged binding no longer gets past `allowDraft`, and the proxy strips mode cookies whose seal doesn't verify. On Vercel (`cdnBypass`), the proxy is now strict by default: a copied draft cookie only works on the page its preview link covers, or for a signed-in editor. If your own preview route enables draft mode on Vercel, admit its users with `allowDraft`.
  - The documented proxy matcher now skips assets by extension only, so page paths with dots (`/blog/release-2.0`) are guarded too.
  - Markers are stripped before your own `beforeValidate`/`beforeChange` hooks run, and fields with `admin.readOnly` are no longer editable on the page.
  - The editor schema now evaluates field-level access against the document being edited (`update: ({ doc }) => …`), so the editor no longer offers fields a save would silently drop.

  Editors in edit mode when you upgrade must press **Edit on page** again. Custom `SessionAdapter`s should store `createModeCookie(mode, { sealMode, … })` from the new `sealMode` option of `enable()`.

- [#21](https://github.com/jellologic/payload-onpage/pull/21) [`4b3ed49`](https://github.com/jellologic/payload-onpage/commit/4b3ed49e75acd6765f9d8f7cc0e22e58bc8b5e33) Thanks [@jellologic](https://github.com/jellologic)! - Hardening:

  - **Secret rotation:** `secret` (plugin, proxy, `tanstackSession`) also takes a keyring, `[newSecret, oldSecret]`. The first seals, any of them unseals, so open preview links and edit sessions survive a rotation. See [Rotating the secret](https://github.com/jellologic/payload-onpage/blob/main/docs/concepts/security.md#rotating-the-secret).
  - **TanStack Start:** when `isDraftEnabled()` returns true, the response is marked `Cache-Control: private, no-store`, so no shared cache keeps a draft.
  - The plugin logs a warning when an editor enters edit mode without the auth cookie it binds to (header or API-key auth, a renamed cookie), since signing out then wouldn't end edit mode.
  - Docs: a recipe for revoking preview links by id, and why the path field should be `unique`.

## 0.5.0

### Minor Changes

- [#18](https://github.com/jellologic/payload-onpage/pull/18) [`9dca50e`](https://github.com/jellologic/payload-onpage/commit/9dca50e72997076f2e39a5b02cf635171786dd0c) Thanks [@jellologic](https://github.com/jellologic)! - Block picker: shows each block's Payload thumbnail (`admin.images.thumbnail`, or the older `imageURL`) and groups blocks by `admin.group`. On documents rendered in client mode (`<OnPageClient>`), pointing at a block previews it in place on the page before it's added, using optional sample content from `admin.custom.onpage.example`; set `insertExample: true` beside it to start new blocks from that content. New in core: `previewRow()` and the `SchemaImage` type; `SchemaBlock` gains `thumbnail`, `group`, `example` and `insertExample`.

## 0.4.1

### Patch Changes

- [#16](https://github.com/jellologic/payload-onpage/pull/16) [`32e018c`](https://github.com/jellologic/payload-onpage/commit/32e018c5b2d90491b8d917a452d7ac2147c2964c) Thanks [@jellologic](https://github.com/jellologic)! - Preview links now work on Vercel. Vercel's cache decides whether to bypass a cached page from the cookies the browser itself sends, before any proxy runs, so the draft mode the proxy injected never reached the page: a shared link showed the published page, or a 404 for a page that was never published.

  With `nextSession({ cdnBypass })`, on by default when `process.env.VERCEL` is set, the viewer's browser also gets Next's draft cookie, scoped to the shared page's path and expiring with the link. `withOnPage` now guards that cookie. It strips it from any request the grant doesn't cover. With the new `allowDraft` option it is strict: the cookie survives only on the granted page, for an editor whose bound session is still signed in, or when `allowDraft(request)` says so. Use it to admit your own preview route's admins, and it fails closed if the check throws. Leaving preview clears the page-scoped cookie, so `SessionAdapter.disable()` now receives the page's `path`.

  `@shipment/onpage-tanstack-start` is now part of the release.

## 0.4.0

### Minor Changes

- [`cfd55ea`](https://github.com/jellologic/payload-onpage/commit/cfd55eaf03184af534fe0fee8ca2e5122d05e5e7) Thanks [@jellologic](https://github.com/jellologic)! - Security hardening from an adversarial review of the plugin. The editor schema endpoint now returns 403 when collection/global update access is definitively denied (including when an access check throws, which previously served the schema unfiltered); `/mode` requires editing at least one enabled document; the CSRF guard refuses `sec-fetch-site: none`; `enter` and `preview-link` authenticate before parsing refs; the admin new-tab form uses `rel="noopener"`; an empty `secret` option fails at config time; and the marker cleaner drops `__proto__` keys. Removes the unused `SEAL_PURPOSE.editBinding` export.

## 0.3.2

No changes in this release.

## 0.3.1

No changes in this release.

## 0.3.0

### Minor Changes

- [#7](https://github.com/jellologic/payload-onpage/pull/7) [`b936774`](https://github.com/jellologic/payload-onpage/commit/b936774c8d7e8371623fc781f9b15b1141a005f1) Thanks [@jellologic](https://github.com/jellologic)! - Stricter types, fewer bugs, more of Payload reused. See docs/upgrading.md for the changes that affect you. For most sites, that's passing `session` and fixing any collection slug typos the compiler now finds.

  - **Fixes:**
    - Text ids that look numeric (and ids past 2^53) no longer open the wrong document.
    - Old Lexical links keep an id after editing.
    - The media adapter honours custom `init` headers.
    - Preview grants without an expiry are refused.
    - Admin strings and labels are translated.
    - Dialogs keep outside clicks.
    - The settings panel opens a field's custom editor.
    - Path segments that reach the prototype are refused.
  - **Payload reuse:**
    - Endpoints throw Payload's errors.
    - `req.searchParams`, `req.locale` and `localeCodes` replace hand-rolled parsing.
    - URLs come from `formatAdminURL` (basePath-aware), translations from `deepMergeSimple`.
    - Hooks use Payload's hook types; options use `CollectionSlug`/`GlobalSlug`, and `RequestContext` is augmented.
    - The serializer switches over Payload's own field union, and the redundant row-level access query is gone.
  - **Types:**
    - `SchemaField` is a discriminated union, with `FieldOf`.
    - `defineEditor({ accepts, normalize })` types editors by field kind.
    - `t()` checks keys and their variables.
    - `RefKey`/`TargetKey` type document keys, and `isReady()` narrows document state.
    - `SaveResult` is a union.
    - The compiler runs with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.
  - **Structure:**
    - One field walker, shared row rules (`rowOps`) and named geometry.
    - Editors share `EditorPopover`/`ApplyBar`/`useDraft`.
    - The editor context is split into a stable API and changing state.
    - Searches are abortable, and core's public API is explicit.

## 0.2.1

### Patch Changes

- [#5](https://github.com/jellologic/payload-onpage/pull/5) [`c620bb6`](https://github.com/jellologic/payload-onpage/commit/c620bb6bae277c2d8ff089f0e2b91f337ca5af92) Thanks [@jellologic](https://github.com/jellologic)! - Fix 0.2.0's internal dependencies: its packages depended on each other at 0.1.0, so installs mixed 0.2.0 and 0.1.0 code. 0.2.1 pins every `@payload-onpage/*` dependency to the same version.

## 0.2.0

### Minor Changes

- [#1](https://github.com/jellologic/payload-onpage/pull/1) [`2add437`](https://github.com/jellologic/payload-onpage/commit/2add4377ffb7b20a8b2f84ba0d6c97f90b405df3) Thanks [@jellologic](https://github.com/jellologic)! - Security and architecture release. See docs/upgrading.md for breaking changes.

  - Share links never expose Next's draft secret: links and grants are AES-GCM sealed; the (now required) proxy injects draft mode for the shared page only. Links are bound to their document's page, expire after 1 day by default, carry ids for revocation (`validatePreviewLink`).
  - Open redirect fixed; enter/mode/exit are same-origin POSTs; access uses Payload's `docAccessOperation` (row-level rules evaluated per document) and defaults to the admin user collection; editor mode is bound to the auth cookie.
  - Real stale-write protection (409) via a plugin hook.
  - Schema serializer uses Payload's own helpers and translations: system/hidden/virtual/join fields excluded, field permissions respected, `blockReferences` and function defaults supported.
  - Editor: serialized publish/discard, retry policy, keyboard editing, focus-managed dialogs, WCAG AA contrast, translatable UI (`messages`), admin strings via Payload i18n.
  - Smaller: the rich-text editor loads lazily (Lexical only when a rich-text field opens); visitor cost ~0.3 KB.
  - Requires the patched releases: Payload `^3.90.2`, Next `^15.4.11 || ^16.3.8`, Lexical `~0.50.0` (Payload 3.87 and Next 16.3.0 have published security advisories). Works with Next 15's bundled React.
