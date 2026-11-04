# Testing your integration

## Component tests: an in-memory data source

`@cargo/onpage-core/testing` has `memoryDataSource`, a `DataSource` that keeps documents in memory. It applies saves, checks for stale writes the way the plugin does, and records every save. Use it to test custom field editors, renderers and client-mode pages without a Payload server:

```tsx
import { memoryDataSource } from '@cargo/onpage-core/testing'
import { OnPageEditor } from '@cargo/onpage-react'

const ds = memoryDataSource({
  schemas: { pages: pageSchema }, // a DocumentSchema, as the plugin's schema endpoint returns it
  docs: { 'c:pages:1': { id: 1, title: 'Home', updatedAt: 'v0' } },
})

render(
  <>
    <h1 data-onpage-ref="c:pages:1" data-onpage-field="title">
      Home
    </h1>
    <OnPageEditor dataSource={ds} links={{ exit: '/exit' }} autosaveDelay={0} />
  </>,
)
// … click the heading, type, press Enter …
await waitFor(() => expect(ds.saves.at(-1)?.data).toMatchObject({ title: 'Hello' }))
```

`ds.docs` and `ds.published` hold the current versions. `ds.conflictOnce('c:pages:1')` makes the next save of that document fail as a conflict.

## End-to-end tests

Every control has a stable `data-testid` (`onpage-dock`, `onpage-publish`, `onpage-inline-text`, `onpage-block-picker`…). A Playwright test can enter edit mode the way editors do, from the admin:

```ts
async function editPage(context: BrowserContext, adminDocUrl: string) {
  const admin = await context.newPage()
  await admin.goto(adminDocUrl) // signed in, e.g. through a stored auth state
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    admin.getByTestId('onpage-edit-on-page').click(),
  ])
  await page.getByTestId('onpage-dock').waitFor()
  return page
}
```

Check that visitors get clean HTML too: with no session, a page's HTML has no `data-onpage` attributes, and no invisible marker characters (`[⁠-⁤]`). This repository's own suite ([`e2e/onpage.spec.ts`](../../e2e/onpage.spec.ts)) does all of this against both examples.
