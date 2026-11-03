import type { SeoRateLimit, SeoRateLimitBucket } from '@cargo/payload-seo-analyzer'

type Bindings = Partial<
  Pick<CloudflareEnv, 'SEO_RATE_LIMIT_AI_INTERACTIVE' | 'SEO_RATE_LIMIT_AUDIT_POLL' | 'SEO_RATE_LIMIT_EXPENSIVE'>
>

/**
 * Backs the SEO analyzer's rate limits with Workers Rate Limiting bindings, so every isolate
 * in a location shares one count per caller (the plugin's in-memory limiters count per
 * isolate). The bindings' limits in `wrangler.jsonc` mirror `SEO_RATE_LIMITS`.
 *
 * A bucket without a binding (`seo-logs`, whose feature is off) returns `undefined`, which
 * keeps the plugin's in-memory limiter for it.
 */
export function workersSeoRateLimit(env: Bindings): SeoRateLimit {
  const bindings: Partial<Record<SeoRateLimitBucket, RateLimit>> = {
    'ai-interactive': env.SEO_RATE_LIMIT_AI_INTERACTIVE,
    'audit-poll': env.SEO_RATE_LIMIT_AUDIT_POLL,
    expensive: env.SEO_RATE_LIMIT_EXPENSIVE,
  }

  return async ({ bucket, key }) => {
    const binding = bindings[bucket]
    if (!binding) return undefined

    const { success } = await binding.limit({ key })

    return success
  }
}
