import { describe, expect, it } from 'vitest'

import { trailingSlashTarget } from '@/utilities/trailingSlash'

const target = (path: string) => trailingSlashTarget(new URL(path, 'https://site.example'))

describe('trailingSlashTarget', () => {
  it.each([
    ['/about/', '/about'],
    ['/about///', '/about'],
    ['/blog/old-post/', '/blog/old-post'],
    ['/about/?utm_source=x&a=1', '/about?utm_source=x&a=1'],
    ['/sitemap.xml/', '/sitemap.xml'],
  ])('%s -> %s', (input, expected) => {
    expect(target(input)).toBe(expected)
  })

  it.each(['/', '/about', '/about?x=1', '/admin/', '/admin/collections/pages/', '/api/', '/api/pages/'])(
    'leaves %s alone',
    (input) => {
      expect(target(input)).toBeNull()
    },
  )

  it('does not treat a lookalike prefix as a Payload path', () => {
    expect(target('/administration/')).toBe('/administration')
    expect(target('/apis/')).toBe('/apis')
  })
})
