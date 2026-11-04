import { describe, expect, it } from 'vitest'

import { resolveDocTitle, stripSiteName } from '../helpers/docTitle.js'

describe('stripSiteName', () => {
  it('removes a site name set off by a separator, at the end or the start', () => {
    expect(stripSiteName('Coffee brewing basics | Cargo Template', 'Cargo Template')).toBe('Coffee brewing basics')
    expect(stripSiteName('Coffee - Cargo Template', 'Cargo Template')).toBe('Coffee')
    expect(stripSiteName('Coffee — cargo template', 'Cargo Template')).toBe('Coffee')
    expect(stripSiteName('Cargo Template: Coffee', 'Cargo Template')).toBe('Coffee')
  })

  it('leaves a name that is part of the title, or a title that is only the site name', () => {
    expect(stripSiteName('Why Cargo Template exists', 'Cargo Template')).toBe('Why Cargo Template exists')
    expect(stripSiteName('Cargo Template', 'Cargo Template')).toBe('Cargo Template')
  })

  it('treats regex characters in the site name literally', () => {
    expect(stripSiteName('Docs | A.B (beta)', 'A.B (beta)')).toBe('Docs')
    expect(stripSiteName('Docs | AxB (beta)', 'A.B (beta)')).toBe('Docs | AxB (beta)')
  })

  it('only trims when no site name is configured', () => {
    expect(stripSiteName(' Coffee | Cargo Template ')).toBe('Coffee | Cargo Template')
  })
})

describe('resolveDocTitle', () => {
  it("prefers the document's own title over meta.title", () => {
    expect(resolveDocTitle({ title: 'Coffee', meta: { title: 'Coffee | Cargo Template' } }, 'Cargo Template')).toBe('Coffee')
  })

  it('falls back to meta.title with the site name stripped', () => {
    expect(resolveDocTitle({ meta: { title: 'Coffee | Cargo Template' } }, 'Cargo Template')).toBe('Coffee')
    expect(resolveDocTitle({ title: '  ', meta: { title: 'Coffee | Cargo Template' } })).toBe('Coffee | Cargo Template')
  })

  it('is empty without either title', () => {
    expect(resolveDocTitle({})).toBe('')
    expect(resolveDocTitle({ meta: { title: 3 } })).toBe('')
  })
})
