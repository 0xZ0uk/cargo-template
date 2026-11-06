import { expect, test, type Page } from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// The Socials plugin: /admin/socials and the Socials tab on Pages. The admin is registered with
// or without SOCIALS_ENCRYPTION_KEY (the import map doesn't depend on it); without one the plugin
// is off and each surface says so, with one it is live (CI's e2e job sets a throwaway key). Both
// modes are asserted below. No platform is connected, so nothing here talks to a provider.
const socialsOn = Boolean(process.env.SOCIALS_ENCRYPTION_KEY)
const OFF = 'Socials is turned off.'

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

  test('loads /admin/socials', async () => {
    await page.goto('/admin/socials')

    await expect(page).toHaveURL('/admin/socials')
    await expect(page.getByRole('heading', { level: 1, name: 'Socials' })).toBeVisible()
    await expect(page.getByText('Multi-platform organic publishing.')).toBeVisible()
    if (socialsOn) {
      await expect(page.getByRole('tab', { name: 'Compose' })).toBeVisible()
      await expect(page.getByText(OFF)).toHaveCount(0)
    } else {
      await expect(page.getByText(OFF)).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Compose' })).toHaveCount(0)
    }
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
    const panel = page.getByRole('tabpanel', { name: 'Socials' })
    if (socialsOn) {
      // CI enables no platform (no Pinterest credentials), so the tab says so instead of loading a composer.
      await expect(panel.getByText('No platform is enabled.')).toBeVisible()
    } else {
      await expect(panel.getByText(OFF)).toBeVisible()
    }
  })
})
