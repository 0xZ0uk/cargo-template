import { describe, expect, it, vi } from 'vitest'

type Validator = (data: unknown) => { pathname: string }
type Handler = (args: { data: { pathname: string } }) => Promise<unknown>

const capture = vi.hoisted(() => ({
  validator: null as Validator | null,
  handler: null as Handler | null,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (v: Validator) => {
      capture.validator = v
      return {
        handler: (h: Handler) => {
          capture.handler = h
          return 'stub'
        },
      }
    },
  }),
}))
const session = vi.hoisted(() => ({
  mode: null as 'edit' | 'view' | null,
  checked: [] as string[],
}))
vi.mock('../session.server.ts', () => ({
  getOnPageMode: () => Promise.resolve(session.mode),
  isSharedPreviewFor: (pathname: string) => {
    session.checked.push(pathname)
    return Promise.resolve(pathname === '/shared')
  },
}))

await import('../state.functions.ts')

describe('getOnPageState', () => {
  it('checks the mount pathname against the sealed grant', async () => {
    const data = capture.validator!({ pathname: '/shared' })
    expect(data).toEqual({ pathname: '/shared' })
    await expect(capture.handler!({ data })).resolves.toEqual({ mode: null, shared: true })
    expect(session.checked).toEqual(['/shared'])
  })

  it('fails closed on missing or garbage input', () => {
    expect(capture.validator!(undefined)).toEqual({ pathname: '/' })
    expect(capture.validator!({ pathname: 42 })).toEqual({ pathname: '/' })
    expect(capture.validator!(null)).toEqual({ pathname: '/' })
  })
})
