import { expect, test } from '@playwright/test'

test.describe('Frontend', () => {
  test('can go on homepage', async ({ page }) => {
    await page.goto('http://localhost:3000')

    // With no `home` page in the database, `/` falls back to the static home page.
    await expect(page).toHaveTitle(/Cargo Template/)

    const heading = page.locator('h1').first()

    await expect(heading).toHaveText('Cargo Template')
  })

  test('renders the header and footer', async ({ page }) => {
    await page.goto('http://localhost:3000')

    await expect(page.locator('header')).toBeVisible()
    await expect(page.locator('footer')).toBeVisible()
  })

  test('returns 404 for a page that does not exist', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/this-page-does-not-exist')

    expect(response?.status()).toBe(404)
    await expect(page.locator('h1').first()).toHaveText('404')
    // The 404 renders inside the frontend layout.
    await expect(page.locator('footer')).toBeVisible()
  })

  test('redirects /home to /', async ({ page }) => {
    await page.goto('http://localhost:3000/home')

    await expect(page).toHaveURL('http://localhost:3000/')
  })

  test('should not load Payload admin styles or fonts', async ({ page }) => {
    await page.goto('http://localhost:3000')

    const payloadFontFamily = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-family-sans').trim(),
    )

    expect(payloadFontFamily).toBe('')
    await expect(page.locator('link[href*="fonts.googleapis.com"]')).toHaveCount(0)
  })

  test('should not load Payload component styles', async ({ page }) => {
    await page.goto('http://localhost:3000')

    const sentinel = page.locator('[data-test="payload-ui-barrel-sentinel"]')

    await expect(sentinel).toBeVisible()
    await expect
      .poll(() =>
        sentinel.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--payload-ui-barrel-loaded').trim(),
        ),
      )
      .toBe('')
  })
})
