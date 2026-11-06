import { expect, test, type Page } from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// The Socials plugin: the composer at /admin/socials and the Socials tab on Pages. It needs
// SOCIALS_ENCRYPTION_KEY (the plugin is disabled, with no admin UI, without one); CI sets a
// throwaway key. No platform is connected, so nothing here talks to a provider.

test.describe('Socials plugin', () => {
  let page: Page
  let pageId: number | string | undefined
  let writesInFlight = 0

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()
    // Autosave can leave an edit "unsaved" when the next test navigates away.
    page.on('dialog', (dialog) => void dialog.accept())
    const track = (delta: number) => (request: { method(): string }) => {
      if (request.method() !== 'GET') writesInFlight += delta
    }
    page.on('request', track(1))
    page.on('requestfinished', track(-1))
    page.on('requestfailed', track(-1))

    await login({ page, user: testUser })
  })

  test.afterEach(async () => {
    await expect.poll(() => writesInFlight).toBe(0)
    await page.goto('about:blank')
  })

  test.afterAll(async () => {
    if (pageId !== undefined) {
      // 404: already deleted. Anything else would leave the page behind.
      const response = await page.request.delete(`/api/pages/${pageId}`)
      expect([200, 404]).toContain(response.status())
    }
    await cleanupTestUser()
  })

  test('loads the composer at /admin/socials', async () => {
    await page.goto('/admin/socials')

    await expect(page).toHaveURL('/admin/socials')
    await expect(page.getByRole('heading', { level: 1, name: 'Socials' })).toBeVisible()
    await expect(page.getByText('Multi-platform organic publishing.')).toBeVisible()
  })

  test('adds a Socials tab to a page', async () => {
    // A draft page, created through the REST API as the logged-in admin (the dev server then
    // does every write itself; see seo-sidebar.e2e.spec.ts).
    const response = await page.request.post('/api/pages?draft=true', {
      data: { _status: 'draft', layout: [], title: `E2E socials ${Date.now()}` },
    })
    expect(response.ok(), await response.text()).toBe(true)
    pageId = (await response.json()).doc.id

    await page.goto(`/admin/collections/pages/${pageId}`)
    // The form is disabled until its state has loaded.
    await expect(page.locator('#field-title')).toBeEnabled()

    await page.getByRole('tab', { name: 'Socials' }).click()
    await expect(page.getByRole('tab', { name: 'Socials' })).toHaveAttribute('aria-selected', 'true')
    // CI enables no platform (no Pinterest credentials), so the tab says so instead of loading a composer.
    await expect(page.getByRole('tabpanel', { name: 'Socials' }).getByText('No platform is enabled.')).toBeVisible()
  })
})
