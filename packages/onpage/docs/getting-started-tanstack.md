# Getting started with TanStack Start

Add on-page editing and shareable draft previews to an existing **Payload 4 + TanStack Start** site. Nothing changes for visitors: no extra markup, about 0.3 KB of JavaScript.

> **For coding agents:** follow these steps in order. Each names the file to edit and ends with a check. The Shipment app (`apps/web`) is the working setup.
>
> **Payload 4 is in beta.** The versions come from the workspace catalog; see [compatibility](compatibility.md).

## 1. Install

The packages are private workspace packages. In the app's `package.json`:

```json
"@shipment/onpage-core": "workspace:*",
"@shipment/onpage-lexical": "workspace:*",
"@shipment/onpage-plugin": "workspace:*",
"@shipment/onpage-react": "workspace:*",
"@shipment/onpage-tanstack-start": "workspace:*",
"lexical": "catalog:"
```

plus the `@lexical/*` packages from the catalog: Lexical is a peer dependency and must be the copy `@payloadcms/richtext-lexical` uses.

## 2. Register the plugin

`payload.config.ts` ([Shipment](../../../apps/web/src/payload.config.ts)):

```ts
import { onpage } from '@shipment/onpage-plugin'
import { tanstackSession } from '@shipment/onpage-tanstack-start/session' // the /session entry has no client code

export default buildConfig({
  // …
  serverURL: process.env.SERVER_URL, // required in production (redirects, preview links, Secure cookies)
  plugins: [
    onpage({
      collections: ['pages'], // or { pages: { fields: ['title', 'layout'], url: ({ doc }) => `/${doc.slug}` } }
      globals: ['header'],
      session: tanstackSession({ secret: process.env.PAYLOAD_SECRET }),
    }),
  ],
})
```

Collections must have **drafts** enabled (`versions: { drafts: true }`), so edits save as drafts until published. The page URL comes from the `url` option, then the collection's `admin.preview`, then `/<slug>`.

Unlike Next, the secret goes on the session, not on a proxy: Start request middleware cannot rewrite the request, so reads verify the editor's sealed mode cookie and the sealed preview grant directly (unseal + path + expiry) instead of injecting a draft cookie. It must be the plugin's secret (Payload's `secret` unless you set the plugin's `secret` option). Without it, everything fails closed: nobody sees drafts, editors included.

**Check:** open a document in the admin. **Edit on page** and **Copy preview link** appear beside the document controls.

## 3. Mount the editor

The frontend layout route ([Shipment](../../../apps/web/src/app/_frontend.tsx)):

```tsx
import { OnPage } from '@shipment/onpage-tanstack-start'

function FrontendLayout() {
  return (
    <>
      {/* … */}
      <OnPage />
    </>
  )
}
```

`<OnPage />` renders nothing unless an editor turned on edit or preview mode. Visitors issue no extra requests: without a hint cookie the mount does nothing at all.

## 4. Read drafts with markers

Wherever a server function or loader reads Payload ([Shipment](../../../apps/web/src/app/_frontend/pages.functions.ts)):

```ts
import { isDraftEnabled, onpageContext } from '@shipment/onpage-tanstack-start/session'

const draft = await isDraftEnabled()
const { docs } = await payload.find({
  collection: 'pages',
  where: { slug: { equals: slug } },
  draft,
  ...(await onpageContext()), // in edit mode: invisible field markers (auto-mapping)
})
```

Use `isDraftEnabled()` for draft checks: it also ends draft access for editors who signed out, and it honors preview-link grants on the shared page only.

**Check:** click **Edit on page**. The page opens with a dock at the bottom; click any heading or paragraph to edit it.

## 5. Preview links need no proxy

There is no middleware step. **Share** in the dock copies a signed, expiring link; whoever opens it sees the draft of that one page, read-only. The grant is a sealed cookie the browser can't mint or move to another path, and page reads re-verify it on every request.

**Check:** copy a preview link in the admin and open it in a private window. The draft shows with a "Shared preview" bar; other pages show published content.

## 6. Verify nothing leaks to visitors

```bash
curl -s https://your-site.test/ | grep -c 'data-onpage'   # → 0
```

## Next

- Make images, rows and non-text fields clickable: [annotations](guides/annotations.md).
- Instant updates while typing: [client mode](guides/client-mode.md).
- Production hardening: [security](concepts/security.md).
