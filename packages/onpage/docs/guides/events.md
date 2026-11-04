# Logging and error reporting

`onEvent` hears what happens in the editor: saves, failed saves, conflicts, publishes, and errors (a failed upload, a page refresh that threw). Use it for logs, analytics or error reporting. The editor has already shown the editor what happened; `onEvent` is for you.

Pass it from your own client mount, like custom editors (on Next.js, `<OnPage>` is a server component, so a function can't be passed to it directly):

```tsx
'use client'
// app/(frontend)/onpage-mount.tsx
import * as Sentry from '@sentry/nextjs'
import { OnPageMount, type OnPageMountProps } from '@cargo/onpage-next/client'

export function Mount(props: OnPageMountProps) {
  return (
    <OnPageMount
      {...props}
      onEvent={(event) => {
        if (event.type === 'error')
          Sentry.captureException(event.error, { tags: { onpage: event.where } })
        else if (event.type === 'saveFailed' || event.type === 'publishFailed')
          Sentry.captureMessage(`payload-onpage ${event.type}: ${event.message}`, 'warning')
      }}
    />
  )
}
```

```tsx
// app/(frontend)/layout.tsx
import { Mount } from './onpage-mount'

;<OnPage mount={Mount} />
```

On TanStack Start, pass `mount={Mount}` the same way.

## Events

| `type`          | When                                                            | Fields                                                               |
| --------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `saved`         | A draft save landed                                             | `ref`                                                                |
| `saveFailed`    | A save failed for good (validation, permissions, after retries) | `ref`, `message`                                                     |
| `conflict`      | Someone else saved first                                        | `ref`                                                                |
| `loadFailed`    | A document on the page couldn't load                            | `ref`, `message`                                                     |
| `published`     | Documents were published                                        | `refs`                                                               |
| `publishFailed` | Publishing failed                                               | `message`                                                            |
| `scheduled`     | Documents were scheduled                                        | `refs`, `at` (ISO)                                                   |
| `error`         | Something threw                                                 | `where` (`render`, `publish`, `schedule`, `share`, `media`), `error` |

`ref` is `{ kind, slug, id? }`. Messages are the server's, untranslated. Without `onEvent`, errors go to `console.error`.
