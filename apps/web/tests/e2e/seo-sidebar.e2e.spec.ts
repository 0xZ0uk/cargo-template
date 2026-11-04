import { expect, test, type Page, type Request } from '@playwright/test'
import { login } from '../helpers/login'
import { deleteScoreHistory } from '../helpers/seoStore'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// The SEO analyzer's score card in the sidebar of a page's edit view. It analyses the form state
// in the browser, so it moves as the editor types, before anything is saved.

const lexicalParagraphs = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
    children: paragraphs.map((text) => ({
      type: 'paragraph',
      direction: 'ltr',
      format: '',
      indent: 0,
      version: 1,
      textFormat: 0,
      children: [{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }],
    })),
  },
})

// 11 + 13 words: the sidebar's word counter shows 24 for this page.
const SEEDED_WORDS = 24

test.describe('SEO analyzer: page sidebar', () => {
  let page: Page
  const pageIds: Array<number | string> = []
  let writesInFlight = 0

  /**
   * A draft page with a Content block, so the analyzer has something to read. Created and
   * deleted through the REST API as the logged-in admin: the dev server then does every page
   * write itself. Seeding with the Local API from this process instead races the server's
   * autosaves for the same SQLite file (`SQLITE_BUSY`).
   */
  const seedPage = async () => {
    const response = await page.request.post('/api/pages?draft=true', {
      data: {
        title: `E2E espresso guide ${Date.now()}`,
        _status: 'draft',
        hero: { type: 'none' },
        layout: [
          {
            blockType: 'content',
            columns: [
              {
                size: 'full',
                richText: lexicalParagraphs(
                  'Espresso is brewed by forcing hot water through finely ground coffee.',
                  'A good shot needs fresh beans, a steady grind and about thirty seconds.',
                ),
              },
            ],
          },
        ],
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
    const { doc } = await response.json()
    pageIds.push(doc.id)
    return doc.id as number
  }

  const sidebar = () => page.locator('.seo-analyzer')
  const readScore = async () => Number(await page.locator('.seo-analyzer__ring-value').textContent())
  const readWords = async () => Number((await sidebar().getByText(/^\d+ words$/).textContent())?.match(/\d+/)?.[0])

  /** Opens the page's edit view and waits until the analyzer has read the form. */
  const openEditView = async (id: number | string) => {
    await page.goto(`/admin/collections/pages/${id}`)
    await expect(sidebar().getByText(`${SEEDED_WORDS} words`, { exact: true })).toBeVisible()
    // The form is disabled until its state has loaded.
    await expect(page.locator('#field-title')).toBeEnabled()
  }

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()

    const context = await browser.newContext()
    page = await context.newPage()
    // Autosave can leave an edit "unsaved" when the next test navigates away.
    page.on('dialog', (dialog) => void dialog.accept())
    // Writes in flight (the edit view autosaves a draft as fields change).
    const track = (delta: number) => (request: Request) => {
      if (request.method() !== 'GET') writesInFlight += delta
    }
    page.on('request', track(1))
    page.on('requestfinished', track(-1))
    page.on('requestfailed', track(-1))

    await login({ page, user: testUser })
  })

  // Leaving while an autosave is in flight aborts it midway, and the next test's page then
  // sometimes never finishes initialising its form (it stays disabled). Let the writes land,
  // then drop the page, which also stops a debounced autosave from firing during the next seed.
  test.afterEach(async () => {
    await expect.poll(() => writesInFlight).toBe(0)
    await page.goto('about:blank')
  })

  test.afterAll(async () => {
    for (const id of pageIds) {
      // 404: the test already deleted it. Anything else would leave the page behind.
      const response = await page.request.delete(`/api/pages/${id}`)
      expect([200, 404]).toContain(response.status())
      await deleteScoreHistory('pages', id)
    }
    await cleanupTestUser()
  })

  test('shows the score of the page being edited', async () => {
    await openEditView(await seedPage())

    await expect(sidebar().getByText('SEO Score')).toBeVisible()
    const score = await readScore()
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(100)
    // The ring is labelled for assistive tech with the same number.
    await expect(sidebar().getByRole('img', { name: new RegExp(`^${score}\\b`) })).toBeVisible()
  })

  test('re-scores when the primary keyword and the meta title change', async () => {
    await openEditView(await seedPage())
    const initial = await readScore()

    await page.getByLabel('Primary SEO keyword').fill('espresso')
    await expect.poll(readScore).not.toBe(initial)
    const withKeyword = await readScore()

    await page.getByRole('tab', { name: 'SEO' }).click()
    await page.locator('#field-meta__title').fill('Espresso brewing guide: grind, dose and time | Cargo Template')
    await expect.poll(readScore).not.toBe(withKeyword)

    // The card reports how far the score moved since the page was opened.
    await expect(sidebar().getByText(/^[+-]\d+$/)).toBeVisible()
  })

  test('re-analyses the content as it is typed', async () => {
    await openEditView(await seedPage())

    await page.getByRole('tab', { name: 'Content' }).click()
    await page.getByRole('button', { name: 'Show All: Layout' }).click()
    await page.getByRole('button', { name: 'Show All: Columns' }).click()
    const editor = page.getByRole('tabpanel', { name: 'Content' }).locator('[data-lexical-editor="true"]').first()
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' Pull the espresso slowly and keep the portafilter clean between shots.')

    await expect.poll(readWords).toBeGreaterThan(SEEDED_WORDS)
    const score = await readScore()
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})
