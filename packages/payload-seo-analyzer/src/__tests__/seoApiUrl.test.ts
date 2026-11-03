import { describe, expect, it } from 'vitest'
import { buildPayloadApiUrl, buildSeoApiUrl, payloadApiRoute } from '../helpers/seoApiUrl.js'

describe('buildSeoApiUrl', () => {
  it('defaults to /api + /seo-plugin', () => {
    expect(buildSeoApiUrl(undefined, '/audit')).toBe('/api/seo-plugin/audit')
    expect(buildSeoApiUrl({}, '/audit')).toBe('/api/seo-plugin/audit')
  })

  it('honours a custom Payload routes.api', () => {
    expect(buildSeoApiUrl({ apiRoute: '/payload-api' }, '/audit')).toBe('/payload-api/seo-plugin/audit')
    expect(buildSeoApiUrl({ apiRoute: '/v1/api' }, '/audit')).toBe('/v1/api/seo-plugin/audit')
  })

  it('honours a custom endpointBasePath', () => {
    expect(buildSeoApiUrl({ endpointBasePath: '/seo' }, '/audit')).toBe('/api/seo/audit')
    expect(buildSeoApiUrl({ apiRoute: '/x', endpointBasePath: '/a/b' }, '/audit')).toBe('/x/a/b/audit')
  })

  it('never produces double or missing slashes', () => {
    expect(buildSeoApiUrl({ apiRoute: '/api/', endpointBasePath: '/seo-plugin/' }, '/audit')).toBe('/api/seo-plugin/audit')
    expect(buildSeoApiUrl({ apiRoute: 'api', endpointBasePath: 'seo-plugin' }, 'audit')).toBe('/api/seo-plugin/audit')
    expect(buildSeoApiUrl({ apiRoute: '//api//', endpointBasePath: '//seo//' }, '/audit')).toBe('/api/seo/audit')
  })

  it('keeps the query string and nested paths', () => {
    expect(buildSeoApiUrl({}, '/audit?limit=500&x=a/b')).toBe('/api/seo-plugin/audit?limit=500&x=a/b')
    expect(buildSeoApiUrl({}, '/gsc/data?dimension=query')).toBe('/api/seo-plugin/gsc/data?dimension=query')
  })

  it('supports an API mounted at the root and an empty base path', () => {
    expect(buildSeoApiUrl({ apiRoute: '', endpointBasePath: '/seo-plugin' }, '/audit')).toBe('/seo-plugin/audit')
    expect(buildSeoApiUrl({ apiRoute: '/api', endpointBasePath: '' }, '/audit')).toBe('/api/audit')
  })
})

describe('buildPayloadApiUrl / payloadApiRoute', () => {
  it('builds Payload REST URLs from routes.api', () => {
    expect(buildPayloadApiUrl(undefined, '/pages/1')).toBe('/api/pages/1')
    expect(buildPayloadApiUrl('/cms/', 'pages/1')).toBe('/cms/pages/1')
  })

  it('reads routes.api from a Payload instance, defaulting to /api', () => {
    expect(payloadApiRoute({ config: { routes: { api: '/cms' } } })).toBe('/cms')
    expect(payloadApiRoute({ config: {} })).toBe('/api')
    expect(payloadApiRoute(undefined)).toBe('/api')
  })
})
