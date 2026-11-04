# Writing assistant

Give editors a writing assistant in text fields: **✨** above the text they're editing offers **Shorter**, **Clearer**, **Friendlier** and **Fix spelling**, or their own instruction ("Translate into French", "Add a call to action"). The answer replaces the text in the editor. **Enter** keeps it, **Escape** drops it, and **⌘Z** undoes it after keeping.

payload-onpage bundles no AI vendor. You pass an `assist` port that calls your own server, which talks to the model and checks that the caller is signed in. The [example](<../../examples/basic/src/app/(frontend)/onpage-assist/route.ts>) uses Claude when `ANTHROPIC_API_KEY` is set, and a small offline stand-in otherwise.

## Next.js

```ts
// app/(frontend)/onpage-assist/route.ts: signed-in Payload users only
import configPromise from '@payload-config'
import { getPayload } from 'payload'

export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin)
    return new Response(null, { status: 403 })
  const payload = await getPayload({ config: configPromise })
  const { user } = await payload.auth({ headers: req.headers })
  if (!user) return new Response(null, { status: 401 })
  const { text, instruction } = await req.json()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 1024,
      system: 'Rewrite text for a web page field. Reply with the new text only.',
      messages: [{ role: 'user', content: `Instruction: ${instruction}\n\nText:\n${text}` }],
    }),
  })
  const json = await res.json()
  return Response.json({ text: json.content?.[0]?.text?.trim() ?? text })
}
```

```tsx
// app/(frontend)/onpage-mount.tsx
'use client'
import type { AssistPort } from '@cargo/onpage-core'
import { OnPageMount, type OnPageMountProps } from '@cargo/onpage-next/client'

const assist: AssistPort = {
  async rewrite({ text, instruction, field, locale, signal }) {
    const res = await fetch('/onpage-assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, instruction, field, locale }),
      signal,
    })
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()).text
  },
}

export const Mount = (props: OnPageMountProps) => <OnPageMount {...props} assist={assist} />
// layout: <OnPage mount={Mount} />
```

## TanStack Start

Use a server function the same way ([example](../../examples/tanstack/src/functions/assist.functions.ts)), and pass `assist` from your own `mount` ([example](../../examples/tanstack/src/components/OnPageMount.tsx)).

## What the assistant gets

`rewrite({ text, instruction, field: { name, label, type }, locale, ref, path, signal })`. `locale` is the content locale being edited, and `signal` aborts when the editor asks again or closes. It applies to text, textarea and email fields. Rich text keeps its formatting toolbar without the assistant for now.
