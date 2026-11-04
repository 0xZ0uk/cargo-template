# Architecture

## Packages

| Package                        | Runs on        | Depends on           | Responsibility                                                                                                                                           |
| ------------------------------ | -------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cargo/onpage-core`           | anywhere       | nothing              | Document refs, paths, field ops, the editor session, autosave, markers, sealing, **port interfaces**. `core/payload`: the default Payload REST adapters. |
| `@cargo/onpage-plugin`         | Payload server | core, payload        | Endpoints, access, schema, marker hooks, stale-write guard, admin controls.                                                                              |
| `@cargo/onpage-react`          | browser        | core, react          | Editor UI, field editors, locators, annotations, client mode. `react/editor-kit`: building blocks for custom editors.                                    |
| `@cargo/onpage-lexical`        | browser        | core, react, lexical | Rich-text field editor (loaded lazily).                                                                                                                  |
| `@cargo/onpage-next`           | Next.js        | core, react, lexical | Session adapter, `<OnPage />`, `onpageContext()`, refresh renderer, proxy.                                                                               |
| `@cargo/onpage-tanstack-start` | TanStack Start | core, react, lexical | Session adapter, `<OnPage />`, `onpageContext()`, refresh renderer. No proxy: reads verify the sealed grant directly.                                    |

Package boundaries are enforced by lint (`no-restricted-imports`): core imports no framework, react imports no Next or Payload, and so on.

## Ports and adapters

Each port is a TypeScript interface in `core/src/ports.ts`. The defaults ship, and you can replace any of them.

| Port                                                                    | Default adapter                                                                                     | Swap it for                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `DataSource`: schema, documents, drafts, publish, search, preview links | `payloadRest()` (`core/payload`)                                                                    | GraphQL, server actions, custom auth                 |
| `MediaLibrary`: image search and upload                                 | `payloadUploads()`                                                                                  | A DAM (Cloudinary, Bynder…)                          |
| `Locator`: page elements → fields                                       | `composite(annotations(), stega())`                                                                 | Your own markup conventions                          |
| `Renderer`: show a saved change                                         | `useNextRefresh()`; `clientState()`; `fullReload()`                                                 | Another router                                       |
| `SessionAdapter`: edit/preview access (server)                          | `nextSession()`                                                                                     | Another framework                                    |
| Field editors: edit one field                                           | text, textarea, email, select, radio, checkbox, number, date, relationship, upload, color, richText | Anything ([guide](../guides/custom-field-editor.md)) |

## From "Edit on page" to a saved change

```
admin "Edit on page"  ──POST /api/onpage/enter──▶  plugin: access check (Payload's docAccessOperation)
                                                    session.enable('edit', bound to the auth cookie)
                                                    303 → the document's page
page render (draft)   ──onpageContext()──────────▶  plugin afterRead: strings get invisible markers
<OnPage /> (client)   ──lazy──▶ editor: locator scans the DOM → targets → session.open(doc)
click a heading       ──▶ field editor (registry) ──▶ session.setValue ──▶ autosave (debounced)
                                                    PATCH /api/pages/:id?draft=true (Payload REST)
                                                    plugin: strip markers, 409 if stale
renderer.afterSave    ──router.refresh()──────────▶ new server render; the ghost is retired
```

**Client mode** skips the refresh: `<OnPageClient>` renders from session state, with markers re-applied to the state it renders.

## State

`EditorSession` (core) is framework-free and observable (`subscribe`/`getSnapshot`).

- One state per document (schema, draft, save state); undo is session-wide.
- Publish, discard and reload run one at a time and re-read state after every await.
- Autosave is single-flight. It retries transient failures (network, 429, 5xx); a 409 freezes the queue until reload or discard.
