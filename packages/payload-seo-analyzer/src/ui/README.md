# Admin UI conventions

The plugin's admin UI must look like part of Payload 4: same components, same tokens,
correct in light and dark mode. Payload 4 removed the v3 tokens (`--theme-elevation-*`,
`--theme-text`, `--theme-border-color`, `--font-body`, `--base`…), so any
`var(--theme-…, #fallback)` renders its hard-coded light fallback. Don't use them.

## Order of preference

1. **`@payloadcms/ui` components**: `Button`, `Pill`, `Banner`, `Collapsible`, `Tabs`,
   `Tooltip`, `Spinner`, `ShimmerEffect`, `Drawer`/`DrawerToggler`/`useModal`,
   `ConfirmationModal`, `Popup`/`PopupList`, `CopyToClipboard`, `Link`, and the icons
   (`CheckIcon`, `XIcon`, `EditIcon`, `TrashIcon`, `PlusIcon`, `SearchIcon`,
   `RefreshIcon`, `ChevronIcon`, `WarningIcon`, `InfoIcon`, `NewTabIcon`,
   `LinkIcon`, `CopyIcon`, `SuccessIcon`, `ErrorIcon`, `SortUpIcon`/`SortDownIcon`…).
2. **`../ui/index.js` primitives** for what Payload doesn't export:
   `ViewHeader`, `ViewBody`, `Card`, `StatTile`, `Grid`, `ScorePill`, `TonePill`,
   `ScoreRing`, `Meter`, `Dot`, `DataTable`, `Checklist`, `EmptyState`,
   `LoadingState`, `Field`, plus `scoreTone` / `statusTone` / `rangeTone` /
   `pillStyle` / `bannerType` / `TONE_*` / `CHART_COLORS` / `cx`.
3. **Classes from `styles.css`** (`seo-stack`, `seo-row`, `seo-text--secondary`,
   `seo-input`, `seo-select`, `seo-inset`…).
4. **Component-specific CSS** in a co-located file (`components/Foo.css`, imported
   from `Foo.tsx`), BEM classes prefixed `seo-foo__…`, Payload tokens only.
5. **Inline `style`** only for values computed from data (a bar width, an SVG
   coordinate, a grid column count). Never for colors, fonts, borders or spacing
   constants.

## Mapping

| Old pattern | Use |
|---|---|
| `<button style={…}>` | `Button`: `buttonStyle="primary"` for the one main action, `"secondary"` for others, `"ghost"` for low-emphasis/icon-only (with `aria-label`), `"destructive"` for delete. `size` is `"medium"` (default) or `"large"`. |
| badge / chip / tag | `Pill` / `TonePill` / `ScorePill` |
| colored notice, error box, info box | `Banner type="danger" \| "warning" \| "success" \| "brand" \| "default"` |
| expandable section with ▼ | `Collapsible header={…}` |
| tab bar | `Tabs tabs={[{ label, value }]} value onChange` |
| bordered box / panel | `Card` (`title`, `actions`, `footer`, `flush`) |
| page title row in a view | `ViewHeader title description actions` followed by `ViewBody` |
| number + caption tiles | `Grid` of `StatTile` (`tone` from `scoreTone`) |
| `<table>` | `DataTable` around a plain `<table>`; numeric cells `className="seo-table__num"`; sortable headers keep their `<button>` |
| score circle / gauge | `ScoreRing` |
| progress / ratio bar | `Meter` |
| pass/warn/fail list | `Checklist` (`tone` from `statusTone`) |
| "Loading…" text | `LoadingState` or `Spinner` |
| nothing to show | `EmptyState` |
| text input / select / textarea outside a Payload form | `<input className="seo-input">`, `<select className="seo-select">`, `<textarea className="seo-textarea">`, wrapped in `Field` for a label |
| chart colors | `TONE_MARK[tone]`, `CHART_COLORS[i]`, classes `seo-chart__grid`, `seo-chart__axis-label` |

## Style rules

- No hex, `rgb()` or named colors. The only exception is a mock-up of a third-party
  surface (Google result, social card), which keeps that service's own colors
  inside its frame (`seo-serp`).
- No neo-brutalist styling: no thick black borders, offset/hard shadows, all-caps
  heavy labels, or bright cyan/yellow/orange fills. Borders are
  `var(--stroke-width-small) solid var(--color-border)`, radius `--radius-medium`
  (cards) or `--radius-small` (insets).
- Typography comes from tokens: `seo-heading`, `seo-text`, `seo-text--small`,
  `seo-text--secondary`, `seo-mono`. Sentence case, not uppercase.
- No emoji as decoration in labels or buttons; use a Payload icon if an icon helps.
- Status colors only through tones (`success` / `warning` / `danger` / `brand` /
  `neutral`).
- Keep every behavior: data fetching, handlers, props, exports, translations,
  `useId`-based ids, `aria-*` attributes, real `<button>`s for interactive elements.
  The tests in `src/__tests__` are the contract.
