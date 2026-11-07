# payload-onpage documentation

Upstream's guides for on-page editing on **Payload 4 + TanStack Start**, kept with the fork. Package names are ours (`@shipment/onpage-*`); some pages still mention the Next.js adapter, which the fork dropped. How Shipment wires it in, and what the fork changed, is in [the fork's README](../README.md).

| Start here                                                         |                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| [Getting started with TanStack Start](getting-started-tanstack.md) | The three integration steps (plugin, `<OnPage />`, draft reads)     |
| [Compatibility](compatibility.md)                                  | The Payload, TanStack Start, Lexical and React versions we build on |
| [Troubleshooting](troubleshooting.md)                              | The usual suspects, with fixes                                      |

**Concepts**

- [Architecture](concepts/architecture.md): packages, ports, and what happens from "Edit on page" to a saved change.
- [Auto-mapping](concepts/auto-mapping.md): how page text maps back to fields without annotations.
- [Modes](concepts/modes.md): edit, preview and share links; refresh vs client rendering.
- [Security](concepts/security.md): the threat model, access, cookies, preview links, CSRF.

**Guides**

- [With Payload's plugins](guides/plugins.md): SEO, nested docs, redirects, search, form builder, multi-tenant, storage adapters.
- [Annotations](guides/annotations.md): precise mapping for rows, lists, images and non-text fields.
- [Page settings, history and publishing](guides/publishing.md): SEO and other page fields, versions and restore, choosing what to publish, scheduling.
- [Comments and review requests](guides/comments-and-review.md): discuss a page on the page; ask for a review; comments from share links.
- [Several editors](guides/collaboration.md): document locks, conflicts and invalid fields.
- [Logging and error reporting](guides/events.md): `onEvent`, with a Sentry recipe.
- [Writing assistant](guides/assist.md): bring your own AI for rewriting text fields.
- [Testing your integration](guides/testing.md): an in-memory data source, and end-to-end recipes.
- [Client mode](guides/client-mode.md): instant edits without a server round trip.
- [Block thumbnails and previews](guides/block-picker.md): thumbnails in the section picker, and live previews in client mode.
- [Globals and multiple documents](guides/globals-and-multiple-documents.md)
- [Custom field editor](guides/custom-field-editor.md)
- [Custom data source](guides/custom-data-source.md)
- [Custom media library](guides/custom-media-library.md)
- [Localization](guides/localization.md): content locales and editor UI strings.
