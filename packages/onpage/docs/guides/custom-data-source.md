# Custom data source

Implement `DataSource` (from `@shipment/onpage-core`) to load and save through something other than Payload REST: GraphQL, server actions, a custom auth header.

```ts
import type { DataSource } from '@shipment/onpage-core'

export const graphqlSource = (endpoint: string): DataSource => ({
  loadSchema: (ref, { locale }) =>
    fetch(`/api/onpage/schema/${ref.kind}/${ref.slug}?locale=${locale ?? ''}`).then((r) =>
      r.json(),
    ),
  async loadDocument(ref, { draft, locale }) {
    /* query by ref; return the document (populated, depth 2) */
  },
  async saveDraft(ref, data, { locale, updatedAt }) {
    // Save only `data` (the changed top-level fields) as a draft.
    // Send `updatedAt` as the x-onpage-if-unmodified-since header (or your own check)
    // and return { ok: false, status: 409 } when someone else saved first
    // (a failure always has a status: 0 for a network error).
    return { ok: true, updatedAt: '…new updatedAt…' }
  },
  async publish(ref, data, opts) {
    /* save with _status: 'published' */ return { ok: true }
  },
  // Optional:
  async search(collection, { query, titleField, limit, signal }) {
    // Pass `signal` to fetch: it aborts when the user keeps typing.
    return [/* { id, title, doc } */]
  },
  async createPreviewLink(ref, { locale }) {
    return { url: '…', expiresAt: '…' }
  },
})
```

Pass it from a client mount: `<OnPageMount {...p} dataSource={graphqlSource('/api/graphql')} />`.

## Contract

| Method                           | Must                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `loadSchema`                     | Return the plugin's schema JSON (or your own `DocumentSchema`)       |
| `loadDocument`                   | Return the draft (`draft: true`) or published version                |
| `saveDraft`                      | Save only the given fields; return `updatedAt`; 409 on a stale write |
| `publish`                        | Make the given values live                                           |
| `search` _(optional)_            | Find documents by title for relationship fields                      |
| `createPreviewLink` _(optional)_ | Enables the dock's **Share**                                         |

Errors: return `{ ok: false, status, message }`. 0, 429 and 5xx are retried; other statuses stop with your message shown.

The default adapter, [`core/src/payload.ts`](../../packages/core/src/payload.ts), is a complete reference, and its tests ([`payload-adapter.test.ts`](../../packages/core/src/__tests__/payload-adapter.test.ts)) can be copied as a contract test.
