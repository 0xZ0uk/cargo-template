# Annotations

Auto-mapping covers most text. Annotations add precision where markers can't reach:

- rows and lists you want exact (and "+ Add" for empty lists)
- images without alt text
- non-text values (dates, selects, relationships, colors) shown on the page

`editable()` is server-safe and pure. With `enabled: false` every helper returns `{}`, so public HTML carries nothing.

```tsx
import { editable } from '@cargo/onpage-react/annotations'
import { getOnPageMode } from '@cargo/onpage-next'

const e = editable({ collection: 'pages', doc: page }, { enabled: (await getOnPageMode()) === 'edit' })

<section {...e.row('layout.2', 'Hero')}>
  <img {...e.media('layout.2.image')} src={img.url} alt="" />
  <time {...e.field('publishedAt', 'field', 'Publish date')}>{format(page.publishedAt)}</time>
  <ul {...e.list('layout.2.items', 'Feature')}>
    {items.map((it, j) => <li key={it.id} {...e.row(`layout.2.items.${j}`, 'Feature')}>…</li>)}
  </ul>
</section>
```

| Helper                         | Use for                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `e.field(path, kind?, label?)` | An element showing one field. `kind` defaults to `field` (resolved from the schema); `text`/`textarea`/`richtext`/`media` force one. |
| `e.media(path, label?)`        | An element showing an upload field                                                                                                   |
| `e.row(path, label?)`          | A row of an array or blocks field (toolbar: move, duplicate, settings, delete)                                                       |
| `e.list(path, itemLabel?)`     | The element holding an array's rows ("+ Add")                                                                                        |

Globals: `editable({ global: 'header' }, …)`. Paths are dotted with numeric indexes (`p('layout', i, 'heading')` builds them).

When both apply, annotations win over inferred targets. Example: [`examples/basic/src/components/PageView.tsx`](../../examples/basic/src/components/PageView.tsx).
