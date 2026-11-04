// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'

// @payloadcms/ui is a peer dependency whose entry point imports CSS, which the
// node/jsdom loader cannot parse. useConfig() has no default context: it is
// undefined outside the admin provider tree.
let configContext: { config: { admin?: { custom?: Record<string, unknown> } } } | undefined

vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useConfig: () => configContext,
}))

import { useDashboardT, useSeoFeature } from '../hooks/useSeoLocale.js'
import { getDashboardT } from '../dashboard-i18n.js'
import { getTranslations, t } from '../i18n.js'

afterEach(cleanup)

describe('useDashboardT — dashboard strings', () => {
  it('serves the English dictionary', () => {
    configContext = { config: {} }
    expect(renderHook(() => useDashboardT()).result.current).toBe(getDashboardT())
    expect(getDashboardT().common.loading).toBe('Loading...')
  })

  it('does not throw outside the admin provider tree', () => {
    configContext = undefined
    expect(renderHook(() => useDashboardT()).result.current).toBe(getDashboardT())
  })
})

describe('useSeoFeature — feature flags forwarded in admin.custom', () => {
  it('reads a flag from the client config', () => {
    configContext = { config: { admin: { custom: { seoAnalyzer: { features: { alerts: true, gscApi: false } } } } } }
    expect(renderHook(() => useSeoFeature('alerts')).result.current).toBe(true)
    expect(renderHook(() => useSeoFeature('gscApi')).result.current).toBe(false)
  })

  it('is undefined when the flags are unavailable', () => {
    configContext = undefined
    expect(renderHook(() => useSeoFeature('alerts')).result.current).toBeUndefined()
  })
})

describe('getTranslations', () => {
  it('serves the English dictionary', () => {
    expect(getTranslations().common.loading).toBe('Loading...')
    expect(getTranslations().rules.title.missingLabel).toBe('Meta title')
  })

  it('looks a string up by dot-path, returning the path itself when unknown', () => {
    expect(t('common.loading')).toBe('Loading...')
    expect(t('common.nope')).toBe('common.nope')
  })
})
