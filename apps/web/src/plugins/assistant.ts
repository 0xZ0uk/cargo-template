import type { AssistantConversationsOptions } from '@cargo/payload-plugin-assistant'

import { isWorkersRuntime } from '#cloudflare-runtime'

type Bindings = Partial<Pick<CloudflareEnv, 'ASSISTANT_CONVERSATIONS' | 'ASSISTANT_INDEX'>>

/**
 * Where the assistant keeps conversations: the Durable Objects on Workers (`pnpm preview` and
 * deployed), one per conversation plus one index per user, in their own SQLite (never D1).
 *
 * The Node dev server, the tests and the Payload CLI get `undefined`, i.e. the plugin's in-memory
 * conversations (lost on restart): Wrangler's binding proxy can't run Durable Objects that this
 * Worker defines itself, nor the `ASSISTANT_SELF` service binding back to it.
 */
export function assistantConversations(env: Bindings): AssistantConversationsOptions | undefined {
  if (!isWorkersRuntime) return undefined
  if (!env.ASSISTANT_CONVERSATIONS || !env.ASSISTANT_INDEX) {
    throw new Error(
      'The assistant needs the ASSISTANT_CONVERSATIONS and ASSISTANT_INDEX Durable Object bindings (wrangler.jsonc).',
    )
  }
  return { namespace: env.ASSISTANT_CONVERSATIONS, index: env.ASSISTANT_INDEX }
}

/**
 * The plugin's scripted test model, for the Playwright specs (`ASSISTANT_TEST_MODEL=1`, set in
 * `playwright.config.ts`), so CI runs real assistant turns with no OpenRouter key.
 *
 * Three locks: the flag must be `1`, `APP_ENV` must be `development` (or unset): an allowlist,
 * so any deployed env (`production`, `staging`, or one added later) keeps it off; and the plugin only uses it for
 * requests made to a loopback host, so a deployed Worker keeps the real model even if the first
 * two were set by mistake.
 */
export function assistantTestModel(env: {
  ASSISTANT_TEST_MODEL?: string
  APP_ENV?: string
}): boolean {
  return env.ASSISTANT_TEST_MODEL === '1' && DEV_APP_ENVS.has(env.APP_ENV ?? '')
}

const DEV_APP_ENVS = new Set(['', 'development'])
