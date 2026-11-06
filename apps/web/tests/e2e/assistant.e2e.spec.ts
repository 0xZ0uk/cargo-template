import { expect, test, type Page } from '@playwright/test'
import { login } from '../helpers/login'
import { cleanupTestUser, seedTestUser, testUser } from '../helpers/seedUser'

// The admin assistant (/admin/assistant) end to end: the chat view, a real turn through the
// endpoint, plugin-mcp's tools as the signed-in user, and the approval cards. The model is the
// plugin's scripted test model (ASSISTANT_TEST_MODEL=1, set by playwright.config.ts for the server
// it starts), so no OpenRouter key is needed: `/tool <name> <JSON>` in a message calls that tool,
// and after the result it answers "Tool <name> finished: …".

test.describe('Assistant', () => {
  let page: Page
  let pageId: number | string
  const originalTitle = `E2E assistant draft ${Date.now()}`

  /** The draft page's current title, read as the admin through the REST API. */
  const draftTitle = async () => {
    const response = await page.request.get(`/api/pages/${pageId}?draft=true&depth=0`)
    expect(response.ok(), await response.text()).toBe(true)
    return ((await response.json()) as { title: string }).title
  }

  /** `/tool updateDocument …` for the draft page: the scripted model proposes this exact write. */
  const updateCommand = (title: string) =>
    `/tool updateDocument ${JSON.stringify({ slug: 'pages', id: pageId, draft: true, data: { title } })}`

  /** Open a new conversation and send one message. */
  const send = async (message: string) => {
    await page.goto('/admin/assistant')
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible()
    await page.getByLabel('Message the assistant').fill(message)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
  }

  test.beforeAll(async ({ browser }) => {
    await seedTestUser()
    const context = await browser.newContext()
    page = await context.newPage()
    await login({ page, user: testUser })

    // Never let this spec reach OpenRouter: a reused dev server started without the flag fails here.
    const config = await (await page.request.get('/api/assistant/config')).json()
    expect(
      config,
      'Start the server with ASSISTANT_TEST_MODEL=1 (playwright.config.ts does for the server it starts)',
    ).toMatchObject({ configured: true, testModel: true })

    // Seeded through the REST API as the admin, so the dev server does every write itself.
    const response = await page.request.post('/api/pages?draft=true', {
      data: { title: originalTitle, _status: 'draft' },
    })
    expect(response.ok(), await response.text()).toBe(true)
    pageId = (await response.json()).doc.id
  })

  test.afterAll(async () => {
    if (pageId !== undefined) {
      const response = await page.request.delete(`/api/pages/${pageId}`)
      expect([200, 404]).toContain(response.status())
    }
    await page.context().close()
    await cleanupTestUser()
  })

  test('sends a message: a tool call row, then the answer', async () => {
    await expect(page.getByRole('link', { name: 'Chat' }).first()).toBeAttached()
    await send(
      `/tool findDocuments ${JSON.stringify({
        slug: 'pages',
        where: { id: { equals: pageId } },
        select: { title: true },
        limit: 1,
        depth: 0,
        draft: true,
      })}`,
    )

    const tool = page.locator('.assistant-tool', {
      has: page.locator('code', { hasText: 'findDocuments' }),
    })
    await expect(tool).toBeVisible()
    await expect(tool).toHaveAttribute('data-status', 'done')
    await expect(page.getByText(/^Tool findDocuments finished:/)).toBeVisible()
    await expect(page.getByLabel('Assistant').filter({ hasText: originalTitle })).not.toHaveCount(0)
    // The conversation is listed, titled from its first message.
    await expect(page.getByText('/tool findDocuments').first()).toBeVisible()
    // The budget line (#68): today's allowance and what this conversation cost (the test model
    // reports $1 per million tokens), and the cost in the list.
    await expect(page.locator('.assistant-usage')).toContainText(
      /of \$5\.00 left today · this conversation \$0\.\d+/,
    )
    await expect(page.locator('.assistant-sidebar__cost').first()).toHaveText(/^\$0\.\d+$/)
  })

  test('approves an update to a draft page: the card shows the diff, then it is saved', async () => {
    const newTitle = `${originalTitle} (approved)`
    await send(updateCommand(newTitle))

    const card = page.locator('article.assistant-approval-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText(originalTitle)
    await expect(card).toContainText(newTitle)
    // Nothing is written before the answer.
    expect(await draftTitle()).toBe(originalTitle)

    // Enabled once the diff has loaded.
    await card.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(card.getByText('Applied, saved as a draft.')).toBeVisible()
    await expect(page.getByText(/^Tool updateDocument finished:/)).toBeVisible()
    await expect.poll(draftTitle).toBe(newTitle)

    // Reset for the next test.
    const reset = await page.request.patch(`/api/pages/${pageId}?draft=true`, {
      data: { title: originalTitle },
    })
    expect(reset.ok(), await reset.text()).toBe(true)
  })

  test('rejects an update: nothing is written', async () => {
    await send(updateCommand(`${originalTitle} (rejected)`))

    const card = page.locator('article.assistant-approval-card')
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Reject', exact: true }).click()
    await card.getByLabel('Why not? (optional, sent to the assistant)').fill('Keep the old title')
    await card.getByRole('button', { name: 'Reject change' }).click()

    await expect(card.getByText('Rejected: nothing was written.')).toBeVisible()
    await expect(page.getByText('The change was rejected. Nothing was written.')).toBeVisible()
    expect(await draftTitle()).toBe(originalTitle)
  })

  test("rewrites a paragraph of a block's rich text from Markdown: the card shows it as text", async () => {
    const paragraph = (text: string) => ({
      type: 'paragraph',
      version: 1,
      direction: 'ltr',
      format: '',
      indent: 0,
      textFormat: 0,
      children: [
        { type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' },
      ],
    })
    const created = await page.request.post('/api/pages?draft=true', {
      data: {
        title: `${originalTitle} (rich text)`,
        _status: 'draft',
        layout: [
          {
            blockType: 'richText',
            richText: {
              root: {
                type: 'root',
                version: 1,
                direction: 'ltr',
                format: '',
                indent: 0,
                children: [
                  paragraph('The old first paragraph.'),
                  paragraph('The second paragraph.'),
                ],
              },
            },
          },
        ],
      },
    })
    expect(created.ok(), await created.text()).toBe(true)
    const richTextPageId = (await created.json()).doc.id
    const readLayout = async () => {
      const response = await page.request.get(`/api/pages/${richTextPageId}?draft=true&depth=0`)
      return (
        (await response.json()) as {
          layout: Array<{
            id: string
            richText: { root: { children: Array<{ children: Array<{ text: string }> }> } }
          }>
        }
      ).layout
    }
    const before = await readLayout()

    try {
      await send(
        `/tool setRichTextFromMarkdown ${JSON.stringify({
          slug: 'pages',
          id: richTextPageId,
          path: 'layout.0.richText',
          markdown: 'The **new** first paragraph.\n\nThe second paragraph.',
        })}`,
      )
      const card = page.locator('article.assistant-approval-card')
      await expect(card).toBeVisible()
      await expect(card.getByRole('heading', { name: 'Update Page' })).toBeVisible()
      await expect(card.locator('.assistant-diff__side--before')).toContainText(
        'The old first paragraph.',
      )
      await expect(card.locator('.assistant-diff__side--after')).toContainText(
        'The **new** first paragraph.',
      )
      await expect(card).not.toContainText('"root"')

      await card.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(card.getByText('Applied, saved as a draft.')).toBeVisible()
      await expect(page.getByText(/^Tool setRichTextFromMarkdown finished:/)).toBeVisible()
      await expect
        .poll(async () =>
          (await readLayout())[0]!.richText.root.children[0]!.children.map((c) => c.text).join(''),
        )
        .toBe('The new first paragraph.')
      const after = await readLayout()
      expect(after[0]!.id).toBe(before[0]!.id)
      expect(after[0]!.richText.root.children[1]).toMatchObject({
        children: [{ text: 'The second paragraph.' }],
      })
    } finally {
      await page.request.delete(`/api/pages/${richTextPageId}`)
    }
  })
})
