import { expect, test, type Page } from '@playwright/test'
import { login } from '../helpers/login'
import { deleteNotFoundLogs } from '../helpers/seoStore'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// A redirect made in the plugin's Redirect Manager, followed on the frontend, then removed again.

// The frontend compares a shared generation marker (`gen/frontend-redirects`, bumped by the
// redirect hooks) on every lookup, so a change applies on the next request. Poll briefly rather
// than assert once, in case the dev server's R2 proxy lags the write.
const POLL_TIMEOUT_MS = 5_000

test.describe('SEO analyzer: redirects', () => {
  let page: Page
  const stamp = Date.now()
  const from = `/e2e-old-${stamp}`
  const to = `/e2e-new-${stamp}`

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()

    await login({ page, user: testUser })
  })

  test.afterAll(async () => {
    // Normally the test already deleted it; this catches a run that failed halfway. Through
    // REST as the logged-in admin, so the dev server does the write (see seo-sidebar spec).
    await page.request.delete(`/api/seo-redirects?where[from][contains]=e2e-old-${stamp}`).catch(() => {})
    // Requesting the old path after it stopped redirecting is a 404 the plugin logged.
    await deleteNotFoundLogs([from])
    await cleanupTestUser()
  })

  test('creates a redirect in the manager, serves its 301, and stops after deleting it', async ({ request }) => {
    test.setTimeout(60_000)

    // The path the frontend sees: the old path with a query that must survive the redirect.
    const requestOldPath = async () => request.get(`${from}?utm_source=e2e`, { maxRedirects: 0 })

    await page.goto('/admin/redirects')
    await expect(page.locator('h1.list-header__title')).toHaveText('Redirect Manager')

    await test.step('create it in the manager', async () => {
      await page.getByLabel('Source URL', { exact: true }).fill(from)
      await page.getByLabel('Destination URL', { exact: true }).fill(to)
      const created = page.waitForResponse(
        (response) => response.url().includes('/create-redirect') && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      expect((await created).ok()).toBe(true)

      await expect(page.getByText('Redirect created')).toBeVisible()
      await expect(page.getByLabel(`Source (from): ${from}`)).toBeVisible()
    })

    await test.step('the frontend answers the old path with a 301 to the target, query kept', async () => {
      await expect
        .poll(async () => (await requestOldPath()).status(), { timeout: POLL_TIMEOUT_MS })
        .toBe(301)

      const response = await requestOldPath()
      const location = new URL(response.headers().location, 'http://localhost')
      expect(`${location.pathname}${location.search}`).toBe(`${to}?utm_source=e2e`)
    })

    await test.step('delete it in the manager', async () => {
      await page.getByPlaceholder('Search (source or destination URL)...').fill(from)
      const deleted = page.waitForResponse(
        (response) => response.url().includes('/redirects') && response.request().method() === 'DELETE',
      )
      await page.getByRole('button', { name: `Delete — ${from}` }).click()
      expect((await deleted).ok()).toBe(true)

      await expect(page.getByText('Redirect deleted')).toBeVisible()
      await expect(page.getByLabel(`Source (from): ${from}`)).toHaveCount(0)
    })

    await test.step('the old path no longer redirects', async () => {
      await expect
        .poll(async () => (await requestOldPath()).status(), { timeout: POLL_TIMEOUT_MS })
        .toBe(404)
    })
  })
})
