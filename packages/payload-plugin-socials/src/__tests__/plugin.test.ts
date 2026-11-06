import type { Config } from 'payload'

import { describe, expect, it } from 'vitest'

import type { PayloadPluginSocialsConfig } from '../types/index.js'

import {
  SOCIAL_POSTS_SLUG,
  SOCIAL_TEMPLATES_SLUG,
  SOCIALS_CONNECTIONS_GLOBAL_SLUG,
} from '../constants.js'
import payloadPluginSocials, { TASK_SLUGS_OWNED_BY_PLUGIN } from '../index.js'

const HEX_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

const validOptions = (
  overrides: Partial<PayloadPluginSocialsConfig> = {},
): PayloadPluginSocialsConfig => ({
  authorize: () => Promise.resolve(true),
  encryptionKey: HEX_KEY,
  platforms: { pinterest: { enabled: false } },
  sources: {
    product: () => Promise.reject(new Error('stub resolver; not invoked in wiring tests')),
  },
  ...overrides,
})

const baseConfig = (): Config =>
  ({ collections: [], endpoints: [], globals: [] }) as unknown as Config

const slugsOf = (items: readonly unknown[]): string[] =>
  items
    .map((i) =>
      i && typeof i === 'object' && 'slug' in i ? (i as { slug?: unknown }).slug : undefined,
    )
    .filter((s): s is string => typeof s === 'string')

describe('payloadPluginSocials curried factory', () => {
  it('registers the social-posts collection exactly once', () => {
    const result = payloadPluginSocials(validOptions())(baseConfig())
    const matches = (result.collections ?? []).filter((c) => c.slug === SOCIAL_POSTS_SLUG)
    expect(matches).toHaveLength(1)
  })

  it('registers the socials-connections global', () => {
    const result = payloadPluginSocials(validOptions())(baseConfig())
    expect(slugsOf(result.globals ?? [])).toContain(SOCIALS_CONNECTIONS_GLOBAL_SLUG)
  })

  it('registers all plugin-owned job tasks', () => {
    const result = payloadPluginSocials(validOptions())(baseConfig())
    const taskSlugs = slugsOf(result.jobs?.tasks ?? [])
    for (const slug of TASK_SLUGS_OWNED_BY_PLUGIN) {
      expect(taskSlugs).toContain(slug)
    }
  })

  it('registers REST endpoints including a health check', () => {
    const result = payloadPluginSocials(validOptions())(baseConfig())
    const endpoints = result.endpoints ?? []
    expect(endpoints.length).toBeGreaterThan(0)
    expect(endpoints.some((e) => e.path.includes('/health'))).toBe(true)
  })

  it('retains a hidden, deny-all schema while omitting runtime wiring when disabled', async () => {
    const config = baseConfig()
    const result = payloadPluginSocials(validOptions({ disabled: true }))(config)
    expect(result).toBe(config)
    expect(slugsOf(result.collections ?? [])).toEqual(
      expect.arrayContaining([SOCIAL_POSTS_SLUG, SOCIAL_TEMPLATES_SLUG]),
    )
    expect(slugsOf(result.globals ?? [])).toContain(SOCIALS_CONNECTIONS_GLOBAL_SLUG)
    expect(result.endpoints).toHaveLength(0)

    const posts = result.collections?.find((entry) => entry.slug === SOCIAL_POSTS_SLUG)
    const templates = result.collections?.find((entry) => entry.slug === SOCIAL_TEMPLATES_SLUG)
    const connections = result.globals?.find(
      (entry) => entry.slug === SOCIALS_CONNECTIONS_GLOBAL_SLUG,
    )
    // A function (not `true`) so Payload's dashboard widget options match the enabled build.
    expect(typeof posts?.admin?.hidden).toBe('function')
    expect((posts?.admin?.hidden as () => boolean)()).toBe(true)
    expect(typeof templates?.admin?.hidden).toBe('function')
    expect((templates?.admin?.hidden as () => boolean)()).toBe(true)
    expect(templates?.hooks?.beforeChange).toBeUndefined()
    expect(connections?.admin?.hidden).toBe(true)
    expect(await posts?.access?.read?.({ req: { user: { id: 1 } } } as never)).toBe(false)
    expect(await connections?.access?.read?.({ req: { user: { id: 1 } } } as never)).toBe(false)
  })

  it('registers the same admin component paths and client config shape when disabled', () => {
    const configWithPages = (): Config =>
      ({
        collections: [{ slug: 'pages', fields: [] }],
        endpoints: [],
        globals: [],
      }) as unknown as Config
    const options = (overrides: Partial<PayloadPluginSocialsConfig> = {}) =>
      validOptions({
        admin: { injectInto: [{ collection: 'pages', sourceKind: 'product' }], mode: 'both' },
        ...overrides,
      })

    // Every component reference (path + exportName) anywhere in the config.
    const componentRefs = (value: unknown, found = new Set<string>()): string[] => {
      if (typeof value === 'string') {
        if (value.includes('@cargo/payload-plugin-socials')) {
          found.add(value)
        }
      } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record.path === 'string' && record.path.includes('@cargo/payload-plugin-socials')) {
          found.add(`${record.path}#${String(record.exportName)}`)
        }
        for (const child of Object.values(record)) {
          componentRefs(child, found)
        }
      }
      return [...found].sort()
    }

    const enabled = payloadPluginSocials(options())(configWithPages())
    const disabled = payloadPluginSocials(options({ disabled: true }))(configWithPages())

    const enabledRefs = componentRefs(enabled)
    expect(enabledRefs.length).toBeGreaterThanOrEqual(4)
    expect(componentRefs(disabled)).toEqual(enabledRefs)
    // Same admin config shape; only the flag differs.
    const socials = (config: Config) =>
      (config.admin?.custom as { socials: Record<string, unknown> }).socials
    expect(Object.keys(socials(disabled)).sort()).toEqual(Object.keys(socials(enabled)).sort())
    expect(socials(enabled).disabled).toBe(false)
    expect(socials(disabled).disabled).toBe(true)
    // Runtime stays off.
    expect(disabled.endpoints).toHaveLength(0)
  })

  describe('job tasks when disabled', () => {
    type TaskLike = {
      handler: (args: never) => Promise<unknown>
      schedule?: unknown
      slug: string
    }
    const tasksOf = (config: Config): TaskLike[] =>
      (config.jobs?.tasks ?? []) as unknown as TaskLike[]
    // Everything Payload derives types and schema from: the task minus handler/schedule.
    const definition = ({ handler: _handler, schedule: _schedule, ...rest }: TaskLike) => rest

    const enabled = tasksOf(
      payloadPluginSocials(
        validOptions({ scheduling: { autoRun: { cron: '*/5 * * * *' } } }),
      )(baseConfig()),
    )
    const disabledConfig = payloadPluginSocials(validOptions({ disabled: true }))(baseConfig())
    const disabled = tasksOf(disabledConfig)

    it('registers the same task slugs, schemas, retries and interface names as enabled', () => {
      expect(enabled.length).toBeGreaterThan(0)
      expect(disabled.map((t) => t.slug)).toEqual(enabled.map((t) => t.slug))
      expect(disabled.map(definition)).toEqual(enabled.map(definition))
      // The enabled config really carries a schedule, so the comparison above is not vacuous.
      expect(enabled.some((t) => t.schedule !== undefined)).toBe(true)
    })

    it('schedules nothing', () => {
      expect(disabled.every((t) => t.schedule === undefined)).toBe(true)
      expect((disabledConfig.jobs as { autoRun?: unknown }).autoRun).toBeUndefined()
    })

    it('fails fast without options, a key or a payload', async () => {
      for (const task of disabled) {
        // No registered plugin options and no `req`: the handler must not need either.
        // Thrown, not returned: Payload 4 logs a returned `{ state: 'failed' }` as succeeded.
        await expect(task.handler({ input: {} } as never)).rejects.toThrow('socials is disabled')
      }
    })

    it('registers no onInit that stashes plugin options', () => {
      expect(disabledConfig.onInit).toBeUndefined()
    })
  })

  it('rejects a second plugin instance instead of sharing process-level registries', () => {
    const config = baseConfig()
    payloadPluginSocials(validOptions())(config)
    expect(() => payloadPluginSocials(validOptions())(config)).toThrow(/only one plugin instance/)
  })
})

describe('payloadPluginSocials validation', () => {
  it('throws when authorize is missing', () => {
    expect(() =>
      payloadPluginSocials(validOptions({ authorize: undefined }))(baseConfig()),
    ).toThrow(/authorize/)
  })

  it('throws when sources is empty', () => {
    expect(() => payloadPluginSocials(validOptions({ sources: {} }))(baseConfig())).toThrow(
      /sources/,
    )
  })

  it('throws when encryptionKey is missing', () => {
    expect(() =>
      payloadPluginSocials(validOptions({ encryptionKey: undefined }))(baseConfig()),
    ).toThrow(/encryptionKey/)
  })

  it('throws when an enabled platform is missing credentials', () => {
    expect(() =>
      payloadPluginSocials(validOptions({ platforms: { pinterest: { enabled: true } } }))(
        baseConfig(),
      ),
    ).toThrow(/pinterest/)
  })
})
