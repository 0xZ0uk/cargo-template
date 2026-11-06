import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// A/B testing (packages/payload-plugin-ab, routed in loadPage): visitors to a page with a
// published variant are assigned a bucket by cookie and served that bucket's page from the
// original's URL. Drafts and pages without variants are left alone.

const ORIGINAL = 'Original copy: espresso is brewed under pressure.'
const VARIANT = 'Variant copy: ristretto is a shorter espresso.'
const PLAIN = 'A page with no experiment.'

const paragraph = (text: string) => ({
  type: 'paragraph',
  direction: 'ltr',
  format: '',
  indent: 0,
  version: 1,
  textFormat: 0,
  children: [{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }],
})

const layout = (text: string) => [
  {
    blockType: 'richText',
    richText: {
      root: {
        type: 'root',
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
        children: [paragraph(text)],
      },
    },
  },
]

/** The bucket cookie for a page path, as the resolver names it (`/` → `_`, URI-encoded). */
const bucketCookie = (slug: string) => `payload_ab_bucket_${encodeURIComponent(slug)}`

const setCookies = async (response: Response | null) =>
  ((await response?.headerValue('set-cookie')) ?? '').split('\n').filter(Boolean)

test.describe('A/B testing', () => {
  let context: BrowserContext
  let admin: Page
  let api: APIRequestContext
  let originalId: number
  let variantId: number
  let variantSlug: string
  let plainId: number
  const stamp = Date.now()
  const slug = `e2e-ab-${stamp}`
  const plainSlug = `e2e-ab-plain-${stamp}`

  /** A visitor whose browser already holds `cookies` for the site. */
  const visitor = async (browser: Browser, cookies: Record<string, string> = {}) => {
    const ctx = await browser.newContext()
    const url = test.info().project.use.baseURL!
    await ctx.addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url })))
    return { ctx, page: await ctx.newPage() }
  }

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()
    context = await browser.newContext()
    admin = await context.newPage()
    api = context.request
    await login({ page: admin, user: testUser })

    // Seeded through the REST API as the admin, so the dev server does every write itself.
    const original = await api.post('/api/pages', {
      data: { title: 'E2E A/B original', slug, _status: 'published', layout: layout(ORIGINAL) },
    })
    expect(original.ok(), await original.text()).toBe(true)
    originalId = (await original.json()).doc.id

    const plain = await api.post('/api/pages', {
      data: {
        title: 'E2E A/B plain',
        slug: plainSlug,
        _status: 'published',
        layout: layout(PLAIN),
      },
    })
    expect(plain.ok(), await plain.text()).toBe(true)
    plainId = (await plain.json()).doc.id

    // "Add variant" in the Variants panel: a draft copy of the original.
    const duplicate = await api.post('/api/_ab/duplicate', {
      data: { collectionSlug: 'pages', docId: originalId },
    })
    expect(duplicate.status(), await duplicate.text()).toBe(201)
    const created = (await duplicate.json()) as { id: number; slug: string }
    variantId = created.id
    variantSlug = created.slug

    // Edit and publish it, as the Variants drawer does. The percentage stays at 1%, so a fresh
    // visitor almost always lands in the original bucket; the tests pin the bucket by cookie.
    const publish = await api.patch(`/api/pages/${variantId}`, {
      data: { title: 'E2E A/B variant', _status: 'published', layout: layout(VARIANT) },
    })
    expect(publish.ok(), await publish.text()).toBe(true)
  })

  test.afterAll(async () => {
    // The original first, while its variant still points at it: D1 enforces foreign keys, so
    // this checks the migration's ON DELETE set null on `_abvariantof_id`.
    for (const id of [originalId, variantId, plainId]) {
      if (id === undefined) continue
      const response = await api.delete(`/api/pages/${id}`)
      expect([200, 404], await response.text()).toContain(response.status())
    }
    await context.close()
    await cleanupTestUser()
  })

  test('a visitor in the variant bucket gets the variant at the original URL, uncached', async ({
    browser,
  }) => {
    const { ctx, page } = await visitor(browser, { [bucketCookie(slug)]: variantSlug })
    const response = await page.goto(`/${slug}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByText(VARIANT)).toBeVisible()
    await expect(page.getByText(ORIGINAL)).toHaveCount(0)
    expect(page.url()).toMatch(new RegExp(`/${slug}$`))
    expect(response?.headers()['cache-control']).toBe('private, no-store')
    await ctx.close()
  })

  test('a visitor in the original bucket gets the original, still uncached', async ({
    browser,
  }) => {
    const { ctx, page } = await visitor(browser, { [bucketCookie(slug)]: 'original' })
    const response = await page.goto(`/${slug}`)
    await expect(page.getByText(ORIGINAL)).toBeVisible()
    // The resolver has nothing to set here, but the page still depends on the cookie.
    expect(response?.headers()['cache-control']).toBe('private, no-store')
    await ctx.close()
  })

  test('a new visitor gets a bucket cookie and the same page on reload', async ({ browser }) => {
    const { ctx, page } = await visitor(browser)
    const response = await page.goto(`/${slug}`)
    expect((await setCookies(response)).some((c) => c.startsWith(`${bucketCookie(slug)}=`))).toBe(
      true,
    )
    const bucket = (await ctx.cookies()).find((c) => c.name === bucketCookie(slug))?.value
    expect([variantSlug, 'original']).toContain(bucket)
    const expected = bucket === 'original' ? ORIGINAL : VARIANT
    await expect(page.getByText(expected)).toBeVisible()

    for (let i = 0; i < 2; i++) {
      await page.reload()
      await expect(page.getByText(expected)).toBeVisible()
    }
    expect((await ctx.cookies()).find((c) => c.name === bucketCookie(slug))?.value).toBe(bucket)
    await ctx.close()
  })

  test('assignment holds on client-side navigation, where the loader runs as a server function', async ({
    browser,
  }) => {
    const { ctx, page } = await visitor(browser, { [bucketCookie(slug)]: variantSlug })
    await page.goto(`/${plainSlug}`)
    await expect(page.getByText(PLAIN)).toBeVisible()

    // The router is on `window` once the page has hydrated.
    await page.waitForFunction(() => '__TSR_ROUTER__' in window)
    const serverFnCaching: (string | undefined)[] = []
    page.on('response', (r) => {
      if (r.url().includes('_serverFn')) serverFnCaching.push(r.headers()['cache-control'])
    })
    await page.evaluate(
      (to) =>
        (
          window as unknown as {
            __TSR_ROUTER__: { navigate: (o: { to: string }) => Promise<void> }
          }
        ).__TSR_ROUTER__.navigate({ to }),
      `/${slug}`,
    )
    await expect(page.getByText(VARIANT)).toBeVisible()
    expect(page.url()).toMatch(new RegExp(`/${slug}$`))
    // loadPage's server-function response is marked uncacheable too.
    expect(serverFnCaching).toContain('private, no-store')
    await ctx.close()
  })

  test("the admin's draft view shows the original and sets no A/B cookie", async () => {
    const response = await admin.goto(`/${slug}?draft=true`)
    await expect(admin.getByText(ORIGINAL)).toBeVisible()
    expect((await setCookies(response)).some((c) => c.startsWith('payload_ab_bucket_'))).toBe(false)
    expect((await context.cookies()).some((c) => c.name === bucketCookie(slug))).toBe(false)
  })

  test('a page without variants sets no cookie and keeps its normal caching', async ({
    browser,
  }) => {
    const { ctx, page } = await visitor(browser)
    const response = await page.goto(`/${plainSlug}`)
    await expect(page.getByText(PLAIN)).toBeVisible()
    expect((await setCookies(response)).some((c) => c.startsWith('payload_ab_bucket_'))).toBe(false)
    expect(response?.headers()['cache-control'] ?? '').not.toContain('no-store')
    expect((await ctx.cookies()).some((c) => c.name.startsWith('payload_ab_bucket_'))).toBe(false)
    await ctx.close()
  })

  test("a published variant's own URL redirects (302) to the original", async ({ request }) => {
    const response = await request.get(`/${variantSlug}?utm_source=e2e`, { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(new RegExp(`/${slug}\\?utm_source=e2e$`))
  })

  test('sitemap.xml lists the original and no variant', async ({ request }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.ok()).toBe(true)
    const xml = await response.text()
    expect(xml).toMatch(new RegExp(`<loc>[^<]*/${slug}</loc>`))
    expect(xml).not.toContain(variantSlug)
  })

  test("a visitor served the variant gets the original's canonical URL", async ({ browser }) => {
    const { ctx, page } = await visitor(browser, { [bucketCookie(slug)]: variantSlug })
    await page.goto(`/${slug}`)
    await expect(page.getByText(VARIANT)).toBeVisible()
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toMatch(new RegExp(`/${slug}$`))
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content')
    expect(ogUrl).toBe(canonical)
    const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents()
    expect(jsonLd.join('')).not.toContain(variantSlug)
    await ctx.close()
  })

  test('the admin can still open the variant at its own URL in draft mode', async () => {
    const response = await admin.goto(`/${variantSlug}?draft=true`)
    expect(response?.status()).toBe(200)
    expect(admin.url()).toMatch(new RegExp(`/${variantSlug}\\?draft=true$`))
    await expect(admin.getByText(VARIANT)).toBeVisible()
    // Canonicalised to the original.
    const canonical = await admin.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toMatch(new RegExp(`/${slug}$`))
  })

  test('"Edit on page" shows on the original and is hidden on the variant', async () => {
    await admin.goto(`/admin/collections/pages/${originalId}`)
    await expect(admin.getByTestId('onpage-edit-on-page')).toBeVisible()

    await admin.goto(`/admin/collections/pages/${variantId}`)
    await expect(admin.getByTestId('onpage-copy-preview-link')).toBeVisible()
    await expect(admin.getByTestId('onpage-edit-on-page')).toHaveCount(0)
  })
})
