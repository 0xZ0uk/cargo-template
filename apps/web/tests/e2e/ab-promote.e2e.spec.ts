import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// Promoting an A/B variant (POST /api/_ab/promote, "Promote" in the Variants panel): the
// variant's content is copied onto the original as a draft and the experiment ends. The live
// page keeps the old content until an editor publishes the original.

const ORIGINAL = 'Original copy: the losing headline.'
const WINNER = 'Winner copy: the headline that converted.'

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
        children: [
          {
            type: 'paragraph',
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
            textFormat: 0,
            children: [
              { type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 },
            ],
          },
        ],
      },
    },
  },
]

test.describe('A/B promote', () => {
  let context: BrowserContext
  let admin: Page
  let api: APIRequestContext
  let originalId: number
  let variantId: number
  const slug = `e2e-ab-promote-${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()
    context = await browser.newContext()
    admin = await context.newPage()
    api = context.request
    await login({ page: admin, user: testUser })

    const original = await api.post('/api/pages', {
      data: { title: 'E2E promote original', slug, _status: 'published', layout: layout(ORIGINAL) },
    })
    expect(original.ok(), await original.text()).toBe(true)
    originalId = (await original.json()).doc.id

    const duplicate = await api.post('/api/_ab/duplicate', {
      data: { collectionSlug: 'pages', docId: originalId },
    })
    expect(duplicate.status(), await duplicate.text()).toBe(201)
    variantId = ((await duplicate.json()) as { id: number }).id

    const publish = await api.patch(`/api/pages/${variantId}`, {
      data: { title: 'E2E promote winner', _status: 'published', layout: layout(WINNER) },
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

  test('promoting a variant from the panel drafts its content onto the original', async ({
    browser,
  }) => {
    await admin.goto(`/admin/collections/pages/${originalId}`)
    const promote = admin.getByRole('button', { name: 'Promote E2E promote winner' })
    await expect(promote).toBeVisible()
    await promote.click()

    const confirm = admin.getByTestId('ab-promote-confirm')
    await expect(confirm).toContainText('copied onto this page as a draft')
    await expect(confirm).toContainText("can't be undone")
    await expect(confirm).toContainText('version history')
    await admin.getByRole('button', { name: 'Promote', exact: true }).click()

    // The panel reloads the document: the variant is gone, and the form shows the draft.
    await expect(admin.getByRole('button', { name: 'Promote E2E promote winner' })).toHaveCount(0)
    await expect(admin.locator('#field-title')).toHaveValue('E2E promote winner')
    await expect(admin.getByRole('button', { name: 'Add variant' })).toBeVisible()

    // The original's draft holds the variant's content, its slug is unchanged, and the
    // variant is deleted.
    const draft = await (await api.get(`/api/pages/${originalId}?draft=true&depth=0`)).json()
    expect(draft).toMatchObject({ title: 'E2E promote winner', slug, _status: 'draft' })
    expect(JSON.stringify(draft.layout)).toContain(WINNER)
    expect((await api.get(`/api/pages/${variantId}?draft=true`)).status()).toBe(404)

    // The ended run is still listed with its results.
    const results = await (
      await api.get(`/api/_ab/results?collection=pages&id=${originalId}`)
    ).json()
    expect(results.experiment).toBeNull()
    expect(results.pastRuns).toHaveLength(1)

    // Visitors still get the published original until the draft is published.
    const visitor = await browser.newContext()
    const page = await visitor.newPage()
    await page.goto(`/${slug}`)
    await expect(page.getByText(ORIGINAL)).toBeVisible()
    await expect(page.getByText(WINNER)).toHaveCount(0)
    await visitor.close()
  })
})
