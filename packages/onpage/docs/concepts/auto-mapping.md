# Auto-mapping

In edit mode, every displayable string a page reads carries an **invisible marker**: zero-width characters encoding `{ document, field path, kind }`. The editor scans the rendered DOM for markers and knows, with no annotations, that this `<h2>` is `layout.2.heading` of page 12.

## What gets marked

- `text` and `textarea` values
- rich-text text nodes (mapped to the rich-text field as a whole)
- the `alt` of populated uploads, carrying the **upload field's** path, so `<img alt>` maps the image

Never marked:

- selects, numbers, dates, checkboxes, relationships, JSON, code
- fields whose name has a machine-like segment: `url`, `href`, `link`, `path`, `email`, `phone`, `slug`, `key`, `token`, `anchor`, `id`, `class`, `style`, `icon`, `color`, `hex`. Matching is by camelCase or snake segment, so `ctaUrl` is skipped but `lifestyleTitle` isn't. It applies to each field's **own** name, not its parents': in a group named `link` (Payload's website template), `link.label` is marked and `link.url` isn't.
- fields with a non-text editor (`admin.custom.onpage.editor: 'color'`)

Narrow it further with the plugin's `encode` option:

```ts
onpage({
  collections: ['pages'],
  session: nextSession(),
  encode: ({ field, path }) => !path.startsWith('seo.'),
})
```

## Lifecycle

1. `onpageContext()` returns `{ context: { onpage: true } }` in edit mode only. Payload passes it to hooks.
2. The plugin's `afterRead` hook marks strings only for reads with that context. REST, admin and GraphQL reads stay clean.
3. `beforeValidate`/`beforeChange` hooks strip markers from **every** write, so markers can't be stored.
4. In the browser, the `stega()` locator maps text nodes and `img[alt]`, and infers rows and lists from where their fields render.

## Caveats

A marker is a run of invisible characters appended to the end of the string, so anything that changes the string, or uses it as anything other than text, can lose or expose it. Only in edit mode: visitors get the plain string.

| What your component does with the string                                            | In edit mode                                                                                                        | Do this                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Renders it as is (CSS `text-transform`, `line-clamp` included)                      | Maps                                                                                                                |                                                                                  |
| Upper- or lowercases it in JS (`toUpperCase()`)                                     | Still maps. While you type, the stored text shows in its own case                                                   | Prefer CSS `text-transform`                                                      |
| Truncates it (`slice`, `substring`, a `truncate()` helper)                          | When it cuts, the marker goes with the end: the text isn't clickable                                                | CSS `line-clamp` / `text-overflow`, or annotate the element with `e.field(path)` |
| Splits it into words or letters (`split(' ')` into spans)                           | Only the last piece carries the marker                                                                              | Annotate the wrapper with `e.field(path)`                                        |
| Measures or compares it (`.length`, `===`, `startsWith`, `includes`)                | Results change: the string is longer                                                                                | Compare `stegaClean(value)`                                                      |
| Turns it into an id, slug or URL (`slugify`, `encodeURIComponent`, heading anchors) | Ids and links differ in edit mode, so in-page anchors break                                                         | `stegaClean(value)` first                                                        |
| Puts it in an attribute (`aria-label`, `title`, `placeholder`, `href`)              | Not clickable from there (only text and `img[alt]` are scanned), and the attribute carries the invisible characters | `stegaClean(value)` for attributes                                               |
| Uses it in `<title>`, meta, Open Graph or JSON-LD (`generateMetadata`)              | Invisible characters in the head                                                                                    | `stegaCleanDeep(doc)` in `generateMetadata`                                      |
| Joins two fields in one text node (`${first} ${last}`)                              | Both fields map to the same element                                                                                 | Render each in its own element                                                   |
| Formats dates, numbers or selects                                                   | Unaffected: those aren't marked                                                                                     |                                                                                  |

`stegaClean` and `stegaCleanDeep` come from `@shipment/onpage-core`; `e.field(path)` is an [annotation](../guides/annotations.md).

- **Strings used as identifiers** (CSS classes, keys, ids) should come from fields that aren't marked; see the list above.
- **Rows** are inferred when their fields render inside a common wrapper. For exact rows, or rows without text, use [annotations](../guides/annotations.md).
