// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

// @payloadcms/ui is a peer dependency whose entry point imports CSS, which the
// node/jsdom loader cannot parse. Only `useConfig` is reached from here
// (through useDashboardT, which has no default context) — so this stub matches
// its behaviour outside a provider rather than replacing it.
vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useConfig: () => undefined,
}))

import { SerpPreview } from '../components/SerpPreview.js'
import { SeoSocialPreview } from '../components/SeoSocialPreview.js'
import { LiveRegion } from '../components/LiveRegion.js'

afterEach(cleanup)

describe('collapsible headers are real buttons', () => {
  it('SerpPreview: the header is a <button> with aria-expanded, not a clickable div', () => {
    render(<SerpPreview metaTitle="Titre" metaDescription="Desc" slug="page" />)

    const header = screen.getAllByRole('button')[0]
    expect(header.tagName).toBe('BUTTON')
    // Without type="button" this would submit Payload's document form, since
    // SerpPreview is mounted in the sidebar inside it.
    expect(header.getAttribute('type')).toBe('button')
    expect(header.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('SeoSocialPreview: same header contract', () => {
    render(<SeoSocialPreview metaTitle="Titre" metaDescription="Desc" hostname="exemple.fr" />)
    const header = screen.getAllByRole('button')[0]
    expect(header.tagName).toBe('BUTTON')
    expect(header.getAttribute('type')).toBe('button')
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('SerpPreview shows the values it is given', () => {
  it('renders the title and description, bolds the keyphrase and drops the placeholders', () => {
    const { container } = render(
      <SerpPreview
        hostname="exemple.fr"
        keyphrases={['café']}
        metaDescription="Notre guide du CAFE de spécialité"
        metaTitle="Le meilleur café de Paris"
        slug="guide"
      />,
    )
    fireEvent.click(screen.getAllByRole('button')[0]) // the preview starts collapsed
    const title = container.querySelector('.seo-serp__title') as HTMLElement
    const desc = container.querySelector('.seo-serp__description') as HTMLElement
    expect(title.textContent).toBe('Le meilleur café de Paris')
    expect(desc.textContent).toBe('Notre guide du CAFE de spécialité')
    expect(title.querySelector('strong')?.textContent).toBe('café')
    expect(desc.querySelector('strong')?.textContent).toBe('CAFE')
    expect(container.textContent).not.toMatch(/no meta (title|description)/i)
    expect(container.textContent).toContain('exemple.fr')
  })

  it('cuts a long description at a word boundary for the active device', () => {
    const words = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')
    const { container } = render(<SerpPreview metaDescription={words} metaTitle="T" />)
    fireEvent.click(screen.getAllByRole('button')[0])
    const desc = () => (container.querySelector('.seo-serp__description') as HTMLElement).textContent as string
    const desktop = desc()
    expect(desktop.endsWith(' …')).toBe(true)
    expect(desktop.length).toBeLessThanOrEqual(162)
    expect(words.startsWith(desktop.slice(0, -2))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /mobile/i }))
    expect(desc().length).toBeLessThan(desktop.length)
  })
})

describe('SeoSocialPreview — ARIA tabs', () => {
  it('exposes a tablist whose selected tab is announced, and a panel bound to it', () => {
    render(<SeoSocialPreview metaTitle="Titre" metaDescription="Desc" hostname="exemple.fr" />)
    fireEvent.click(screen.getAllByRole('button')[0]) // open the section

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    // The active tab used to be signalled by background colour alone.
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')

    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].getAttribute('id'))
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.getAttribute('id'))

    fireEvent.click(tabs[1])
    const tabsAfter = screen.getAllByRole('tab')
    expect(tabsAfter[1].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      tabsAfter[1].getAttribute('id'),
    )
  })

  it('generates ids per instance, so two mounts on one page do not collide', () => {
    // MetaTitleField, SerpPreview and this component are rendered once per
    // locale tab on a localized document. Literal ids would point every tab's
    // label at the first tab's control.
    render(
      <div>
        <SeoSocialPreview metaTitle="A" metaDescription="A" hostname="a.fr" />
        <SeoSocialPreview metaTitle="B" metaDescription="B" hostname="b.fr" />
      </div>,
    )
    const headers = screen.getAllByRole('button')
    fireEvent.click(headers[0])
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-expanded') === 'false')!)

    const ids = screen.getAllByRole('tab').map((el) => el.getAttribute('id'))
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })
})

describe('LiveRegion', () => {
  it('mounts EMPTY then fills, because a live region only announces a CHANGE', async () => {
    const { container } = render(<LiveRegion message="Audit complete" />)
    const region = container.querySelector('[role="status"]')!
    expect(region).toBeTruthy()
    // The whole point of the component: rendering the text immediately would
    // announce nothing in most screen readers.
    expect(region.textContent).toBe('')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150))
    })
    expect(region.textContent).toBe('Audit complete')
  })

  it('is an assertive alert when asked, a polite status otherwise', () => {
    const { container, unmount } = render(<LiveRegion message="x" />)
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
    unmount()

    const { container: c2 } = render(<LiveRegion assertive message="x" />)
    expect(c2.querySelector('[role="alert"]')?.getAttribute('aria-live')).toBe('assertive')
  })

  it('stays in the accessibility tree — clipped, never display:none', () => {
    const { container } = render(<LiveRegion message="x" />)
    const region = container.querySelector('[role="status"]') as HTMLElement
    expect(region.style.display).not.toBe('none')
    expect(region.style.position).toBe('absolute')
    // jsdom normalises the shorthand to px units.
    expect(region.style.clip.replace(/px/g, '')).toBe('rect(0, 0, 0, 0)')
  })
})

describe('no <button> may fall back to type="submit"', () => {
  it('SerpPreview and SeoSocialPreview render only typed buttons', () => {
    // These two are mounted in the sidebar, INSIDE Payload's document <form>.
    // An untyped button there submits the document on click.
    render(
      <div>
        <SerpPreview metaTitle="Titre" metaDescription="Desc" slug="page" />
        <SeoSocialPreview metaTitle="Titre" metaDescription="Desc" hostname="exemple.fr" />
      </div>,
    )
    for (const header of screen.getAllByRole('button')) fireEvent.click(header)
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe('button')
    }
  })
})
