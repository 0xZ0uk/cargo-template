import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import React from 'react'

import type { LayoutBlock, LayoutBlockType } from '@/blocks/components'
import { blockMetas } from '@/blocks/gallery'
import { RenderBlocks } from '@/blocks/RenderBlocks'
import { DraftModeProvider } from '@/blocks/shared/draftMode'
import { blockGroups } from '@/blocks/shared/meta'

type GallerySearch = { block?: string; background?: 'dark' | 'default' | 'muted' }

/**
 * Dev-only gallery: every block's example in every variant, from `src/blocks/gallery.ts`.
 * `?block=<slug>` shows one block; `?background=dark|muted` switches every section. A 404 in
 * production builds.
 */
export const Route = createFileRoute('/_frontend/dev/blocks')({
  validateSearch: (search: Record<string, unknown>): GallerySearch => ({
    block: typeof search.block === 'string' ? search.block : undefined,
    background:
      search.background === 'dark' || search.background === 'muted' ? search.background : undefined,
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }, { title: 'Blocks' }] }),
  component: BlockGallery,
})

/** The example of `slug` as a layout block, in `variant`. */
const exampleBlock = (
  slug: LayoutBlockType,
  variant: string | undefined,
  background: GallerySearch['background'],
): LayoutBlock => {
  const meta = blockMetas[slug]
  return {
    ...meta.example,
    blockType: slug,
    id: `${slug}-${variant ?? 'default'}`,
    ...(variant ? { variant } : {}),
    ...(meta.section === false
      ? {}
      : { section: { background: background ?? 'default', spacing: 'md' } }),
  } as LayoutBlock
}

function BlockGallery() {
  const { background, block } = Route.useSearch()
  const slugs = (Object.keys(blockMetas) as LayoutBlockType[])
    .filter((slug) => !block || slug === block)
    .sort(
      (a, b) => blockGroups.indexOf(blockMetas[a].group) - blockGroups.indexOf(blockMetas[b].group),
    )

  return (
    <main>
      <nav className="container flex flex-wrap gap-x-4 gap-y-2 border-b py-4 text-sm">
        <Link className="font-medium" search={{ background }} to="/dev/blocks">
          All blocks
        </Link>
        {slugs.length > 1 &&
          slugs.map((slug) => (
            <Link
              className="text-muted-foreground hover:text-foreground"
              key={slug}
              search={{ background, block: slug }}
              to="/dev/blocks"
            >
              {blockMetas[slug].labels.singular}
            </Link>
          ))}
      </nav>

      {slugs.map((slug) => {
        const meta = blockMetas[slug]
        const variants = meta.variants ?? [undefined]

        return variants.map((variant) => (
          <div
            data-gallery-block={slug}
            data-gallery-variant={variant?.value}
            key={`${slug}-${variant?.value}`}
          >
            <p className="container border-t pt-4 font-mono text-xs text-muted-foreground">
              {meta.group} / {meta.labels.singular}
              {variant && ` / ${variant.label}`}
            </p>
            <DraftModeProvider draft>
              <RenderBlocks blocks={[exampleBlock(slug, variant?.value, background)]} />
            </DraftModeProvider>
          </div>
        ))
      })}
    </main>
  )
}
