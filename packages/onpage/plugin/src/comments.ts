/**
 * Comments on pages, and review requests (opt-in: the `comments` option).
 * Stored in a collection of their own, so they show in the admin too.
 *
 * Who may write: editors of the document; with `comments.guests`, also
 * share-link viewers, but only on the document their sealed grant covers, with
 * short text and a cap per link. Nobody but editors reads them.
 */
import {
  COOKIE,
  isLivePreviewGrant,
  SEAL_PURPOSE,
  unseal,
  type DocRef,
  type PreviewGrant,
  type SealSecret,
} from '@cargo/onpage-core'
import type { CollectionConfig, PayloadRequest, Where } from 'payload'

export const COMMENTS = 'onpage-comments'

export const LIMITS = { body: 2000, quote: 500, name: 80, perLinkPerHour: 20 } as const

export interface CommentsOptions {
  /** Let share-link viewers comment too (name required; limited per link). Default false. */
  guests?: boolean
}

/** The comments collection: editors (the admin user collection) read and manage it. */
export function commentsCollection(collections: string[], adminUser: string): CollectionConfig {
  const isEditor = ({ req }: { req: PayloadRequest }) => req.user?.collection === adminUser
  return {
    slug: COMMENTS,
    labels: { singular: 'Page comment', plural: 'Page comments' },
    admin: {
      useAsTitle: 'body',
      group: 'On-page',
      defaultColumns: ['body', 'doc', 'author', 'guestName', 'resolved', 'createdAt'],
    },
    access: { read: isEditor, create: isEditor, update: isEditor, delete: isEditor },
    timestamps: true,
    fields: [
      ...(collections.length
        ? [
            {
              name: 'doc',
              type: 'relationship' as const,
              relationTo: collections,
              index: true,
            },
          ]
        : []),
      { name: 'global', type: 'text', index: true },
      { name: 'path', type: 'text', admin: { description: 'Field the comment is about.' } },
      { name: 'quote', type: 'textarea', maxLength: LIMITS.quote },
      { name: 'body', type: 'textarea', required: true, maxLength: LIMITS.body },
      {
        name: 'kind',
        type: 'select',
        defaultValue: 'comment',
        options: [
          { label: 'Comment', value: 'comment' },
          { label: 'Review request', value: 'review' },
        ],
      },
      { name: 'author', type: 'relationship', relationTo: adminUser },
      { name: 'guestName', type: 'text', maxLength: LIMITS.name },
      // The share link a guest commented through (its id), for the per-link cap.
      { name: 'link', type: 'text', index: true, admin: { hidden: true } },
      { name: 'resolved', type: 'checkbox', defaultValue: false, index: true },
    ],
  }
}

/** The comments of one document. */
export const commentsWhere = (ref: DocRef): Where =>
  ref.kind === 'global'
    ? { global: { equals: ref.slug } }
    : {
        and: [{ 'doc.relationTo': { equals: ref.slug } }, { 'doc.value': { equals: ref.id } }],
      }

export const commentTarget = (ref: DocRef) =>
  ref.kind === 'global' ? { global: ref.slug } : { doc: { relationTo: ref.slug, value: ref.id } }

/** The share-link grant this request carries, if it's live. */
export async function guestGrant(
  req: PayloadRequest,
  secret: SealSecret,
): Promise<PreviewGrant | null> {
  const cookie = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE.preview}=`))
    ?.slice(COOKIE.preview.length + 1)
  const grant = await unseal(cookie, secret, SEAL_PURPOSE.previewCookie)
  return isLivePreviewGrant(grant) ? grant : null
}

/** Trimmed text within `max` characters, or null when empty or too long. */
export const boundedText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= max ? text : null
}
