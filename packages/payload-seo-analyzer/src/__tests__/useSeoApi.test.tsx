// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'

// useConfig() has no default context: undefined outside the admin provider tree.
let configContext: { config: Record<string, unknown> } | undefined

vi.mock('@payloadcms/ui', async () => ({
  ...(await import('./helpers/payloadUiStub.js')).payloadUiStub,
  useConfig: () => configContext,
}))

import { useAdminRoute, usePayloadApi, useSeoApi } from '../hooks/useSeoApi.js'

afterEach(cleanup)

describe('useSeoApi', () => {
  it('uses routes.api and the endpointBasePath forwarded in admin.custom', () => {
    configContext = {
      config: {
        routes: { api: '/cms-api' },
        admin: { custom: { seoAnalyzer: { endpointBasePath: '/seo' } } },
      },
    }
    const { result } = renderHook(() => useSeoApi())
    expect(result.current('/audit?limit=5')).toBe('/cms-api/seo/audit?limit=5')
  })

  it('falls back to /api/seo-plugin without a provider or forwarded options', () => {
    configContext = undefined
    expect(renderHook(() => useSeoApi()).result.current('/audit')).toBe('/api/seo-plugin/audit')
    configContext = { config: { routes: { api: '/api' } } }
    expect(renderHook(() => useSeoApi()).result.current('/audit')).toBe('/api/seo-plugin/audit')
  })

  it('returns a stable function while the config does not change', () => {
    configContext = { config: { routes: { api: '/api' } } }
    const { result, rerender } = renderHook(() => useSeoApi())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('usePayloadApi', () => {
  it('builds Payload REST URLs from routes.api', () => {
    configContext = { config: { routes: { api: '/cms-api' } } }
    expect(renderHook(() => usePayloadApi()).result.current('/pages/1')).toBe('/cms-api/pages/1')
    configContext = undefined
    expect(renderHook(() => usePayloadApi()).result.current('/pages/1')).toBe('/api/pages/1')
  })
})

describe('useAdminRoute', () => {
  it('reads routes.admin, defaulting to /admin', () => {
    configContext = { config: { routes: { admin: '/dashboard' } } }
    expect(renderHook(() => useAdminRoute()).result.current).toBe('/dashboard')
    configContext = undefined
    expect(renderHook(() => useAdminRoute()).result.current).toBe('/admin')
  })
})
