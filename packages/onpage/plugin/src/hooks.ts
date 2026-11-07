/**
 * Collection/global hooks added by the plugin:
 *  - afterRead: auto-mapping markers, only on reads that ask (`context.onpage`)
 *  - beforeValidate/beforeChange: strip markers from every write, so they can't be stored
 *  - beforeChange: stale-write guard (409) when the editor sends the version it last saw
 */
import {
  CONTEXT_KEY,
  encodeDocument,
  HEADER,
  refKey,
  stegaCleanDeep,
  type DocRef,
  type EncodeFilter,
  type SchemaField,
} from '@shipment/onpage-core'
import { APIError, type PayloadRequest, type RequestContext } from 'payload'

declare module 'payload' {
  interface RequestContext {
    /** Set by `onpageContext()`: this read should carry auto-mapping markers. */
    [CONTEXT_KEY]?: boolean
  }
}

/** True when a read asked for auto-mapping markers (see `onpageContext()`). */
export const wantsMarkers = (context: RequestContext | undefined): boolean =>
  context?.[CONTEXT_KEY] === true

export const stripMarkers = ({ data }: { data?: unknown }) => (data ? stegaCleanDeep(data) : data)

export function encodeOnRead(opts: {
  kind: DocRef['kind']
  slug: string
  fields: () => SchemaField[]
  only?: string[]
  filter?: EncodeFilter
}) {
  return ({
    doc,
    req,
    context,
  }: {
    doc: Record<string, unknown>
    req: PayloadRequest
    context: RequestContext
  }) => {
    if (!wantsMarkers(context) || req.locale === 'all' || !doc) return doc
    const ref =
      opts.kind === 'global'
        ? refKey({ kind: 'global', slug: opts.slug })
        : doc.id != null
          ? refKey({ kind: 'collection', slug: opts.slug, id: doc.id as string | number })
          : null
    return ref
      ? encodeDocument(doc, opts.fields(), ref, { only: opts.only, filter: opts.filter })
      : doc
  }
}

/**
 * Optimistic concurrency: the editor sends `x-onpage-if-unmodified-since` with
 * the `updatedAt` it last saw; if the document changed since, the write fails
 * with 409 and the editor offers to reload. Writes without the header (admin,
 * API, other tools) are untouched.
 */
export const guardStaleWrite = <T>({
  data,
  req,
  originalDoc,
}: {
  data: T
  req: PayloadRequest
  originalDoc?: { updatedAt?: unknown }
}): T => {
  const seen = req.headers?.get(HEADER.ifUnmodifiedSince)
  const current = originalDoc?.updatedAt
  if (!seen || typeof current !== 'string') return data
  if (new Date(seen).getTime() !== new Date(current).getTime()) {
    throw new APIError(
      'This document was changed by someone else since you loaded it.',
      409,
      undefined,
      true,
    )
  }
  return data
}
