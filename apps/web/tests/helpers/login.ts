import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export interface LoginOptions {
  page: Page
  /** Origin of the app. Defaults to Playwright's `baseURL` (see playwright.config.ts). */
  serverURL?: string
  user: {
    email: string
    password: string
  }
}

/**
 * Logs the user into the admin panel via the login page.
 */
export async function login({
  page,
  serverURL = '',
  user,
}: LoginOptions): Promise<void> {
  await page.goto(`${serverURL}/admin/login`)

  await page.fill('#field-email', user.email)
  await page.fill('#field-password', user.password)
  await page.click('button[type="submit"]')

  await page.waitForURL(`${serverURL}/admin`)

  const dashboardArtifact = page.locator('.step-nav__first')
  await expect(dashboardArtifact).toBeVisible()
}
