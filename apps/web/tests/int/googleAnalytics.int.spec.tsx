import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { PageTemplate } from '@/components/PageTemplate'
import { gaMeasurementIdFor, gtagScripts } from '@/utilities/googleAnalytics'
import { pageHead } from '@/utilities/pageHead'

// GA4 is optional (`GA_MEASUREMENT_ID`): without an id nothing GA-related renders, and drafts
// never get it. The plugin's tracker is replaced by a marker so its presence shows in markup.
vi.mock('@cargo/payload-plugin-ab/analytics', () => ({
  ExperimentTracker: ({ experimentId }: { experimentId: string }) => (
    <i data-test="experiment-tracker" data-experiment={experimentId} />
  ),
}))

const ID = 'G-TEST123456'

const rootRoute = createRootRoute()
const router = createRouter({
  history: createMemoryHistory(),
  routeTree: rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/$slug' }),
  ]),
})

const page = { layout: [], slug: 'pricing', title: 'Pricing' } as never

const data = (gaMeasurementId?: string | null) =>
  ({
    canonicalSlug: 'pricing',
    draft: false,
    gaMeasurementId,
    jsonLd: [],
    livePreview: false,
    origin: 'https://example.com',
    page,
    siteUrl: 'https://example.com',
  }) as never

const render = (props: Partial<React.ComponentProps<typeof PageTemplate>>) =>
  renderToStaticMarkup(
    <RouterContextProvider router={router as never}>
      <PageTemplate draft={false} livePreview={false} page={page} {...props} />
    </RouterContextProvider>,
  )

describe('gaMeasurementIdFor', () => {
  it('passes a G- id for a published view', () => {
    expect(gaMeasurementIdFor(ID, false)).toBe(ID)
  })

  it('is null when unset, empty or malformed', () => {
    expect(gaMeasurementIdFor(undefined, false)).toBeNull()
    expect(gaMeasurementIdFor('', false)).toBeNull()
    expect(gaMeasurementIdFor("G-1');alert(1)//", false)).toBeNull()
    expect(gaMeasurementIdFor('UA-123456-1', false)).toBeNull()
  })

  it('is null for a draft (live preview, on-page editing, preview links)', () => {
    expect(gaMeasurementIdFor(ID, true)).toBeNull()
  })
})

describe('head scripts', () => {
  it('loads gtag.js async and defines gtag when the id is set', () => {
    const scripts = pageHead(data(ID)).scripts
    expect(scripts).toContainEqual({
      async: true,
      src: `https://www.googletagmanager.com/gtag/js?id=${ID}`,
    })
    expect(JSON.stringify(scripts)).toContain('function gtag()')
    // The id never reaches the inline snippet.
    expect(scripts?.some((s) => 'children' in s && String(s.children).includes(ID))).toBe(false)
  })

  it('adds nothing without an id', () => {
    for (const id of [undefined, null, '']) {
      expect(pageHead(data(id)).scripts).toEqual([])
    }
    expect(gtagScripts()).toEqual([])
    expect(JSON.stringify(pageHead(data()))).not.toContain('googletagmanager')
  })

  it('adds nothing for a malformed id', () => {
    expect(gtagScripts('G-1&x=<script>')).toEqual([])
  })
})

describe('PageTemplate', () => {
  it('renders the tracker only on an experiment page, and only with an id', () => {
    const html = render({ experiment: '/pricing', gaMeasurementId: ID })
    expect(html).toContain('data-test="experiment-tracker"')
    expect(html).toContain('data-experiment="/pricing"')

    expect(render({ gaMeasurementId: ID })).not.toContain('experiment-tracker')
    expect(render({ experiment: null, gaMeasurementId: ID })).not.toContain('experiment-tracker')
    expect(render({ experiment: '/pricing' })).not.toContain('experiment-tracker')
    expect(render({ experiment: '/pricing', gaMeasurementId: null })).not.toContain(
      'experiment-tracker',
    )
  })

  it('renders no tracker in a draft even if an id leaks through', () => {
    expect(render({ draft: true, experiment: '/pricing', gaMeasurementId: ID })).not.toContain(
      'experiment-tracker',
    )
  })
})
