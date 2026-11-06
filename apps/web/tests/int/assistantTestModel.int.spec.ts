import { describe, expect, it, vi } from 'vitest'

vi.mock('#cloudflare-runtime', () => ({ isWorkersRuntime: false }))

const { assistantTestModel } = await import('@/plugins/assistant')

describe('assistantTestModel', () => {
  it('is on with the flag in development (Playwright)', () => {
    expect(assistantTestModel({ ASSISTANT_TEST_MODEL: '1', APP_ENV: 'development' })).toBe(true)
    expect(assistantTestModel({ ASSISTANT_TEST_MODEL: '1' })).toBe(true)
  })

  it('is off without the flag', () => {
    expect(assistantTestModel({ APP_ENV: 'development' })).toBe(false)
    expect(assistantTestModel({ ASSISTANT_TEST_MODEL: '0', APP_ENV: 'development' })).toBe(false)
  })

  it.each(['production', 'staging', 'preview'])(
    'is off for any env but development (APP_ENV=%s)',
    (APP_ENV) => {
      expect(assistantTestModel({ ASSISTANT_TEST_MODEL: '1', APP_ENV })).toBe(false)
    },
  )
})
