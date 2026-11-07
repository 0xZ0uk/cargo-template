# @shipment/onpage-tanstack-start

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @shipment/onpage-core@0.7.0
  - @shipment/onpage-lexical@0.7.0
  - @shipment/onpage-react@0.7.0

## 0.6.1

### Patch Changes

- [#38](https://github.com/jellologic/payload-onpage/pull/38) [`456411b`](https://github.com/jellologic/payload-onpage/commit/456411ba78a36bbb1360817d01a58f1cf123e14a) Thanks [@jellologic](https://github.com/jellologic)! - The package now includes its MIT license file, like the other packages. 0.6.0 and earlier were published without it.
- Updated dependencies []:
  - @shipment/onpage-core@0.6.1
  - @shipment/onpage-lexical@0.6.1
  - @shipment/onpage-react@0.6.1

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

- [#24](https://github.com/jellologic/payload-onpage/pull/24) [`2b2641d`](https://github.com/jellologic/payload-onpage/commit/2b2641dc5553cba042c1dc8d5185160303767c44) Thanks [@jellologic](https://github.com/jellologic)! - - **Page settings:** a dock button that lists the page's own fields that aren't on it (SEO meta, dates, references, toggles). It uses the same generator as section settings.
  - **Publish menu** (**▾** beside Publish): choose which of the page's documents to publish, or schedule them for collections with `versions.drafts.schedulePublish`. Scheduling queues Payload's own `schedulePublish` job through a new plugin endpoint, `POST /onpage/schedule`, which checks publish permission as Payload's scheduler does. New: `DataSource.schedulePublish`, `DocumentSchema.schedulePublish`, `EditorSession.hasUnpublished()`.
  - **Smaller first download:** the block picker, settings panels and publish menu now load on first use, prefetched when the browser is idle.

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

- Updated dependencies [[`7e5837c`](https://github.com/jellologic/payload-onpage/commit/7e5837ce684a9312ce29bd00066d18c4bf9fdba5), [`7c1c9d7`](https://github.com/jellologic/payload-onpage/commit/7c1c9d735067a20520921eea65fb6f75dda9f73d), [`9748d89`](https://github.com/jellologic/payload-onpage/commit/9748d8942bae6c89b0927f909c28c512eee464c3), [`c6ebef6`](https://github.com/jellologic/payload-onpage/commit/c6ebef6fe77b917af23b3ea7df900e34abfd67a4), [`57ba823`](https://github.com/jellologic/payload-onpage/commit/57ba823ddb0bc1a924e0064845d2b022c85fdc95), [`88ae4bf`](https://github.com/jellologic/payload-onpage/commit/88ae4bff140cf749d97d81480be8e4fd2cebb17a), [`a0c9656`](https://github.com/jellologic/payload-onpage/commit/a0c9656c1c772e96dc32a6d4bf437d10f67b59c4), [`2b2641d`](https://github.com/jellologic/payload-onpage/commit/2b2641dc5553cba042c1dc8d5185160303767c44), [`54a1db0`](https://github.com/jellologic/payload-onpage/commit/54a1db0301135cfde5b35391481ed27aa4891bb5), [`0d4dfa7`](https://github.com/jellologic/payload-onpage/commit/0d4dfa7885ff4ec6f34ddef6764bd2cdffa43518), [`a1a358a`](https://github.com/jellologic/payload-onpage/commit/a1a358a7afda1879eab4b94679f75b72f71f7d85), [`4b3ed49`](https://github.com/jellologic/payload-onpage/commit/4b3ed49e75acd6765f9d8f7cc0e22e58bc8b5e33), [`4b3ed49`](https://github.com/jellologic/payload-onpage/commit/4b3ed49e75acd6765f9d8f7cc0e22e58bc8b5e33)]:
  - @shipment/onpage-core@0.6.0
  - @shipment/onpage-react@0.6.0
  - @shipment/onpage-lexical@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`9dca50e`](https://github.com/jellologic/payload-onpage/commit/9dca50e72997076f2e39a5b02cf635171786dd0c)]:
  - @shipment/onpage-core@0.5.0
  - @shipment/onpage-react@0.5.0
  - @shipment/onpage-lexical@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`32e018c`](https://github.com/jellologic/payload-onpage/commit/32e018c5b2d90491b8d917a452d7ac2147c2964c)]:
  - @shipment/onpage-core@0.4.1
  - @shipment/onpage-lexical@0.4.1
  - @shipment/onpage-react@0.4.1

## 0.4.0

### Minor Changes

- [`cfd55ea`](https://github.com/jellologic/payload-onpage/commit/cfd55eaf03184af534fe0fee8ca2e5122d05e5e7) Thanks [@jellologic](https://github.com/jellologic)! - New package: day-one TanStack Start support, alongside Next.js. The editor UI is the same components behind a different framework adapter: `tanstackSession({ secret })` for `payload.config.ts`, `<OnPage />` for the frontend layout route, and `isDraftEnabled()` / `onpageContext()` for server functions and loaders. Refresh after save goes through `router.invalidate()`.

  There is no proxy step on Start: request middleware cannot rewrite the request, so page reads verify the sealed preview grant directly (unseal + path + expiry) with the session secret. Without the secret, preview links fail closed to published content. See `docs/getting-started-tanstack.md` and the `examples/tanstack` demo.

  Version requirements (Payload 4 is in beta — pin these): `payload` + `@payloadcms/*` at `4.0.0-beta.0`, `@tanstack/react-start` `1.168.60`, `@tanstack/react-router` `1.170.41`, `react` 19, `lexical` 0.52. Next.js sites stay on Payload 3 (`@shipment/onpage-next` is unchanged). Full matrix: `docs/compatibility.md`.

### Patch Changes

- Updated dependencies [[`cfd55ea`](https://github.com/jellologic/payload-onpage/commit/cfd55eaf03184af534fe0fee8ca2e5122d05e5e7), [`cfd55ea`](https://github.com/jellologic/payload-onpage/commit/cfd55eaf03184af534fe0fee8ca2e5122d05e5e7)]:
  - @shipment/onpage-lexical@0.4.0
  - @shipment/onpage-core@0.4.0
  - @shipment/onpage-react@0.4.0
