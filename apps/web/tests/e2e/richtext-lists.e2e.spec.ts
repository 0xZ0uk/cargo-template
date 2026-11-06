import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// Lists in the rich text editors: written in the admin's editor, they are saved as `list` nodes
// and show as real lists on the page; the on-page editor edits an existing one.

const text = (value: string) => ({
  type: 'text',
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  version: 1,
})

const node = (type: string, children: unknown[], extra = {}) => ({
  type,
  children,
  direction: 'ltr',
  format: '',
  indent: 0,
  version: 1,
  ...extra,
})

const listNode = (listType: 'bullet' | 'number', items: string[]) =>
  node(
    'list',
    items.map((item, i) => node('listitem', [text(item)], { value: i + 1 })),
    {
      listType,
      start: 1,
      tag: listType === 'bullet' ? 'ul' : 'ol',
    },
  )

const pageData = (title: string, slug: string) => ({
  title,
  slug,
  _status: 'published',
  layout: [
    {
      blockType: 'richText',
      richText: {
        root: node('root', [
          node('paragraph', [text('Intro paragraph')], { textFormat: 0 }),
          listNode('bullet', ['Alpha', 'Beta']),
          listNode('number', ['First', 'Second']),
        ]),
      },
    },
  ],
})

test.describe('Rich text lists', () => {
  let context: BrowserContext
  let admin: Page
  let api: APIRequestContext
  let id: number
  const slug = `e2e-lists-${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()
    context = await browser.newContext()
    admin = await context.newPage()
    api = context.request
    await login({ page: admin, user: testUser })
    const response = await api.post('/api/pages', { data: pageData('E2E rich text lists', slug) })
    expect(response.ok(), await response.text()).toBe(true)
    id = (await response.json()).doc.id
  })

  test.afterAll(async () => {
    // Leave the document first: while it is open in the admin it holds an edit lock, which
    // blocks deleting the page.
    await admin.goto('/admin')
    const response = await api.delete(`/api/pages/${id}`)
    expect([200, 404]).toContain(response.status())
    await context.close()
    await cleanupTestUser()
  })

  test('the page shows the saved lists as real lists', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage()
    await page.goto(`/${slug}`)
    await expect(page.locator('ul.list-bullet > li')).toHaveText(['Alpha', 'Beta'])
    await expect(page.locator('ol.list-number > li')).toHaveText(['First', 'Second'])
    // Bullets and numbers are drawn (Tailwind's reset removes them; prose puts them back).
    await expect(page.locator('ul.list-bullet')).toHaveCSS('list-style-type', 'disc')
    await expect(page.locator('ol.list-number')).toHaveCSS('list-style-type', 'decimal')
    await page.context().close()
  })

  test('the admin editor offers lists, and a list typed there is saved', async () => {
    await admin.goto(`/admin/collections/pages/${id}`)
    await expect(admin.locator('#field-title')).toBeEnabled()
    await admin
      .getByRole('button', { name: 'Show All: Layout' })
      .click()
      .catch(() => undefined)

    const editable = admin.locator('.rich-text-lexical .ContentEditable__root').first()
    await expect(editable).toBeVisible()
    // The toolbar's text style menu offers both list types.
    await admin
      .getByRole('button', { name: /Text style/ })
      .first()
      .click()
    await expect(admin.getByText('Unordered List', { exact: true })).toBeVisible()
    await expect(admin.getByText('Ordered List', { exact: true })).toBeVisible()
    await admin.keyboard.press('Escape')

    // The "- " Markdown shortcut starts a bulleted list, "1. " a numbered one.
    await editable.click()
    await admin.keyboard.press('Control+End')
    await admin.keyboard.press('Enter')
    await admin.keyboard.press('Enter')
    await admin.keyboard.type('- Gamma')
    await admin.keyboard.press('Enter')
    await admin.keyboard.type('Delta')
    await admin
      .getByRole('button', { name: /^Publish/ })
      .first()
      .click()

    await expect
      .poll(async () => {
        const doc = await (await api.get(`/api/pages/${id}?depth=0`)).json()
        return JSON.stringify(doc.layout?.[0]?.richText ?? {})
      })
      .toMatch(/Gamma.*Delta/)
    const doc = JSON.stringify((await (await api.get(`/api/pages/${id}?depth=0`)).json()).layout)
    expect(doc).toContain('"type":"list"')
    expect(doc).not.toContain('"listType":"check"')
  })

  test('the on-page editor edits a list item and keeps the list', async () => {
    await admin.goto(`/admin/collections/pages/${id}`)
    await expect(admin.locator('#field-title')).toBeEnabled()
    const [editor] = await Promise.all([
      context.waitForEvent('page'),
      admin.getByRole('button', { name: 'Edit on page' }).click(),
    ])
    editor.on('dialog', (dialog) => void dialog.accept())
    await expect(editor.getByRole('toolbar', { name: 'Page editor' })).toBeVisible()
    await editor.waitForLoadState('networkidle')

    // Click the start of "Alpha", as an editor would, and type in front of it.
    const item = editor.locator('ul.list-bullet > li', { hasText: 'Alpha' }).first()
    const box = (await item.boundingBox())!
    await editor.mouse.click(box.x + 1, box.y + box.height / 2)
    await expect(editor.locator('.po-rt-surface')).toBeFocused()
    await editor.keyboard.type('Zero ')
    await editor.getByTestId('onpage-rt-done').click()
    await expect(editor.locator('ul.list-bullet > li').first()).toContainText('Zero Alpha')

    // Autosaved as a draft: still a list, with the edit in its item.
    await expect
      .poll(async () =>
        JSON.stringify(await (await api.get(`/api/pages/${id}?draft=true&depth=0`)).json()),
      )
      .toContain('Zero Alpha')
    const draft = JSON.stringify(
      await (await api.get(`/api/pages/${id}?draft=true&depth=0`)).json(),
    )
    expect(draft).toContain('"listType":"bullet"')
    expect(draft).toContain('"listType":"number"')
    await editor.close()
  })
})
