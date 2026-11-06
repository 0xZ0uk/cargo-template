/**
 * Minimal stand-ins for the @payloadcms/ui pieces the socials admin renders, for tests
 * that mock the package (the real entry imports CSS the test loader cannot parse, and its
 * hooks need the admin's providers).
 *
 *   vi.mock('@payloadcms/ui', async () => (await import('./helpers/payloadUiStub.js')).payloadUiStub)
 *
 * Stubs keep what tests assert on (real <button>s, aria attributes, roles, text, the
 * Banner type and Pill style as classes) and nothing else. `stubState` holds the config
 * and field values a test controls; call `resetStubState()` between tests.
 */
import React from 'react'
import { vi } from 'vitest'

type AnyProps = Record<string, any> & { children?: React.ReactNode }

const ariaProps = (props: AnyProps) =>
  Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('aria-')))

const defaultConfig = () => ({
  admin: {
    custom: {
      socials: {
        apiBasePath: '/socials',
        enabledPlatforms: ['pinterest', 'facebook'],
        sourceKinds: [] as Array<{ collection: string; kind: string; label?: string }>,
      },
    },
  },
  routes: { admin: '/admin', api: '/api' },
})

export const stubState = {
  config: defaultConfig(),
  documentId: undefined as number | string | undefined,
  fields: {} as Record<string, unknown>,
}

export const resetStubState = () => {
  stubState.config = defaultConfig()
  stubState.documentId = undefined
  stubState.fields = {}
}

export const toastStub = { error: vi.fn(), info: vi.fn(), success: vi.fn() }

export const payloadUiStub = {
  Banner: ({ children, className, type = 'default' }: AnyProps) => (
    <div className={['banner', `banner--type-${type}`, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  ),
  Button: ({ buttonStyle, children, className, disabled, onClick, type = 'button', ...rest }: AnyProps) => (
    <button
      className={['btn', buttonStyle && `btn--style-${buttonStyle}`, className].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
      type={type}
      {...ariaProps(rest)}
    >
      {children}
    </button>
  ),
  Collapsible: ({ children, header, initCollapsed }: AnyProps) => {
    const [collapsed, setCollapsed] = React.useState(Boolean(initCollapsed))
    return (
      <div className="collapsible">
        <button aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)} type="button">
          {header}
        </button>
        {!collapsed && <div className="collapsible__content">{children}</div>}
      </div>
    )
  },
  Pill: ({ children, className, pillStyle = 'light' }: AnyProps) => (
    <span className={['pill', `pill--style-${pillStyle}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  ),
  Spinner: ({ loadingText }: AnyProps) => <span role="status">{loadingText ?? 'Loading...'}</span>,
  Tabs: ({ onChange, tabs, value }: AnyProps) => (
    <div className="tabs" role="tablist">
      {tabs.map((tab: AnyProps) => (
        <button
          aria-controls={tab.panelID}
          aria-selected={tab.value === value}
          id={tab.id}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  toast: toastStub,
  useConfig: () => ({ config: stubState.config }),
  useDocumentInfo: () => ({ id: stubState.documentId }),
  useField: ({ path }: { path: string }) => {
    const [value, setLocal] = React.useState(stubState.fields[path])
    return {
      setValue: (next: unknown) => {
        stubState.fields[path] = next
        setLocal(next)
      },
      value,
    }
  },
  useListDrawer: () => [() => null, null, { closeDrawer: vi.fn(), openDrawer: vi.fn() }],
}

type JsonRoute = { body: unknown; status?: number } | ((init?: RequestInit) => { body: unknown; status?: number })

/**
 * Replaces `fetch` with a router keyed by URL substring (first match wins; longer keys
 * first). Unmatched URLs answer 404. Returns the mock to inspect calls.
 */
export const mockFetch = (routes: Record<string, JsonRoute>) => {
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length)
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = keys.find((candidate) => url.includes(candidate))
    const route = key ? routes[key] : { body: { error: 'not found' }, status: 404 }
    const { body, status = 200 } = typeof route === 'function' ? route(init) : route
    return {
      headers: new Headers(),
      json: async () => body,
      ok: status >= 200 && status < 300,
      status,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
