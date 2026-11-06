import { expect } from '@playwright/test'
import { getPayload } from 'payload'
import config from '../../src/payload.config.js'

export const testUser = {
  email: 'dev@payloadcms.com',
  password: 'test',
}

/**
 * The dev server holds the same local D1 (SQLite) file open, and can still be writing for the
 * previous spec (preferences, sessions) when the next one seeds, so a write from this process can
 * hit `SQLITE_BUSY` ("Failed to get session commit token"). Retried, like `seoStore.ts` does.
 */
const retryBusy = (run: () => Promise<unknown>) => expect(run).toPass({ timeout: 15_000 })

const deleteTestUser = async () => {
  const payload = await getPayload({ config })
  await payload.delete({
    collection: 'users',
    where: {
      email: {
        equals: testUser.email,
      },
    },
    overrideAccess: true,
  })
  return payload
}

/**
 * Seeds a test user for e2e admin tests.
 */
export async function seedTestUser(): Promise<void> {
  await retryBusy(async () => {
    // Delete existing test user if any, then create a fresh one (safe to repeat).
    const payload = await deleteTestUser()
    await payload.create({
      collection: 'users',
      data: testUser,
      overrideAccess: true,
    })
  })
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  await retryBusy(deleteTestUser)
}
