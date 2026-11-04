import { expect, test, type Page } from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// The SEO analyzer's admin views that `apps/web` turns on (see `features` in
// src/payload.config.ts). Each one must render its header inside the admin shell, with no
// error boundary and no uncaught page error.
const seoViews = [
  { path: '/admin/seo', title: 'SEO Audit' },
  { path: '/admin/sitemap-audit', title: 'Sitemap & Link Audit' },
  { path: '/admin/redirects', title: 'Redirect Manager' },
  { path: '/admin/seo-config', title: 'SEO Configuration' },
  { path: '/admin/performance', title: 'Search Console Performance' },
]

test.describe('SEO analyzer', () => {
  let page: Page
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await login({ page, user: testUser })
  })

  test.afterAll(async () => {
    await cleanupTestUser()
  })

  test.beforeEach(() => {
    pageErrors.length = 0
  })

  for (const view of seoViews) {
    test(`renders ${view.path}`, async () => {
      await page.goto(view.path)

      await expect(page).toHaveURL(view.path)
      await expect(page.locator('h1.list-header__title')).toHaveText(view.title)
      // Rendered inside Payload's admin shell, not a bare page.
      await expect(page.locator('.step-nav__first').first()).toBeVisible()
      // The plugin's error boundaries render `role="alert"`.
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(pageErrors).toEqual([])
    })
  }

  test('serves /sitemap.xml at the root', async ({ request }) => {
    const response = await request.get('/sitemap.xml')

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('xml')
    expect(await response.text()).toContain('<urlset')
  })

  test('serves /robots.txt at the root', async ({ request }) => {
    const response = await request.get('/robots.txt')

    expect(response.status()).toBe(200)
    expect(await response.text()).toMatch(/^Sitemap: https?:\/\/.+\/sitemap\.xml$/m)
  })
})
