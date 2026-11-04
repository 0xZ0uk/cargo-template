# Custom media library

`MediaLibrary` powers the image picker. The default, `payloadUploads()`, searches and uploads to a Payload upload collection.

```ts
import type { MediaLibrary } from '@cargo/onpage-core'

export const cloudinaryLibrary = (): MediaLibrary => ({
  async search({ query, page, relationTo, signal }) {
    // `signal` aborts a search the user has moved on from.
    const res = await fetch(
      `/api/my-dam/search?q=${encodeURIComponent(query ?? '')}&page=${page}`,
      { signal },
    )
    const body = await res.json()
    return {
      // `doc` is what gets stored in the field (and rendered in client mode): usually the upload document.
      items: body.results.map((r) => ({
        id: r.payloadId,
        url: r.url,
        thumbnailUrl: r.thumb,
        alt: r.alt,
        doc: r.payloadDoc,
      })),
      hasMore: body.hasMore,
    }
  },
  // Optional: enables "Upload…". The editor asks for the alt text first.
  async upload(file, { relationTo, alt }) {
    /* … */
  },
  // Optional: enables editing the current image's alt text. Strip markers
  // (stegaClean) if the value goes back to Payload.
  async updateAlt(id, { relationTo, alt }) {
    /* … */
  },
})
```

Pass it with `<OnPageMount {...p} media={cloudinaryLibrary()} />`. Without a media library, upload fields can't be changed on the page.
