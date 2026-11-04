# @cargo/onpage-react

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @cargo/onpage-core@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies []:
  - @cargo/onpage-core@0.6.1

## 0.6.0

### Minor Changes

- [#23](https://github.com/jellologic/payload-onpage/pull/23) [`7e5837c`](https://github.com/jellologic/payload-onpage/commit/7e5837ce684a9312ce29bd00066d18c4bf9fdba5) Thanks [@jellologic](https://github.com/jellologic)! - Editor UI:

  - **Alt text:** uploading an image asks for its alt text first; it used to be taken from the filename ("IMG 2034"). The current image's alt text can be changed in the image editor; it's saved on the media document. New optional `MediaLibrary.updateAlt`, implemented by `payloadUploads()`.
  - **`uiLocale`** (on `<OnPage>`, `OnPageEditor` and `PreviewToolbar`): the language of your `messages`. Plurals, relative times and dates follow it rather than the browser's language. Default `"en"`.
  - **Plural forms:** a message with `{count}` can have a form per plural category, such as `'dock.documents.one'`.
  - **Shortcut hints** match the platform: `⌘Z` on Apple devices, `Ctrl+Z` elsewhere. `row.delete` now takes an `{undo}` variable.

- [#36](https://github.com/jellologic/payload-onpage/pull/36) [`7c1c9d7`](https://github.com/jellologic/payload-onpage/commit/7c1c9d735067a20520921eea65fb6f75dda9f73d) Thanks [@jellologic](https://github.com/jellologic)! - - **Writing assistant** (`assist`, an `AssistPort` you implement; no AI vendor is bundled): **✨** on text fields offers Shorter, Clearer, Friendlier, Fix spelling, or your own instruction. The answer replaces the text, still uncommitted. Pass it from your client mount. The examples include a signed-in-only endpoint that uses Claude when `ANTHROPIC_API_KEY` is set.
  - **`@cargo/onpage-core/testing`:** `memoryDataSource()`, an in-memory `DataSource` for testing custom editors and pages. It applies saves, checks for stale writes, and records saves.

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

- [#30](https://github.com/jellologic/payload-onpage/pull/30) [`a0c9656`](https://github.com/jellologic/payload-onpage/commit/a0c9656c1c772e96dc32a6d4bf437d10f67b59c4) Thanks [@jellologic](https://github.com/jellologic)! - - **Spanish, French and German** editor UI strings: `import { es } from '@cargo/onpage-react/locales/es'` (or `fr`, `de`), passed as `messages` with `uiLocale`.
  - **Right-to-left:** a right-to-left `uiLocale` lays out the editor UI right to left. On right-to-left pages, toolbars and popovers sit at the element's start edge, and inline editing follows each element's direction.

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

- Updated dependencies [[`7e5837c`](https://github.com/jellologic/payload-onpage/commit/7e5837ce684a9312ce29bd00066d18c4bf9fdba5), [`7c1c9d7`](https://github.com/jellologic/payload-onpage/commit/7c1c9d735067a20520921eea65fb6f75dda9f73d), [`9748d89`](https://github.com/jellologic/payload-onpage/commit/9748d8942bae6c89b0927f909c28c512eee464c3), [`c6ebef6`](https://github.com/jellologic/payload-onpage/commit/c6ebef6fe77b917af23b3ea7df900e34abfd67a4), [`57ba823`](https://github.com/jellologic/payload-onpage/commit/57ba823ddb0bc1a924e0064845d2b022c85fdc95), [`88ae4bf`](https://github.com/jellologic/payload-onpage/commit/88ae4bff140cf749d97d81480be8e4fd2cebb17a), [`2b2641d`](https://github.com/jellologic/payload-onpage/commit/2b2641dc5553cba042c1dc8d5185160303767c44), [`54a1db0`](https://github.com/jellologic/payload-onpage/commit/54a1db0301135cfde5b35391481ed27aa4891bb5), [`0d4dfa7`](https://github.com/jellologic/payload-onpage/commit/0d4dfa7885ff4ec6f34ddef6764bd2cdffa43518), [`a1a358a`](https://github.com/jellologic/payload-onpage/commit/a1a358a7afda1879eab4b94679f75b72f71f7d85), [`4b3ed49`](https://github.com/jellologic/payload-onpage/commit/4b3ed49e75acd6765f9d8f7cc0e22e58bc8b5e33), [`4b3ed49`](https://github.com/jellologic/payload-onpage/commit/4b3ed49e75acd6765f9d8f7cc0e22e58bc8b5e33)]:
  - @cargo/onpage-core@0.6.0

## 0.5.0

### Minor Changes

- [#18](https://github.com/jellologic/payload-onpage/pull/18) [`9dca50e`](https://github.com/jellologic/payload-onpage/commit/9dca50e72997076f2e39a5b02cf635171786dd0c) Thanks [@jellologic](https://github.com/jellologic)! - Block picker: shows each block's Payload thumbnail (`admin.images.thumbnail`, or the older `imageURL`) and groups blocks by `admin.group`. On documents rendered in client mode (`<OnPageClient>`), pointing at a block previews it in place on the page before it's added, using optional sample content from `admin.custom.onpage.example`; set `insertExample: true` beside it to start new blocks from that content. New in core: `previewRow()` and the `SchemaImage` type; `SchemaBlock` gains `thumbnail`, `group`, `example` and `insertExample`.

### Patch Changes

- Updated dependencies [[`9dca50e`](https://github.com/jellologic/payload-onpage/commit/9dca50e72997076f2e39a5b02cf635171786dd0c)]:
  - @cargo/onpage-core@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`32e018c`](https://github.com/jellologic/payload-onpage/commit/32e018c5b2d90491b8d917a452d7ac2147c2964c)]:
  - @cargo/onpage-core@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [[`cfd55ea`](https://github.com/jellologic/payload-onpage/commit/cfd55eaf03184af534fe0fee8ca2e5122d05e5e7)]:
  - @cargo/onpage-core@0.4.0

## 0.3.2

### Patch Changes

- [#12](https://github.com/jellologic/payload-onpage/pull/12) [`3f4bc61`](https://github.com/jellologic/payload-onpage/commit/3f4bc6152629b2a684c8604bfafd1f771e810b72) Thanks [@jellologic](https://github.com/jellologic)! - - **Dock position:** a new `--po-dock-bottom` CSS variable (default `16px`) raises the dock above a site's own fixed bottom bar. The preview toolbar, the locale notice and the pinned "+ Add" button follow it.
  - **Icons:** the dock, section toolbar, dialogs and rich-text toolbar now use SVG icons (undo, redo, move, duplicate, settings, close) instead of text glyphs, which rendered tiny and unevenly in some fonts.
- Updated dependencies []:
  - @cargo/onpage-core@0.3.2

## 0.3.1

### Patch Changes

- [#9](https://github.com/jellologic/payload-onpage/pull/9) [`c44ca24`](https://github.com/jellologic/payload-onpage/commit/c44ca24c6b137d665a3526606c9fce34c38a46c9) Thanks [@jellologic](https://github.com/jellologic)! - The dock, the preview toolbar and the locale notice no longer wrap at half the window width. These centred bars were capped at 50% of the viewport, which pushed **Publish** onto a second row on ordinary laptop screens.
- Updated dependencies []:
  - @cargo/onpage-core@0.3.1

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

### Patch Changes

- Updated dependencies [[`b936774`](https://github.com/jellologic/payload-onpage/commit/b936774c8d7e8371623fc781f9b15b1141a005f1)]:
  - @cargo/onpage-core@0.3.0

## 0.2.1

### Patch Changes

- [#5](https://github.com/jellologic/payload-onpage/pull/5) [`c620bb6`](https://github.com/jellologic/payload-onpage/commit/c620bb6bae277c2d8ff089f0e2b91f337ca5af92) Thanks [@jellologic](https://github.com/jellologic)! - Fix 0.2.0's internal dependencies: its packages depended on each other at 0.1.0, so installs mixed 0.2.0 and 0.1.0 code. 0.2.1 pins every `@payload-onpage/*` dependency to the same version.
- Updated dependencies [[`c620bb6`](https://github.com/jellologic/payload-onpage/commit/c620bb6bae277c2d8ff089f0e2b91f337ca5af92)]:
  - @cargo/onpage-core@0.2.1

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

### Patch Changes

- Updated dependencies [[`2add437`](https://github.com/jellologic/payload-onpage/commit/2add4377ffb7b20a8b2f84ba0d6c97f90b405df3)]:
  - @cargo/onpage-core@0.2.0
