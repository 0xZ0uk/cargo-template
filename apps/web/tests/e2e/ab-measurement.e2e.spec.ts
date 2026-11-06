import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// A/B measurement (src/plugins/abMeasurement.ts): a routed page view counts an impression once
// (marker cookie), a click on a call-to-action link posts a conversion to /api/_ab/convert,
// and the Variants panel shows results, or says measurement isn't configured without the
// Analytics Engine credentials (as in local dev and CI).

const cta = (label: string) => ({
  blockType: 'cta',
  variant: 'centered',
  title: 'Ready to start?',
  links: [{ link: { type: 'custom', url: '#signup', label, appearance: 'default' } }],
})

test.describe('A/B measurement', () => {
  let context: BrowserContext
  let admin: Page
  let api: APIRequestContext
  let originalId: number
  let variantId: number
  const slug = `e2e-ab-measure-${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()
    context = await browser.newContext()
    admin = await context.newPage()
    api = context.request
    await login({ page: admin, user: testUser })

    const original = await api.post('/api/pages', {
      data: { title: 'E2E A/B measured', slug, _status: 'published', layout: [cta('Sign up')] },
    })
    expect(original.ok(), await original.text()).toBe(true)
    originalId = (await original.json()).doc.id

    const duplicate = await api.post('/api/_ab/duplicate', {
      data: { collectionSlug: 'pages', docId: originalId },
    })
    expect(duplicate.status(), await duplicate.text()).toBe(201)
    variantId = ((await duplicate.json()) as { id: number }).id

    const publish = await api.patch(`/api/pages/${variantId}`, {
      data: { title: 'E2E A/B measured variant', _status: 'published', layout: [cta('Join now')] },
    })
    expect(publish.ok(), await publish.text()).toBe(true)
  })

  test.afterAll(async () => {
    for (const id of [originalId, variantId]) {
      if (id === undefined) continue
      const response = await api.delete(`/api/pages/${id}`)
      expect([200, 404], await response.text()).toContain(response.status())
    }
    await context.close()
    await cleanupTestUser()
  })

  test('a CTA click sends a conversion for the experiment, with no bucket in the body', async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    const url = test.info().project.use.baseURL!
    await ctx.addCookies([
      { name: `payload_ab_bucket_${slug}`, value: 'original', url },
      { name: 'ab_visitor_id', value: 'e2e-visitor', url },
    ])
    const page = await ctx.newPage()
    await page.goto(`/${slug}`)
    await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible()

    // The impression was counted once: its marker cookie holds the bucket.
    const marker = (await ctx.cookies()).find((c) => c.name === `payload_ab_seen_${slug}`)
    expect(marker).toMatchObject({ value: 'original', httpOnly: true })

    // The tracker listens once React has hydrated; the dev server loads modules lazily.
    await page.waitForLoadState('networkidle')
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/api/_ab/convert') && r.method() === 'POST'),
      page.getByRole('link', { name: 'Sign up' }).click(),
    ])
    expect(JSON.parse(request.postData() ?? '{}')).toEqual({ experiment: `/${slug}`, goal: 'cta' })

    // The endpoint reads the bucket from the cookies and marks the visitor as converted.
    await expect
      .poll(
        async () => (await ctx.cookies()).find((c) => c.name === `payload_ab_cv_${slug}`)?.value,
      )
      .toBe('original')
    await ctx.close()
  })

  test('the Variants panel says measurement is not configured without credentials', async () => {
    await admin.goto(`/admin/collections/pages/${originalId}`)
    await expect(admin.getByTestId('ab-results-not-configured')).toBeVisible()
    await expect(admin.getByTestId('ab-results-not-configured')).toContainText(
      'AB_ANALYTICS_ACCOUNT_ID',
    )
  })
})
