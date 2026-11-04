/**
 * Payload's document locks (`lockDocuments`, the `payload-locked-documents`
 * collection) for the on-page editor: the same records the admin reads, so an
 * admin user sees that someone is editing on the page, and the other way round.
 */
import type { DocRef } from '@cargo/onpage-core'
import type { CollectionConfig, GlobalConfig, PayloadRequest, Where } from 'payload'

const LOCKS = 'payload-locked-documents'
const DEFAULT_DURATION = 300

type Config = CollectionConfig | GlobalConfig

const durationOf = (cfg: Config): number => {
  const l = cfg.lockDocuments
  return typeof l === 'object' && typeof l.duration === 'number' ? l.duration : DEFAULT_DURATION
}

/** Locking applies: the locks collection exists and the document doesn't opt out. */
export const locksEnabled = (req: PayloadRequest, cfg: Config) =>
  !!req.payload.collections[LOCKS] && cfg.lockDocuments !== false

const whereFor = (ref: DocRef): Where =>
  ref.kind === 'global'
    ? { globalSlug: { equals: ref.slug } }
    : {
        and: [
          { 'document.relationTo': { equals: ref.slug } },
          { 'document.value': { equals: ref.id } },
        ],
      }

/** A user's display name, as the admin shows it: their title field, else email. */
function nameOf(req: PayloadRequest, holder: unknown): string {
  const rel = holder as { relationTo?: string; value?: Record<string, unknown> } | undefined
  const user = rel?.value
  if (!user || typeof user !== 'object') return '?'
  const titleField = rel.relationTo
    ? req.payload.collections[rel.relationTo]?.config.admin?.useAsTitle
    : undefined
  const title = titleField ? user[titleField] : undefined
  if (typeof title === 'string' && title) return title
  if (typeof user.email === 'string') return user.email
  return typeof user.id === 'string' || typeof user.id === 'number' ? String(user.id) : '?'
}

/**
 * Take, refresh or release the lock for the signed-in user. Returns who else
 * holds a live lock (nothing is taken then), or null.
 */
export async function applyLock(
  req: PayloadRequest,
  ref: DocRef,
  cfg: Config,
  action: 'take' | 'release',
): Promise<{ lockedBy: string | null }> {
  const user = req.user
  if (!user || !locksEnabled(req, cfg)) return { lockedBy: null }
  const { docs } = await req.payload.find({
    collection: LOCKS,
    where: whereFor(ref),
    sort: '-updatedAt',
    limit: 1,
    depth: 1,
    overrideAccess: true,
    req,
  })
  const current = docs[0] as
    | { id: string | number; updatedAt?: string; user?: { relationTo?: string; value?: unknown } }
    | undefined
  const holderId =
    current?.user?.value && typeof current.user.value === 'object'
      ? (current.user.value as { id?: unknown }).id
      : current?.user?.value
  const mine = !!current && current.user?.relationTo === user.collection && holderId === user.id
  const live =
    !!current?.updatedAt &&
    Date.now() - new Date(current.updatedAt).getTime() <= durationOf(cfg) * 1000

  if (current && live && !mine) return { lockedBy: nameOf(req, current.user) }
  if (action === 'release') {
    if (current && mine)
      await req.payload.delete({ collection: LOCKS, id: current.id, overrideAccess: true, req })
    return { lockedBy: null }
  }
  const data = {
    ...(ref.kind === 'global'
      ? { globalSlug: ref.slug }
      : { document: { relationTo: ref.slug, value: ref.id } }),
    user: { relationTo: user.collection, value: user.id },
  }
  if (current)
    await req.payload.update({ collection: LOCKS, id: current.id, data, overrideAccess: true, req })
  else await req.payload.create({ collection: LOCKS, data, overrideAccess: true, req })
  return { lockedBy: null }
}
