import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, expect } from 'vitest'

import { seoSidebarParity } from './localD1/seoSidebarParity'

let payload: Payload

beforeAll(async () => {
  const payloadConfig = await config
  payload = await getPayload({ config: payloadConfig })
})

describe('API', () => {
  it('fetches users', async () => {
    const users = await payload.find({
      collection: 'users',
      overrideAccess: true,
    })
    expect(users).toBeDefined()
  })
})

// Suites that need Payload on the local D1 run from this file, with this instance: a second
// spec file booting Payload would start another workerd on the same SQLite file (SQLITE_BUSY).
seoSidebarParity(() => payload)
