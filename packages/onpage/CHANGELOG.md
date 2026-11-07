# Changelog

## 0.1.0 (unreleased)

- First release.
- Works with any collection or global, and several documents on one page with one shared undo history.
- Auto-mapping through invisible markers (text, rich text, image alt), with optional annotations for precise rows and lists.
- Server-refresh rendering by default; client mode (`OnPageClient`) for instant updates.
- Field editors: text, textarea, email, select, radio, checkbox, number, date, relationship, upload, color, and rich text (Lexical). Each can be replaced through the registry.
- Preview mode with device frames, plus signed, path-scoped shareable draft links, and an optional proxy (`@shipment/onpage-next/proxy`) that limits home-page links to the home page.
- Client mode auto-maps text the same way refresh mode does.
- Runnable SQLite example (`examples/basic`).
- Ports: DataSource, MediaLibrary, Locator, Renderer, SessionAdapter.
