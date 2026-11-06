import { describe, expect, it } from 'vitest'
import { unstable_readConfig } from 'wrangler'

// The Worker config as Wrangler resolves it for each environment (inheritance included), the
// same resolution `wrangler deploy` and the Vite plugin's build use.
const read = (env?: string) =>
  unstable_readConfig({ config: 'wrangler.jsonc', ...(env ? { env } : {}) }, { hideWarnings: true })

describe('wrangler.jsonc', () => {
  it('runs the scheduled jobs on production every 5 minutes', () => {
    expect(read().triggers.crons).toEqual(['*/5 * * * *'])
  })

  it('has no Cron Trigger on staging (#116): an empty list, so a deploy clears it', () => {
    const staging = read('staging')
    expect(staging.name).toBe('cargo-template-staging')
    expect(staging.triggers.crons).toEqual([])
  })
})
