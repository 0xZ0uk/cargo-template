import { getPlatformProxy } from 'wrangler'

import type { RuntimeCloudflareEnv } from './cloudflare'

// Node dev server, tests and the Payload CLI get the same bindings through Wrangler's
// local proxy. `migrate:remote` switches D1 to the real remote database.
const proxy = await getPlatformProxy<RuntimeCloudflareEnv>({
  environment: process.env.CLOUDFLARE_ENV,
  remoteBindings: process.env.PAYLOAD_MIGRATE_REMOTE === 'true',
})

export const cloudflareEnv = proxy.env

export const isWorkersRuntime = false
