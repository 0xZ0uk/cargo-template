// @vitest-environment jsdom
/**
 * Render contract of the socials admin UI on Payload's components: each view's key
 * states (loading, empty, error, populated), the accessible structure (labelled tab
 * groups wired to their panel, real buttons, labelled inputs) and the composer's channel
 * chips (checkbox inline with its label).
 */
import fs from 'node:fs'
import path from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', async () => (await import('./helpers/payloadUiStub.js')).payloadUiStub)
vi.mock('../SocialsAdminViewClientRef.js', async () => import('../SocialsAdminViewClient.js'))

import { SocialsAdminView } from '../SocialsAdminView.js'
import { SocialsAdminViewClient } from '../SocialsAdminViewClient.js'
import { SocialsDashboardWidget } from '../SocialsDashboardWidget.js'
import { SocialsNavLink } from '../SocialsNavLink.js'
import { SocialTemplateFieldBuilder } from '../SocialTemplateFieldBuilder.js'
import { SocialPublishPanelClient } from '../SourceSocialsPanelClient.js'
import { StandaloneSocialComposer } from '../StandaloneSocialComposer.js'
import { mockFetch, resetStubState, stubState, toastStub } from './helpers/payloadUiStub.js'

const PUBLISHER = { body: { admin: true, publisher: true } }

beforeEach(() => {
  resetStubState()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/* ---------------------------------------------------------------------------- */

describe('SocialsAdminView (server shell)', () => {
  it('renders a Payload list-header and the client island in the view body', async () => {
    mockFetch({ '/access': { body: { admin: false, publisher: false } } })
    const props = {
      initPageResult: {
        locale: undefined,
        permissions: {},
        req: {
          i18n: {},
          payload: { config: { custom: { socials: { authorize: () => true } }, routes: {} } },
          user: { id: 1 },
        },
        visibleEntities: {},
      },
      params: {},
      searchParams: {},
      server: { redirect: vi.fn() },
    }
    const element = await (SocialsAdminView as unknown as (p: unknown) => Promise<React.ReactElement>)(
      props,
    )
    // DefaultTemplate is mocked to a pass-through (it needs the whole admin).
    const { container } = render(element)
    expect(container.querySelector('.list-header h1')?.textContent).toBe('Socials')
    expect(container.querySelector('.socials-view')).not.toBeNull()
    expect(screen.getByRole('tablist')).toBeTruthy()
  })
})

vi.mock('@payloadcms/ui/rsc', () => ({
  DefaultTemplate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

/* ---------------------------------------------------------------------------- */

describe('SocialsAdminViewClient', () => {
  it('labels the tab group and wires the selected tab to the panel', async () => {
    mockFetch({ '/access': { body: { admin: false, publisher: false } } })
    render(<SocialsAdminViewClient />)

    const group = screen.getByRole('group', { name: 'Socials view' })
    const tabs = within(group).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Compose', 'Connections'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id)
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id)

    fireEvent.click(tabs[1])
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[1].id)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('opens Connections and toasts after an OAuth callback', async () => {
    mockFetch({ '/access': { body: { admin: false, publisher: false } } })
    window.history.replaceState(null, '', '/admin/socials?connected=pinterest')
    render(<SocialsAdminViewClient />)
    await waitFor(() =>
      expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true'),
    )
    expect(toastStub.success).toHaveBeenCalledWith('Pinterest connected')
    expect(window.location.search).toBe('')
  })
})

/* ---------------------------------------------------------------------------- */

describe('SocialsDashboardWidget', () => {
  it('renders nothing for a user who is not an admin', async () => {
    const fetchMock = mockFetch({ '/access': { body: { admin: false, publisher: true } } })
    const { container } = render(<SocialsDashboardWidget />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(container.innerHTML).toBe('')
  })

  it('shows a loading state, then one row per enabled platform', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchMock = mockFetch({
      '/access': PUBLISHER,
      '/connections': {
        body: {
          connections: {
            facebook: { connected: false, managedByConfig: true },
            pinterest: { accountLabel: 'Shop account', connected: true },
          },
        },
      },
    })
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/connections')) await gate
      return base(input, init)
    })

    render(<SocialsDashboardWidget />)
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText('Loading connection status…')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Social connections' })).toBeTruthy()

    await act(async () => release())
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)

    // Pinterest: connected, offers Disconnect.
    expect(within(rows[0]).getByText('Shop account')).toBeTruthy()
    expect(rows[0].querySelector('.socials-dot--success')).not.toBeNull()
    // Facebook: managed by config, a Pill instead of a button.
    expect(within(rows[1]).getByText('Managed by server configuration').className).toContain('pill')
    expect(within(rows[1]).queryByRole('button')).toBeNull()
    expect(rows[1].querySelector('.socials-dot--neutral')).not.toBeNull()
  })

  it('asks for confirmation before disconnecting, with a destructive button', async () => {
    const fetchMock = mockFetch({
      '/access': PUBLISHER,
      '/connections': { body: { connections: { pinterest: { connected: true } } } },
      '/pinterest/disconnect': { body: { ok: true } },
    })
    stubState.config.admin.custom.socials.enabledPlatforms = ['pinterest']
    render(<SocialsDashboardWidget />)

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    const confirm = screen.getByRole('button', { name: 'Confirm disconnect' })
    expect(confirm.className).toContain('btn--style-destructive')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm disconnect' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }))
    await waitFor(() => expect(toastStub.success).toHaveBeenCalledWith('Pinterest disconnected.'))
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/pinterest/disconnect'))).toBe(
      true,
    )
  })

  it('says so when no platform is enabled', async () => {
    mockFetch({ '/access': PUBLISHER, '/connections': { body: { connections: {} } } })
    stubState.config.admin.custom.socials.enabledPlatforms = []
    render(<SocialsDashboardWidget />)
    expect(await screen.findByText('No platforms are enabled.')).toBeTruthy()
  })

  it('fails silently when the connections request errors (rows show not connected)', async () => {
    mockFetch({ '/access': PUBLISHER, '/connections': { body: { error: 'nope' }, status: 403 } })
    render(<SocialsDashboardWidget />)
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Not connected')).toBeTruthy()
    expect(toastStub.error).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------------------- */

describe('StandaloneSocialComposer', () => {
  const setup = async () => {
    const fetchMock = mockFetch({
      '/access': PUBLISHER,
      '/compose/publish': {
        body: {
          anyPublished: true,
          results: [
            {
              ok: true,
              platform: 'pinterest',
              publishedRef: { externalId: '1', externalUrl: 'https://pin.test/1', platform: 'pinterest' },
            },
            { error: 'Page token expired', ok: false, platform: 'facebook' },
          ],
        },
      },
      '/pinterest/boards': { body: { boards: [{ id: 'b1', name: 'Board one' }] } },
      '/facebook/pages': { body: { pages: [{ id: 'p1', name: 'Page one' }] } },
    })
    render(<StandaloneSocialComposer />)
    await screen.findByRole('heading', { name: 'Standalone composer' })
    return fetchMock
  }

  it('renders labelled fields and the channel chips with the checkbox inline', async () => {
    await setup()
    expect(screen.getByRole('textbox', { name: 'Post title' }).className).toContain('socials-input')
    expect(screen.getByRole('textbox', { name: 'Post body' }).className).toContain('socials-textarea')

    const channels = screen.getByRole('group', { name: 'Channels' })
    const boxes = within(channels).getAllByRole('checkbox')
    expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual(['Pinterest', 'Facebook'])
    for (const box of boxes) {
      // The chip is the label itself: checkbox first, then its text, side by side.
      const chip = box.parentElement!
      expect(chip.tagName).toBe('LABEL')
      expect(chip.className).toContain('socials-check')
      expect(chip.className).toContain('socials-chip')
      expect(chip.children).toHaveLength(2)
      expect(chip.children[1].textContent).toBe(box.getAttribute('aria-label'))
    }
  })

  it('selects a channel, shows its destination and format, and enables publishing', async () => {
    await setup()
    const publish = screen.getByRole('button', { name: 'Publish to selected channels' })
    expect((publish as HTMLButtonElement).disabled).toBe(true)
    expect(publish.className).toContain('btn--style-primary')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Pinterest' }))
    expect(screen.getByRole('checkbox', { name: 'Pinterest' }).parentElement!.className).toContain(
      'socials-chip--active',
    )
    expect(screen.getByRole('combobox', { name: 'Pinterest destination' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Pinterest format' })).toBeTruthy()
    expect(await screen.findByRole('option', { name: 'Board one' })).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Post title' }), {
      target: { value: 'Launch' },
    })
    expect((publish as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows one banner per channel result after publishing', async () => {
    await setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pinterest' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Facebook' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Post title' }), {
      target: { value: 'Launch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish to selected channels' }))

    const results = await screen.findByRole('list', { name: 'Publish results' })
    const banners = results.querySelectorAll('.banner')
    expect(banners).toHaveLength(2)
    expect(banners[0].className).toContain('banner--type-success')
    expect(within(banners[0] as HTMLElement).getByRole('link', { name: 'View' })).toBeTruthy()
    expect(banners[1].className).toContain('banner--type-danger')
    expect(banners[1].textContent).toContain('Page token expired')
    expect(toastStub.success).toHaveBeenCalledWith('Published to at least one channel.')
  })
})

/* ---------------------------------------------------------------------------- */

describe('SocialPublishPanelClient (the Socials tab)', () => {
  const envelope = {
    capabilities: { limits: { captionMaxChars: 10 } },
    draft: {
      content: { body: 'Body', link: 'https://example.test/item', title: 'Title' },
      media: [{ altText: 'Front', type: 'image', url: 'https://cdn.test/front.jpg' }],
      source: { id: '7', kind: 'product' },
      version: 1,
    },
    preview: { body: 'A body that is too long', title: 'Preview title' },
  }

  it('reports a missing sourceKind as a danger banner', () => {
    render(<SocialPublishPanelClient />)
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('.banner--type-danger')).not.toBeNull()
    expect(alert.textContent).toContain('Socials source is not configured.')
  })

  it('asks to save an unsaved document first', async () => {
    mockFetch({ '/access': PUBLISHER })
    render(<SocialPublishPanelClient sourceKind="product" />)
    expect(await screen.findByText('Save this document before publishing to socials.')).toBeTruthy()
  })

  it('shows a busy loading state while the preview loads', async () => {
    stubState.documentId = 7
    mockFetch({ '/access': PUBLISHER, '/preview': { body: { error: 'down' }, status: 500 } })
    render(<SocialPublishPanelClient sourceKind="product" />)
    expect(await screen.findByText('Loading social composer…')).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    // A failed preview surfaces as a toast, as before.
    await waitFor(() => expect(toastStub.error).toHaveBeenCalledWith('down'))
  })

  it('renders the composer: platform tabs, fields, validation, preview and history', async () => {
    stubState.documentId = 7
    mockFetch({
      '/access': PUBLISHER,
      '/history': {
        body: {
          posts: [
            { externalUrl: 'https://pin.test/1', id: 1, publishedAt: '2026-01-01T00:00:00Z', status: 'published' },
            { id: 2, scheduledAt: '2026-02-01T00:00:00Z', status: 'queued' },
          ],
        },
      },
      '/pinterest/boards': { body: { boards: [{ id: 'b1', name: 'Board one' }] } },
      '/preview': { body: envelope },
      '/templates/': { body: { templates: [] } },
      '/validate': {
        body: {
          validation: {
            issues: [{ field: 'copy', message: 'Description is too long', severity: 'error' }],
            ok: false,
          },
        },
      },
    })
    render(<SocialPublishPanelClient sourceKind="product" />)

    expect(await screen.findByRole('heading', { name: 'Social composer' })).toBeTruthy()
    const group = screen.getByRole('group', { name: 'Social platform' })
    const tabs = within(group).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Pinterest', 'Facebook'])
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0].id)

    // Fields keep their accessible names.
    expect(screen.getByRole('textbox', { name: 'Pin title' })).toBeTruthy()
    const copy = screen.getByRole('textbox', { name: 'Post copy' })
    expect(copy.className).toContain('socials-textarea')
    // Over the 10-char caption limit: the count turns danger.
    expect(screen.getByText(/characters$/).className).toContain('socials-field__description--danger')

    // Validation issues land in a danger banner and block publishing.
    const issue = await screen.findByText('Description is too long', {}, { timeout: 2000 })
    expect(issue.closest('.banner')?.className).toContain('banner--type-danger')
    expect((screen.getByRole('button', { name: 'Publish now' }) as HTMLButtonElement).disabled).toBe(true)

    // Preview pane.
    expect(screen.getByRole('complementary', { name: 'Pinterest preview' })).toBeTruthy()

    // History sits in a collapsed Collapsible.
    const toggle = screen.getByRole('button', { name: 'Recent Pinterest history (2)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByText('published').className).toContain('pill--style-success')
    expect(screen.getByText('queued').className).toContain('pill--style-warning')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Confirm delete' }).className).toContain(
      'btn--style-destructive',
    )
  })

  it('shows "Ready to publish" as a success banner when validation passes', async () => {
    stubState.documentId = 7
    mockFetch({
      '/access': PUBLISHER,
      '/history': { body: { posts: [] } },
      '/pinterest/boards': { body: { boards: [] } },
      '/preview': { body: { ...envelope, capabilities: { limits: {} } } },
      '/templates/': { body: { templates: [] } },
      '/validate': { body: { validation: { issues: [], ok: true } } },
    })
    render(<SocialPublishPanelClient sourceKind="product" />)
    const ready = await screen.findByText('Ready to publish')
    expect(ready.className).toContain('banner--type-success')
    expect(screen.queryByRole('button', { name: /history/ })).toBeNull()
  })
})

/* ---------------------------------------------------------------------------- */

describe('SocialTemplateFieldBuilder', () => {
  it('renders the builder with token buttons, a raw-mode toggle and a char count', () => {
    stubState.fields = { pinterestTitle: 'Hello', sourceKind: '' }
    render(<SocialTemplateFieldBuilder copyField="pinterestTitle" path="pinterestTitle" />)

    expect(screen.getByRole('heading', { name: 'Pinterest title' })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Raw mode' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.className).toContain('btn--style-ghost')

    const insert = screen.getByRole('button', { name: 'Insert title token' })
    expect(insert.className).toContain('btn--style-pill')
    expect(screen.getByText(/Choose the collection this template is for/)).toBeTruthy()
    expect(screen.getByText('5 / 100 chars').className).toContain('pill--style-light')

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Builder mode' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('textbox', { name: 'pinterestTitle template (raw)' })).toBeTruthy()
  })

  it('inserts a token and offers the filter menu for it', () => {
    stubState.fields = { pinterestDescription: '', sourceKind: '' }
    render(
      <SocialTemplateFieldBuilder copyField="pinterestDescription" multiline path="pinterestDescription" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Insert title token' }))
    expect(
      (screen.getByRole('textbox', { name: 'pinterestDescription template' }) as HTMLTextAreaElement)
        .value,
    ).toBe('{{ title }}')
    expect(screen.getByRole('group', { name: 'Apply filter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Apply .* filter$/ }).textContent).toBe('Apply to title')
  })

  it('marks an over-limit count as an error pill', () => {
    stubState.fields = { pinterestTitle: 'x'.repeat(101), sourceKind: '' }
    render(<SocialTemplateFieldBuilder copyField="pinterestTitle" path="pinterestTitle" />)
    expect(screen.getByText('101 / 100 chars').className).toContain('pill--style-error')
  })

  it('shows the live preview in a Collapsible, and preview errors as a danger banner', async () => {
    stubState.config.admin.custom.socials.sourceKinds = [
      { collection: 'products', kind: 'product', label: 'Products' },
    ]
    stubState.fields = { pinterestTitle: '{{ title }}', sourceKind: 'product' }
    mockFetch({
      '/api/products': { body: { docs: [{ id: 42 }] } },
      '/templates/preview': { body: { error: 'Record not found' }, status: 404 },
    })
    render(<SocialTemplateFieldBuilder copyField="pinterestTitle" path="pinterestTitle" />)

    const toggle = screen.getByRole('button', { name: 'Live preview' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Preview record ID' }) as HTMLInputElement).value).toBe(
        '42',
      ),
    )
    const alert = await screen.findByRole('alert', {}, { timeout: 2000 })
    expect(alert.querySelector('.banner--type-danger')?.textContent).toBe('Record not found')
  })
})

/* ---------------------------------------------------------------------------- */

describe('when the plugin is disabled', () => {
  const NOTICE = 'Socials is turned off. Set its encryption key to enable it.'
  const disable = () => {
    ;(stubState.config.admin.custom.socials as Record<string, unknown>).disabled = true
  }

  it('shows the notice on the dashboard widget without calling any endpoint', () => {
    disable()
    const fetchMock = mockFetch({})
    render(<SocialsDashboardWidget />)
    expect(screen.getByText(NOTICE)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the notice on the Socials tab and the standalone composer, without calling endpoints', () => {
    disable()
    const fetchMock = mockFetch({})
    const { unmount } = render(<SocialPublishPanelClient sourceKind="product" />)
    expect(screen.getByText(NOTICE)).toBeTruthy()
    unmount()
    render(<SocialPublishPanelClient mode="standalone" />)
    expect(screen.getByText(NOTICE)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders no nav link and probes nothing', () => {
    disable()
    const fetchMock = mockFetch({})
    const { container } = render(<SocialsNavLink />)
    expect(container.innerHTML).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the notice instead of the client island in the /admin/socials view', async () => {
    const props = {
      initPageResult: {
        locale: undefined,
        permissions: {},
        req: {
          i18n: {},
          payload: {
            config: { custom: { socials: { authorize: () => true, disabled: true } }, routes: {} },
          },
          user: { id: 1 },
        },
        visibleEntities: {},
      },
      params: {},
      searchParams: {},
      server: { redirect: vi.fn() },
    }
    const element = await (SocialsAdminView as unknown as (p: unknown) => Promise<React.ReactElement>)(
      props,
    )
    render(element)
    expect(screen.getByText(NOTICE)).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})

/* ---------------------------------------------------------------------------- */

describe('socials styles', () => {
  const css = ['socials.css', 'ui/styles.css']
    .map((file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'))
    .join('\n')

  it('lays the channel chip checkbox out inline, with no generic label grid to override it', () => {
    expect(css).toMatch(/\.socials-check\s*\{[^}]*display:\s*inline-flex/)
    // The old `.socials-composer label { display: grid }` beat the chip's own rule.
    expect(css).not.toMatch(/(^|\s)label\s*\{/m)
  })

  it('uses no hard-coded colours', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
  })
})
