/**
 * @cargo/onpage-plugin — the Payload side of payload-onpage.
 *
 *   plugins: [onpage({ collections: ['pages'], globals: ['header'], session: tanstackSession({ secret }) })]
 *
 * Adds the endpoints in ./endpoints, auto-mapping on reads that ask for it,
 * marker stripping and a stale-write guard on every write, and "Edit on page" /
 * "Copy preview link" controls in the admin. Saves from the editor go through
 * Payload's REST API, so access control, hooks, validation, drafts and versions
 * apply unchanged.
 */
import { DEFAULTS, type DocRef, type SchemaField } from '@cargo/onpage-core'
import {
  InvalidConfiguration,
  type CollectionConfig,
  type Config,
  type GlobalConfig,
} from 'payload'
import { deepMergeSimple, hasDraftsEnabled } from 'payload/shared'
import { COMMENTS, commentsCollection } from './comments.ts'
import { createEndpoints } from './endpoints.ts'
import { PATTERNS, patternsCollection } from './patterns.ts'
import { encodeOnRead, guardStaleWrite, stripMarkers } from './hooks.ts'
import { normalizeEntries, type Entry, type OnPageOptions } from './options.ts'
import { serializeFields } from './schema.ts'
import { translations } from './translations.ts'

const APPLIED = 'payload-onpage'

/**
 * What `onpage()` returns: a Payload plugin function, typed to accept any
 * Payload major's config. Payload v3 and v4 configs differ structurally, but
 * what `onpage()` reads and adds (collections, globals, endpoints, hooks,
 * admin components, translations) is stable across both, and the function is
 * opaque to callers — sites just list it in `plugins`.
 */
export type OnPagePlugin = <C>(config: C) => C

export function onpage(options: OnPageOptions): OnPagePlugin {
  const apply = (incoming: Config): Config => {
    if (options.enabled === false || incoming.custom?.[APPLIED]) return incoming
    const { session } = options
    if (!session)
      throw new InvalidConfiguration(
        'payload-onpage: pass `session` (e.g. tanstackSession() from @cargo/onpage-tanstack-start/session). The enter, mode, exit and preview endpoints need it.',
      )
    const secrets =
      options.secret === undefined || typeof options.secret === 'string'
        ? [options.secret]
        : options.secret
    if (options.secret !== undefined && (!secrets.length || secrets.some((s) => !s)))
      throw new InvalidConfiguration(
        "payload-onpage: `secret` must not be empty. Omit it to use Payload's `secret`.",
      )
    const prefix = options.routePrefix ?? DEFAULTS.routePrefix
    const entries = normalizeEntries(options)
    const keyOf = (kind: DocRef['kind'], slug: string) => `${kind}:${slug}`
    const byKey = new Map(entries.map((e) => [keyOf(e.kind, e.slug), e]))

    const missing = entries.filter((e) =>
      e.kind === 'global'
        ? !incoming.globals?.some((g) => g.slug === e.slug)
        : !incoming.collections?.some((c) => c.slug === e.slug),
    )
    if (missing.length) {
      throw new InvalidConfiguration(
        `payload-onpage: unknown ${missing.map((e) => `${e.kind} "${e.slug}"`).join(', ')}`,
      )
    }

    /**
     * The hooks every enabled document gets (see ./hooks). Markers are stripped
     * before the site's own hooks run, so those never see them; the stale-write
     * guard runs last. Encoding serializes the fields once, lazily.
     */
    const hooksFor = (cfg: CollectionConfig | GlobalConfig, entry: Entry) => {
      let fields: SchemaField[] | undefined
      return {
        beforeValidate: [stripMarkers],
        beforeChange: [stripMarkers],
        lastBeforeChange: [guardStaleWrite],
        afterRead: [
          encodeOnRead({
            kind: entry.kind,
            slug: cfg.slug,
            fields: () => (fields ??= serializeFields(cfg.fields, { blocks: incoming.blocks })),
            ...(entry.options.fields ? { only: entry.options.fields } : {}),
            ...(options.encode ? { filter: options.encode } : {}),
          }),
        ],
      }
    }
    const withCollectionHooks = (c: CollectionConfig, entry: Entry): CollectionConfig => {
      const add = hooksFor(c, entry)
      return {
        ...c,
        hooks: {
          ...c.hooks,
          beforeValidate: [...add.beforeValidate, ...(c.hooks?.beforeValidate ?? [])],
          beforeChange: [
            ...add.beforeChange,
            ...(c.hooks?.beforeChange ?? []),
            ...add.lastBeforeChange,
          ],
          afterRead: [...(c.hooks?.afterRead ?? []), ...add.afterRead],
        },
      }
    }
    const withGlobalHooks = (g: GlobalConfig, entry: Entry): GlobalConfig => {
      const add = hooksFor(g, entry)
      return {
        ...g,
        hooks: {
          ...g.hooks,
          beforeValidate: [...add.beforeValidate, ...(g.hooks?.beforeValidate ?? [])],
          beforeChange: [
            ...add.beforeChange,
            ...(g.hooks?.beforeChange ?? []),
            ...add.lastBeforeChange,
          ],
          afterRead: [...(g.hooks?.afterRead ?? []), ...add.afterRead],
        },
      }
    }

    const control = (kind: DocRef['kind'], slug: string, entry: Entry) => ({
      path: '@cargo/onpage-plugin/admin#OnPageAdminControls',
      clientProps: {
        kind,
        slug,
        prefix,
        ...(entry.options.hideEditWhen ? { hideEditWhen: entry.options.hideEditWhen } : {}),
      },
    })

    const withCollectionAdmin = (c: CollectionConfig, entry: Entry): CollectionConfig => {
      const edit = c.admin?.components?.edit ?? {}
      return {
        ...c,
        admin: {
          ...c.admin,
          components: {
            ...c.admin?.components,
            edit: {
              ...edit,
              beforeDocumentControls: [
                ...(edit.beforeDocumentControls ?? []),
                control('collection', c.slug, entry),
              ],
            },
          },
        },
      }
    }
    const withGlobalAdmin = (g: GlobalConfig, entry: Entry): GlobalConfig => {
      const edit = g.admin?.components?.edit ?? {}
      return {
        ...g,
        admin: {
          ...g.admin,
          components: {
            ...g.admin?.components,
            edit: {
              ...edit,
              beforeDocumentControls: [
                ...(edit.beforeDocumentControls ?? []),
                control('global', g.slug, entry),
              ],
            },
          },
        },
      }
    }

    return {
      ...incoming,
      custom: { ...incoming.custom, [APPLIED]: true },
      i18n: {
        ...incoming.i18n,
        // Ours first; the site's own translations (any language, any key) win.
        translations: deepMergeSimple(translations, incoming.i18n?.translations ?? {}),
      },
      collections: [
        ...(incoming.collections ?? []).map((c) => {
          const entry = byKey.get(keyOf('collection', c.slug))
          return entry ? withCollectionAdmin(withCollectionHooks(c, entry), entry) : c
        }),
        ...(options.patterns && !incoming.collections?.some((c) => c.slug === PATTERNS)
          ? [patternsCollection(incoming.admin?.user ?? 'users')]
          : []),
        ...(options.comments && !incoming.collections?.some((c) => c.slug === COMMENTS)
          ? [
              commentsCollection(
                entries.filter((e) => e.kind === 'collection').map((e) => e.slug),
                incoming.admin?.user ?? 'users',
              ),
            ]
          : []),
      ],
      globals: (incoming.globals ?? []).map((g) => {
        const entry = byKey.get(keyOf('global', g.slug))
        return entry ? withGlobalAdmin(withGlobalHooks(g, entry), entry) : g
      }),
      endpoints: [
        ...(incoming.endpoints ?? []),
        ...createEndpoints({
          options: { ...options, session },
          prefix,
          entry: (kind, slug) => byKey.get(keyOf(kind, slug)),
          entries,
        }),
      ],
      onInit: async (payload) => {
        if (process.env.NODE_ENV === 'production' && !payload.config.serverURL) {
          payload.logger.warn(
            'payload-onpage: set `serverURL` in production so redirects, preview links and Secure cookies use the public origin.',
          )
        }
        // Without drafts, every autosave is a live write: say so once, at startup.
        const live = entries
          .filter((e) => {
            const cfg =
              e.kind === 'global'
                ? payload.config.globals.find((g) => g.slug === e.slug)
                : payload.config.collections.find((c) => c.slug === e.slug)
            return cfg && !hasDraftsEnabled(cfg)
          })
          .map((e) => `${e.kind} "${e.slug}"`)
        if (live.length) {
          payload.logger.warn(
            `payload-onpage: ${live.join(', ')} ${live.length > 1 ? 'have' : 'has'} no drafts, so on-page edits to ${live.length > 1 ? 'them' : 'it'} go live as they autosave. Add \`versions: { drafts: true }\` to keep edits as drafts until published.`,
          )
        }
        await incoming.onInit?.(payload)
      },
    }
  }
  return apply as OnPagePlugin
}

export type { OnPageDocOptions, OnPageOptions, OnPageTargets } from './options.ts'
export { canEditDocument, canUseOnPage } from './access.ts'
export { createPreviewToken, verifyPreviewToken, type PreviewTokenPayload } from './tokens.ts'
export { serializeFields, type SerializeContext } from './schema.ts'
export { wantsMarkers } from './hooks.ts'
export { translations } from './translations.ts'
