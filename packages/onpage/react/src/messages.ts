/**
 * Every string the editor shows, with English defaults. Override any subset
 * with the `messages` prop (e.g. from your site's translations), and pass
 * `uiLocale` with them. `{name}` placeholders are filled from the variables
 * passed to `t()`. A message with `{count}` can have plural forms keyed by
 * `Intl.PluralRules` category: `'dock.documents.one': '{count} document'`.
 */
export const defaultMessages = {
  'dock.label': 'Page editor',
  'dock.loading': 'Loading editor…',
  'dock.unavailable': '{doc}: {error}',
  'dock.saveFailed': '{doc}: {message}',
  'dock.nothing': 'Nothing editable on this page',
  'dock.conflict': '{doc}: changed by someone else',
  'dock.lockedBy': '{name} is editing this {doc}',
  'dock.live': '{doc}: changes go live',
  'dock.liveHint':
    'This has no drafts in Payload, so each change is published as soon as it saves.',
  'dock.lockedHint':
    'Your changes can’t be saved until they leave it, or their lock expires (5 minutes without activity).',
  'dock.saving': 'Saving draft…',
  'dock.updating': 'Updating page…',
  'dock.saved': 'Draft saved {ago}',
  'dock.editing': 'Editing draft',
  'dock.documents': '{count} documents',
  'dock.documents.one': '{count} document',
  'dock.localeNotice':
    'Editing {locale}: text changes apply to this language only; adding, moving or removing sections changes every language.',
  'dock.reload': 'Reload latest',
  'dock.keepMine': 'Keep my changes',
  'dock.keepMineHint': 'Load their version and re-apply your edits on top of it',
  'dock.retry': 'Retry',
  'dock.undo': 'Undo',
  'dock.redo': 'Redo',
  'dock.pageSettings': 'Page settings',
  'dock.pageSettingsHint': 'SEO, dates and other fields that aren’t on the page',
  'dock.comments': 'Comments',
  'dock.commentsCount': 'Comments ({count})',
  'dock.commentsHint': 'Comments on this page, and review requests',
  'dock.cantPublish': 'You can’t publish this. Ask for a review in Comments.',
  'dock.history': 'History',
  'dock.historyHint': 'Saved versions, and what changed since published',
  'dock.preview': 'Preview',
  'dock.previewHint': 'See the draft without editing tools',
  'dock.share': 'Share',
  'dock.shareHint': 'Copy a read-only link to this draft',
  'dock.discard': 'Discard',
  'dock.discardConfirm': 'Confirm discard?',
  'dock.discardHint': 'Throw away draft changes and return to the published content',
  'dock.admin': 'Admin',
  'dock.exit': 'Exit',
  'dock.publish': 'Publish',
  'dock.publishMore': 'More publish options',
  'comments.title': 'Comments',
  'comments.new': 'New comment',
  'comments.aboutSelected': 'About the selected {label}',
  'comments.add': 'Comment',
  'comments.empty': 'No comments yet.',
  'comments.someone': 'Someone',
  'comments.guest': 'via share link',
  'comments.review': 'review request',
  'comments.resolve': 'Resolve',
  'comments.reopen': 'Reopen',
  'comments.reviewTitle': 'Ask for a review',
  'comments.reviewPlaceholder': 'What should reviewers look at? (optional)',
  'comments.reviewHint': 'Your reviewers get a link to this page’s draft.',
  'comments.reviewButton': 'Request review',
  'versions.title': 'History',
  'versions.document': 'Document',
  'versions.highlight': 'Outline what changed since published',
  'versions.changes': '{count} changes',
  'versions.changes.one': '{count} change',
  'versions.empty': 'No saved versions yet.',
  'versions.current': 'current',
  'versions.published': 'published',
  'versions.draft': 'draft',
  'versions.restore': 'Restore',
  'versions.restoreConfirm': 'Restore as draft?',
  'publish.title': 'Publish',
  'publish.which': 'Documents on this page',
  'publish.upToDate': 'published',
  'publish.now': 'Publish selected',
  'publish.schedule': 'Schedule for later',
  'publish.scheduleButton': 'Schedule',
  'publish.scheduleHint':
    'Publishes the latest saved draft at that time. Payload’s job queue must be running (jobs.autoRun or a cron).',
  'dock.publishing': 'Publishing…',
  'notify.published': 'Published ✓',
  'notify.sectionSaved': 'Saved: you’ll find it under Saved sections',
  'notify.pageCreated': 'Page created: opening it…',
  'notify.commented': 'Comment added',
  'notify.resolved': 'Comment resolved',
  'notify.reopened': 'Comment reopened',
  'notify.reviewRequested': 'Review requested: your reviewers have a link to the page',
  'notify.restored': 'Restored the version from {date} as the draft',
  'notify.merged': 'Your changes were re-applied on the latest version',
  'notify.scheduled': 'Scheduled to publish {date}',
  'notify.scheduleFailed': 'Couldn’t schedule: {message}',
  'notify.nothingToPublish': 'Nothing to publish',
  'notify.publishFailed': 'Publish failed: {message}',
  'notify.discarded': 'Draft reset to the published version',
  'notify.linkCopied': 'Preview link copied — valid until {date}',
  'notify.linkFailed': "Couldn't create a preview link: {message}",
  'notify.loading': 'Loading the editor…',
  'notify.cantEdit': "Can't edit: {message}",
  'row.drag': 'Drag to move',
  'row.moveUp': 'Move up',
  'row.moveDown': 'Move down',
  'row.duplicate': 'Duplicate',
  'row.settings': 'Settings',
  'row.saveSection': 'Save this section to reuse it',
  'row.delete': 'Delete (undo with {undo})',
  'row.addSection': 'Add section',
  'row.addSectionAbove': 'Add section above',
  'row.addSectionBelow': 'Add section below',
  'row.addFirstSection': 'Add a section',
  'row.addItem': 'Add {item}',
  'row.toolbar': '{label} actions',
  'settings.title': '{label} settings',
  'settings.page': 'Page settings',
  'pages.title': 'This page',
  'pages.duplicate': 'Duplicate this page',
  'pages.new': 'New page',
  'pages.newTitle': 'Title',
  'pages.create': 'Create',
  'pages.noPath': 'The new page has no address to open: find it in the admin',
  'pages.hint': 'New pages start as drafts, at an address made from the title.',
  'saveSection.title': 'Save section',
  'saveSection.name': 'Name',
  'saveSection.save': 'Save',
  'settings.close': 'Close settings',
  'settings.chooseImage': 'Choose image…',
  'settings.changeImage': 'Change image…',
  'blocks.title': 'Add section',
  'blocks.saved': 'Saved sections',
  'blocks.previewHint': 'Point at a section to preview it on the page.',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.apply': 'Apply',
  'common.clear': 'Clear',
  'common.remove': 'Remove',
  'common.removeItem': 'Remove {item}',
  'common.none': '—',
  'common.selected': '{count} selected',
  'search.placeholder': 'Search…',
  'search.unsupported': "This data source can't search documents.",
  'media.search': 'Search images…',
  'media.upload': 'Upload…',
  'media.empty': 'No images found.',
  'media.more': 'Load more',
  'media.loading': 'Loading…',
  'media.alt': 'Alt text',
  'media.altHint':
    'Describe the image for people who can’t see it. Leave it empty only if the image is decorative.',
  'media.altSave': 'Save alt text',
  'media.uploadFile': 'Upload {name}',
  'inline.label': 'Edit {field}',
  'preview.label': 'Draft preview',
  'guest.open': 'Comment',
  'guest.another': 'Comment again',
  'guest.title': 'Comment on this draft',
  'guest.name': 'Your name',
  'guest.comment': 'Comment',
  'guest.send': 'Send',
  'guest.sent': 'Thanks, your comment was sent',
  'preview.badge': 'Draft',
  'preview.shared': 'Shared preview — not published yet',
  'preview.own': 'Previewing the draft',
  'preview.phone': 'Phone',
  'preview.tablet': 'Tablet',
  'preview.desktop': 'Desktop',
  'preview.edit': 'Edit',
  'preview.exit': 'Exit',
  'preview.viewPublished': 'View published',
  'rt.toolbar': 'Text formatting',
  'rt.bold': 'Bold',
  'rt.italic': 'Italic',
  'rt.underline': 'Underline',
  'rt.link': 'Link',
  'rt.linkApply': 'Apply',
  'rt.h2': 'Heading 2',
  'rt.h3': 'Heading 3',
  'rt.ul': 'Bulleted list',
  'rt.ol': 'Numbered list',
  'rt.quote': 'Quote',
  'rt.done': 'Done',
  'rt.linkPlaceholder': 'https://… or /page (empty removes the link)',
  'rt.linkInvalid': 'Use an https://, mailto:, tel: or relative link',
  'rt.linkUrl': 'Web address',
  'rt.linkPage': 'Page',
  'rt.linkSearch': 'Search pages…',
  'rt.linkCollection': 'Collection',
  'assist.label': 'Writing assistant',
  'assist.shorter': 'Shorter',
  'assist.clearer': 'Clearer',
  'assist.friendlier': 'Friendlier',
  'assist.fix': 'Fix spelling',
  'assist.custom': 'Or say what to change…',
  'assist.ask': 'Ask',
  'assist.working': 'Writing…',
  'assist.hint': 'The answer replaces the text: Enter keeps it, Escape drops it.',
} as const

export type MessageKey = keyof typeof defaultMessages

/** Messages with a `{count}`: they may have plural forms. */
type CountKey = {
  [K in MessageKey]: 'count' extends Placeholders<(typeof defaultMessages)[K]> ? K : never
}[MessageKey]

/** Overrides for any message, and plural forms (`'dock.documents.few'`) for counted ones. */
export type Messages = Partial<Record<MessageKey | `${CountKey}.${Intl.LDMLPluralRule}`, string>>

/** The {placeholders} of a message: `Placeholders<'Saved {when}'>` is `'when'`. */
export type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never

/** The variables a message needs, by key. */
export type MessageVars<K extends MessageKey> = Record<
  Placeholders<(typeof defaultMessages)[K]>,
  string | number
>

/**
 * Translate a message key. A message with placeholders requires exactly those
 * variables (`t('dock.saved', { ago })`); one without takes none. Unknown keys
 * don't compile: show raw text without `t`.
 */
export type Translate = (<K extends MessageKey>(
  key: K,
  ...vars: [Placeholders<(typeof defaultMessages)[K]>] extends [never] ? [] : [vars: MessageVars<K>]
) => string) & {
  /** The language of the UI strings: plurals, dates and times follow it. */
  readonly locale: string
}

export function createTranslate(overrides: Messages = {}, locale = 'en'): Translate {
  const table: Record<string, string | undefined> = { ...defaultMessages, ...overrides }
  const plural = new Intl.PluralRules(locale)
  const t = (key: string, vars?: Record<string, string | number>) => {
    const form =
      typeof vars?.count === 'number' ? table[`${key}.${plural.select(vars.count)}`] : undefined
    const template = form ?? table[key] ?? key
    return vars
      ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
      : template
  }
  return Object.assign(t, { locale })
}

/** "5 seconds ago", "2 minutes ago", in `locale` (the UI's: `t.locale`). */
export function relativeTime(ts: number, now = Date.now(), locale?: string): string {
  const s = Math.round((ts - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(s) < 60) return rtf.format(s, 'second')
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute')
  return rtf.format(Math.round(s / 3600), 'hour')
}
