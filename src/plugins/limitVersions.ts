import type { Plugin } from 'payload'

/**
 * Caps stored versions on every versioned collection and global that doesn't set its own
 * limit. Payload keeps 100 per document by default, and on D1 (10 GB per database) the
 * versions tables are usually the first thing to grow out of control.
 *
 * Register it after any plugin that adds collections so those are covered too.
 */
export const limitVersions =
  ({ max }: { max: number }): Plugin =>
  (config) => ({
    ...config,
    collections: config.collections?.map((collection) => {
      const { versions } = collection
      if (!versions || (typeof versions === 'object' && versions.maxPerDoc !== undefined)) {
        return collection
      }
      return {
        ...collection,
        versions: { ...(typeof versions === 'object' ? versions : {}), maxPerDoc: max },
      }
    }),
    globals: config.globals?.map((global) => {
      const { versions } = global
      if (!versions || (typeof versions === 'object' && versions.max !== undefined)) {
        return global
      }
      return {
        ...global,
        versions: { ...(typeof versions === 'object' ? versions : {}), max },
      }
    }),
  })
