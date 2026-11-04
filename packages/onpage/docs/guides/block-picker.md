# Block thumbnails and previews

The on-page **Add section** picker shows each block of a `blocks` field. It reads the same block config as Payload's admin, so a site that already has block thumbnails gets them on the page with no extra work.

## Thumbnails and groups

Set Payload's own block options. The admin's block drawer uses them too.

```ts
import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  admin: {
    images: {
      // A URL, or { url, alt }. Aspect ratio 3:2 (e.g. 480×320).
      thumbnail: { url: '/blocks/hero.svg', alt: 'A large heading with a button' },
    },
    group: 'Headers', // or translations: { en: 'Headers', de: 'Kopfbereiche' }
  },
  fields: [/* … */],
}
```

- The deprecated `imageURL` / `imageAltText` still work.
- A block without a thumbnail gets a placeholder tile.
- Groups come first, in config order, then ungrouped blocks, as in Payload's block drawer.
- Relative URLs resolve against the site, so put the images in the site's `public/` folder (see the [example](../../examples/basic/public/blocks)).

## Saved sections

With the plugin's `patterns: true`, a section's toolbar has **Save this section**. Give it a name, and it's listed under **Saved sections** in the picker of every list that accepts its block type. Choosing one inserts a copy, with fresh row ids. In client mode it previews like any block.

Saved sections are kept in an `onpage-patterns` collection the plugin adds (generate a migration), so you can rename or delete them in the admin.

## Live previews (client mode)

For a document rendered with [`<OnPageClient>`](client-mode.md), the picker opens as a side panel. Pointing at a block, or focusing it with the keyboard, shows it **on the page, at the insertion point**.

- The preview isn't saved and doesn't go into undo history. Escape, ✕ or a click on the page removes it.
- Choosing a block inserts it as one undoable change, and saves it. It starts from its field **defaults**, or from its example with `insertExample` (below).
- When the picker opens, focus is on the first card. Keyboard focus previews a block once you press a key (Tab), and the block shown on the page stays highlighted.
- In refresh mode (the default), the picker shows thumbnails only. A server-rendered page can't show a block before it's saved.

A brand-new block has only its defaults, so it can look empty in a preview. Give it sample content for previews only with `admin.custom.onpage.example`:

```ts
export const Features: Block = {
  slug: 'features',
  admin: {
    custom: {
      onpage: {
        example: {
          heading: 'Why people choose us',
          items: [
            { title: 'Fast', description: 'Pages load in a blink.' },
            { title: 'Friendly', description: 'Edit right on the page.' },
          ],
        },
      },
    },
  },
  fields: [/* … */],
}
```

The example is merged over the defaults for the preview. Nested rows get fresh ids, and the example's values must be JSON (rich text as Lexical JSON).

By default the example is preview-only: a chosen block starts from its defaults. To start a new block from its example instead, set `insertExample` beside it:

```ts
admin: {
  custom: { onpage: { example: { heading: 'Why people choose us' }, insertExample: true } },
}
```

The editor then changes the sample content in place, like any other content.
