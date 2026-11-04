# Globals and multiple documents

A page often shows several documents: the page, a header global, a footer global, embedded documents. Enable each in the plugin and read each with `onpageContext()`:

```ts
onpage({ collections: ['pages'], globals: ['header', 'footer'], session: nextSession() })

const header = await payload.findGlobal({ slug: 'header', draft, ...(await onpageContext()) })
```

The editor opens every document it finds on the page:

- Each saves on its own, and undo spans all of them in order.
- **Publish** publishes every document on the page that has unpublished changes.
- The dock shows "N documents".
- Document refs are `c:<collection>:<id>` or `g:<global>`; markers and annotations carry them.
