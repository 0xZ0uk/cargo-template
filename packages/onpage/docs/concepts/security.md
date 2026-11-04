# Security

## Threat model (summary)

| Asset              | Threat                                       | Mitigation                                                                                                                                     |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unpublished drafts | Anonymous or low-privilege users read drafts | Draft mode only via authenticated endpoints. Share links are sealed, path-bound and expiring, and the browser never holds Next's draft secret. |
| Document integrity | Editing documents a user may not edit        | Every write is Payload REST (Payload enforces access). Entry points use Payload's `docAccessOperation`, including row-level `where` rules.     |
| Editor sessions    | CSRF that switches modes or opens editing    | State-changing endpoints are same-origin `POST`s (Origin / `Sec-Fetch-Site`). Preview-link creation needs JSON.                                |
| Visitors           | Open redirect via `?path=`                   | `safePath()` rejects anything that could resolve off-site, including control characters, backslashes and encoded forms.                        |
| Stored content     | Marker or script injection                   | Markers are stripped on every write. Rich-text links reject `javascript:`/`data:`. Ghost HTML is sanitized.                                    |
| Concurrent edits   | Silent overwrites                            | Stale-write guard: the editor sends `x-onpage-if-unmodified-since`, and the plugin answers 409 if the document changed.                        |

## Who can edit

Default: users of `config.admin.user`, with the document's own `update` access, evaluated by Payload. That includes access functions that return a query: "editors may update their own pages" works per document.

Replace it entirely with the `access` option. `ref` is undefined for "may use on-page editing at all":

```ts
onpage({
  collections: ['pages'],
  session: nextSession(),
  access: ({ req, ref }) => req.user?.roles?.includes('editor') ?? false,
})
```

Fields the user can't update are left out of the editor schema (field-level access), and so are fields with `admin.readOnly`. Field rules are evaluated against the document being edited, so a rule like `update: ({ doc }) => !doc?.locked` works per page.

- **Known limit (concurrent saves):** the stale-write guard compares the `updatedAt` the editor last saw with the stored one in a `beforeChange` hook. Two saves of the same document in the same instant can both pass it, and the later one wins. Payload has no compare-and-set update to close this window.

## Preview links

- **Token:** AES-256-GCM, sealed with a key derived (HKDF) from `PAYLOAD_SECRET` or the `secret` option, holding `{ ref, path, locale, iat, exp, jti }`. It's opaque to the holder. Default lifetime is 1 day (`previewLinkTTL`).
- **Bound:** the path is computed on the server. On open, the link must still match the document's page (a moved or deleted document invalidates it).
- **Revocation:** `validatePreviewLink({ req, ref, path, issuedAt, id })` lets you deny by `jti` or issue time (recipe below). Replacing the secret revokes every link. There is no built-in throttle on minting links — put token-minting and state-changing endpoints behind infrastructure rate limiting.
- **One page per path:** a link opens the path its document resolves to. Two documents that resolve to the same path (for example, a draft slug copied from another page) would share it, so make the field your paths come from `unique`, as in the [example](../../examples/basic/src/collections/Pages.ts). A locale in the path binds the link to that locale; a locale chosen some other way (a cookie) is the viewer's choice, within the same document.
- **Known limit:** the path check happens when the link opens. If a document moves to another path in the same instant a viewer opens an old link, the grant (which binds the path, not the document) could show the new occupant's draft. The window is milliseconds and needs an editor-timed move; binding page reads to the grant's document id was considered and rejected — reads don't know which document the page is rendering.
- **Opening a link** stores only a sealed grant cookie. On Next.js, the proxy unseals it per request and injects Next's draft cookie into the forwarded request on the shared path only; on TanStack Start there is no proxy — page reads unseal the grant and check path + expiry themselves. Either way, copying cookies to other paths, or forging a draft credential, gets nothing.
- **Opening a link replaces the current mode.** The link is a plain GET so it can be shared anywhere, which also means a page on another site can open it. A signed-in editor who follows someone else's link leaves edit mode for that preview (and can press **Edit on page** again). No data is exposed.
- **The proxy is required** for share links on Next.js. Without it, links fail closed: viewers see published content. (On Start, the session's `secret` plays the same role: without it, grants never validate.)

### Comments from share links

With `comments: { guests: true }`, a share-link viewer can add a comment, but only on the document their sealed grant covers. The plugin reads that document from the grant, never from the request, and refuses expired or forged grants. Viewers can't read or resolve comments. Text is bounded (2,000 characters; a 500-character quote; an 80-character name) and stored as plain text, and each link can post at most 20 comments an hour. Comments are off unless you turn them on.

### Revoking a link

Keep revoked link ids in a collection and refuse them:

```ts
onpage({
  collections: ['pages'],
  session: nextSession(),
  validatePreviewLink: async ({ req, id }) =>
    (
      await req.payload.count({
        collection: 'revoked-preview-links', // fields: [{ name: 'linkId', type: 'text', index: true }]
        where: { linkId: { equals: id } },
        overrideAccess: true,
      })
    ).totalDocs === 0,
})
```

The id comes back when a link is made (`id` in the preview-link response), so log it where you can find it, alongside who shared what. A grant that's already open lasts until it expires; keep `previewLinkTTL` short if that matters.

### Rotating the secret

Seals use the plugin's `secret` (default: Payload's). To change it without signing everyone out of edit mode or breaking open links, pass a keyring, newest first, to the plugin and to the proxy (or `tanstackSession`):

```ts
const secret = [process.env.ONPAGE_SECRET!, process.env.ONPAGE_SECRET_PREVIOUS!]
onpage({ collections: ['pages'], session: nextSession(), secret })
createOnPageProxy({ secret })
```

The first secret seals; any of them unseals. Remove the old one after the longest lifetime you issue (edit mode: 12 h; links: `previewLinkTTL`). A secret of its own also lets you rotate it without touching Payload's sessions.

## Cookies

| Cookie               | Holder                                      | Flags                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onpage`             | Editors                                     | httpOnly, SameSite=Lax, Secure on HTTPS, 12 h. Value `edit:<authCookie>:<hash>.<seal>`: bound to the session and sealed, so it can't be hand-made. The Next proxy and Start reads verify the seal.                                                                 |
| `onpage_preview`     | Share-link viewers                          | httpOnly, SameSite=Lax, Secure on HTTPS, expires with the link. Sealed.                                                                                                                                                                                            |
| `onpage_hint`        | Editors, viewers (Start)                    | Readable by the mount, trusted by nothing. Lets visitors skip the state lookup entirely.                                                                                                                                                                           |
| `__prerender_bypass` | Editors (Next.js); viewers with `cdnBypass` | Next's own, one key for the whole site until the next deploy. Viewers get it only with `cdnBypass` (default on Vercel), scoped to the shared page and the link's lifetime. On Vercel the proxy is strict by default, so a copied cookie unlocks nothing elsewhere. |

Set `serverURL` in production. It's used for redirects, link URLs and the Secure flag; the plugin warns at startup when it's missing.

Payload's dev `autoLogin` also authenticates API requests (as the seeded user) — convenient for the examples, never for production. Test anonymous behavior with `DisableAutologin: true` (see the schema e2e test).

## Reporting

See [SECURITY.md](../../SECURITY.md).
