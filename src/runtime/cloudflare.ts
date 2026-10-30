import { env } from 'cloudflare:workers'

export type RuntimeCloudflareEnv = CloudflareEnv & {
  PAYLOAD_SECRET?: string
}

export const cloudflareEnv = env as RuntimeCloudflareEnv

// Workers have no filesystem, so uploads must go to R2.
export const isWorkersRuntime = true
