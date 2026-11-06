import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { blocks, pageBlockSlugs, sectionBlockSlugs } from '@/blocks'
import { blockComponents, type LayoutBlock, type LayoutBlockType } from '@/blocks/components'
import { blockMetas } from '@/blocks/gallery'
import { RenderBlocks } from '@/blocks/RenderBlocks'
import { DraftModeProvider } from '@/blocks/shared/draftMode'

// Blocks render TanStack `Link`s (CMSLink), which need a router. A minimal one is enough to
// build hrefs for `/` and `/$slug`.
const rootRoute = createRootRoute()
const router = createRouter({
  history: createMemoryHistory(),
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$slug' }),
  ]),
})

// In draft mode, as editors see a new block (editor-only placeholders included).
const render = (block: LayoutBlock, draft = true) =>
  renderToStaticMarkup(
    <RouterContextProvider router={router as never}>
      <DraftModeProvider draft={draft}>
        <RenderBlocks blocks={[block]} />
      </DraftModeProvider>
    </RouterContextProvider>,
  )

const slugs = Object.keys(blockMetas) as LayoutBlockType[]

describe('block registry', () => {
  it('has a component and gallery entry for every configured block', () => {
    const configured = blocks.map(({ slug }) => slug).sort()
    expect(Object.keys(blockComponents).sort()).toEqual(configured)
    expect(Object.keys(blockMetas).sort()).toEqual(configured)
  })

  it('keeps page-only blocks out of reusable sections', () => {
    expect(pageBlockSlugs).toEqual(blocks.map(({ slug }) => slug))
    expect(sectionBlockSlugs).not.toContain('globalSection')
  })

  it.each(blocks.map((block) => [block.slug, block] as const))(
    '%s: interface name, picker thumbnail and on-page example',
    (slug, block) => {
      expect(block.interfaceName).toMatch(/Block$/)
      const thumbnail = block.admin?.images?.thumbnail
      expect(typeof thumbnail === 'object' && thumbnail.url).toMatch(/^data:image\/svg\+xml,/)
      expect(block.admin?.group).toBe(blockMetas[slug as LayoutBlockType].group)
      expect(block.admin?.custom?.onpage?.example).toBe(blockMetas[slug as LayoutBlockType].example)
    },
  )
})

describe('block rendering', () => {
  const cases = slugs.flatMap((slug) =>
    (blockMetas[slug].variants ?? [undefined]).map((variant) => [slug, variant?.value] as const),
  )

  it.each(cases)('%s (%s) renders its example', (slug, variant) => {
    const html = render({
      ...blockMetas[slug].example,
      blockType: slug,
      id: 'example',
      ...(variant ? { variant } : {}),
      ...(blockMetas[slug].section === false
        ? {}
        : { section: { background: 'dark', spacing: 'md', anchor: 'example' } }),
    } as LayoutBlock)

    if (blockMetas[slug].section !== false) {
      expect(html).toContain(`data-block="${slug}"`)
      expect(html).toContain('id="example"')
    }
    expect(html.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0)
  })

  it('renders list examples as real lists: bulleted, numbered and nested', () => {
    const html = render({
      ...blockMetas.richText.example,
      blockType: 'richText',
      id: 'lists',
    } as LayoutBlock)
    expect(html).toContain('<ul class="list-bullet">')
    expect(html).toContain('<ol class="list-number">')
    // The nested list sits inside a list item of the outer one.
    expect(html).toMatch(/<li[^>]*><ul class="list-bullet">/)
    expect(html).toContain('Narrow for reading')
  })

  // What the admin's block drawer creates: defaults only, every optional field empty.
  it.each(cases)('%s (%s) renders with every optional field empty', (slug, variant) => {
    expect(() =>
      render({ blockType: slug, id: 'empty', ...(variant ? { variant } : {}) } as LayoutBlock),
    ).not.toThrow()
  })

  it('shows visitors nothing for a global section whose section is missing', () => {
    const block = { blockType: 'globalSection', id: 'missing' } as LayoutBlock
    expect(render(block)).toContain('Choose a reusable section')
    expect(render(block, false)).toBe('')
  })
})
