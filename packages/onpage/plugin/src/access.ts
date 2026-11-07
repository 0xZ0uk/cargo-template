/**
 * Who may use on-page editing, and edit which documents. Document access is
 * evaluated by Payload itself (`docAccessOperation`), so row-level rules
 * (access functions that return a query) and field permissions behave exactly
 * as in the admin.
 */
import type { DocRef } from '@shipment/onpage-core'
import {
  docAccessOperation,
  docAccessOperationGlobal,
  type PayloadRequest,
  type SanitizedCollectionPermission,
  type SanitizedGlobalPermission,
} from 'payload'
import { entityConfig } from './http.ts'
import type { OnPageOptions } from './options.ts'

/** Signed in as an admin user (or allowed by the `access` option). */
export async function canUseOnPage(req: PayloadRequest, options: OnPageOptions): Promise<boolean> {
  if (!req.user) return false
  if (options.access) return Boolean(await options.access({ req }))
  return req.user.collection === req.payload.config.admin.user
}

/** Payload's sanitized permissions for one document (or the collection, without an id). */
export async function documentPermissions(
  req: PayloadRequest,
  ref: { kind: DocRef['kind']; slug: string; id?: string | number | undefined },
  /** The data an update would write, for access rules that look at it (`_status: 'published'`). */
  data?: Record<string, unknown>,
): Promise<SanitizedCollectionPermission | SanitizedGlobalPermission | null> {
  try {
    if (ref.kind === 'global') {
      const globalConfig = entityConfig(req, 'global', ref.slug)
      return globalConfig
        ? await docAccessOperationGlobal({ globalConfig, req, ...(data ? { data } : {}) })
        : null
    }
    const collection = req.payload.collections[ref.slug]
    if (!collection) return null
    return await docAccessOperation({
      collection,
      ...(ref.id !== undefined ? { id: ref.id } : {}),
      ...(data ? { data } : {}),
      req,
    })
  } catch (err) {
    // An access function that throws denies, as in Payload, but shouldn't fail silently.
    req.payload.logger.error({
      err,
      msg: `payload-onpage: access check failed for ${ref.kind} "${ref.slug}"`,
    })
    return null
  }
}

/**
 * Collection/global-level update access that is not granted. Payload's
 * sanitizer deletes denied operations, so denial usually manifests as a
 * missing `update` key — not `false`. Only the positive shapes allow:
 * boolean `true`, or `{ permission: true }` (including row-level rules that
 * carry a `where` and need a document to evaluate). Anything else — missing,
 * `false`, `{ permission: false }`, an unknown shape, or no permissions at
 * all (an access check threw) — denies, so callers fail closed and per-document
 * checks decide the rest.
 */
export function isUpdateDenied(
  perms: SanitizedCollectionPermission | SanitizedGlobalPermission | null,
): boolean {
  if (!perms) return true
  const update: unknown = perms.update
  if (update === true) return false
  return !(
    typeof update === 'object' &&
    update !== null &&
    'permission' in update &&
    update.permission === true
  )
}

/**
 * May this user edit this document on the page? With an id, Payload evaluates a
 * row-level rule (a `where`) against that document itself, so its answer is final.
 */
export async function canEditDocument(
  req: PayloadRequest,
  ref: DocRef,
  options: OnPageOptions,
): Promise<boolean> {
  if (!req.user) return false
  if (options.access) return Boolean(await options.access({ req, ref }))
  if (!(await canUseOnPage(req, options))) return false
  const update: unknown = (await documentPermissions(req, ref))?.update
  return (
    update === true ||
    (typeof update === 'object' &&
      update !== null &&
      'permission' in update &&
      update.permission === true)
  )
}

/**
 * May this user publish this document? As Payload's own scheduler checks it:
 * update access for data that sets `_status: 'published'`.
 */
export async function canPublishDocument(
  req: PayloadRequest,
  ref: DocRef,
  options: OnPageOptions,
): Promise<boolean> {
  if (!(await canEditDocument(req, ref, options))) return false
  if (options.access) return true // the site's own rule decides, as for editing
  const update: unknown = (await documentPermissions(req, ref, { _status: 'published' }))?.update
  return (
    update === true ||
    (typeof update === 'object' &&
      update !== null &&
      'permission' in update &&
      update.permission === true)
  )
}
