import type { PayloadRequest } from 'payload'

type Bindings = Partial<Pick<CloudflareEnv, 'ASSISTANT_RATE_LIMIT'>>

/**
 * Backs the assistant's `rateLimit` hook with a Workers Rate Limiting binding: one count per
 * admin user (`<auth collection>:<id>`) shared by every isolate in a location. Each chat turn
 * (a message or an approval answer) counts once; reads, rejoins and stop don't.
 *
 * Without the binding (it isn't in `env`) this returns `undefined`: the plugin then applies no
 * limit, which is what the Node dev server and the tests get if the proxy has none.
 */
export function workersAssistantRateLimit(
  env: Bindings,
): ((req: PayloadRequest) => Promise<boolean>) | undefined {
  const binding = env.ASSISTANT_RATE_LIMIT
  if (!binding) return undefined

  return async (req) => {
    // The plugin calls this after its own auth and access checks, so there is a user.
    const user = req.user
    if (!user) return false
    const { success } = await binding.limit({ key: `${user.collection}:${String(user.id)}` })
    return success
  }
}
