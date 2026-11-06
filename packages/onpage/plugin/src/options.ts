import type { DocRef, EncodeFilter, SealSecret, SessionAdapter } from '@cargo/onpage-core'
import type { CollectionSlug, GlobalSlug, PayloadRequest } from 'payload'
import type { CommentsOptions } from './comments.ts'

export interface OnPageDocOptions {
  /** Top-level fields editable on the page. Default: every top-level field the user may update. */
  fields?: string[]
  /**
   * The site path that shows this document. Default for collections: the
   * collection's `admin.preview` URL, else `/${doc.slug}`. Globals: "/".
   */
  url?: (args: {
    doc: Record<string, unknown>
    locale?: string | undefined
    req: PayloadRequest
  }) => string | null | Promise<string | null>
  /**
   * Name of a top-level field: while the open document has a value in it, the
   * admin hides **Edit on page** for that document (Copy preview link stays).
   * For documents that are edited elsewhere, e.g. A/B variants marked by
   * `_abVariantOf`. Only the admin control is hidden; the endpoints still
   * apply the usual access checks.
   */
  hideEditWhen?: string
}

/**
 * Collections or globals to enable: a list of slugs, or slugs mapped to options.
 * Slugs are checked against your generated Payload types (`CollectionSlug` /
 * `GlobalSlug`), so a typo is a compile error.
 */
export type OnPageTargets<Slug extends string> =
  Slug[] | Partial<Record<Slug, OnPageDocOptions | true>>

export interface OnPageOptions {
  collections?: OnPageTargets<CollectionSlug>
  globals?: OnPageTargets<GlobalSlug>
  /**
   * Who may use on-page editing (`ref` undefined) and edit a given document.
   * Default: users of the admin user collection, with the document's own
   * `update` access (evaluated by Payload, including row-level rules).
   */
  access?: (args: { req: PayloadRequest; ref?: DocRef }) => boolean | Promise<boolean>
  /** Framework adapter that switches edit/preview mode (e.g. `tanstackSession()`). Required for the enter/mode/exit/preview endpoints. */
  session?: SessionAdapter
  /** Narrow which strings get auto-mapping markers. */
  encode?: EncodeFilter
  /** Lifetime of shareable preview links, in seconds. Default 1 day. */
  previewLinkTTL?: number
  /** Extra check when a preview link is opened (e.g. a revocation list). Return false to refuse it. */
  validatePreviewLink?: (args: {
    req: PayloadRequest
    ref: DocRef
    path: string
    issuedAt: number
    id: string
  }) => boolean | Promise<boolean>
  /**
   * Secret for preview links, the preview cookie and the editor's mode cookie.
   * Default: Payload's `secret` (`PAYLOAD_SECRET`). The Next.js proxy (or
   * `tanstackSession`) must be given the same value. To rotate it, pass
   * `[newSecret, oldSecret]` here and there: the first seals, either unseals,
   * so open links and sessions keep working until they expire.
   */
  secret?: SealSecret
  /** Auth cookie an editor's session is bound to. Default `${cookiePrefix}-token` ("payload-token"). */
  authCookie?: string
  /** Endpoint prefix under the API route. Default "/onpage". */
  routePrefix?: `/${string}`
  /**
   * Comments on pages, and review requests, stored in an `onpage-comments`
   * collection (adds it to your config: generate a migration). With
   * `{ guests: true }`, share-link viewers can comment on the page they were
   * sent, too. Default off.
   */
  comments?: boolean | CommentsOptions | undefined
  /**
   * Called when an editor asks for a review of a page (needs `comments`):
   * notify your reviewers (email, Slack…). `url` is a fresh share link to the
   * page; the request is also kept as a comment.
   */
  /**
   * Saved sections: editors save a section's content under a name and insert it
   * again from the block picker. Stored in an `onpage-patterns` collection
   * (adds it to your config: generate a migration). Default off.
   */
  patterns?: boolean | undefined
  onReviewRequest?:
    | ((args: {
        req: PayloadRequest
        ref: DocRef
        note: string
        url: string
        expiresAt: string
      }) => void | Promise<void>)
    | undefined
  enabled?: boolean
}

/** One enabled collection or global, with its slug typed by kind. */
export type Entry =
  | { kind: 'collection'; slug: CollectionSlug; options: OnPageDocOptions }
  | { kind: 'global'; slug: GlobalSlug; options: OnPageDocOptions }

function entriesOf<Slug extends string>(input: OnPageTargets<Slug> | undefined) {
  return Array.isArray(input)
    ? input.map((slug) => ({ slug, options: {} }))
    : (Object.entries(input ?? {}) as Array<[Slug, OnPageDocOptions | true | undefined]>)
        .filter(([, o]) => o !== undefined)
        .map(([slug, o]) => ({ slug, options: o === true || !o ? {} : o }))
}

export const normalizeEntries = (options: OnPageOptions): Entry[] => [
  ...entriesOf(options.collections).map((e) => ({ kind: 'collection' as const, ...e })),
  ...entriesOf(options.globals).map((e) => ({ kind: 'global' as const, ...e })),
]
