# Page settings, history and publishing

## New pages

**Page settings** also has **This page**:

- **Duplicate this page** copies the page as a draft titled "… (copy)", at a free address made from the title (`home-copy`), and opens it.
- **New page** creates a blank draft with the title you give, and opens it.

Payload checks the editor's create access. Both keep you in edit mode on the new page.

## Documents without drafts

A collection or global without `versions.drafts` has no draft: each on-page change is published as soon as it saves. The dock says so ("Header: changes go live"), and the plugin warns at startup. Add `versions: { drafts: true }` to keep changes as drafts.

## Page settings

**Page settings** in the dock shows each document's own fields that aren't on the page: SEO meta, dates, relationships, selects and toggles. It's generated from your schema like a section's settings. Fields shown on the page are edited there instead, and `slug` is left out because changing it would move the page under the editor.

Narrow what's offered with the plugin's `fields` option per collection, or with field access.

### Field conditions

Fields with `admin.condition` show and hide in page and section settings as they do in the admin. Conditions are functions in your config, so the plugin runs them on the server against the document as the editor has it (`POST /api/onpage/conditions`), shortly after each change. A link group that shows either `url` or `reference` depending on its `type`, as in Payload's website template, shows only the one that applies.

## History

**History** in the dock lists the document's saved versions (Payload versions), newest first.

- **Outline what changed since published** outlines, on the page, every field the draft changes compared with the published version, and counts them. A new section is outlined as a whole.
- **Restore** makes an older version the current draft. It isn't published: review it on the page, then publish. Edits not yet saved are saved first, so they stay in the history.

Version access follows Payload's `readVersions` access.

## Publish

**Publish** publishes every document on the page that has unpublished changes: edits made here, or drafts saved earlier. Documents without changes are skipped.

**▾** beside it opens the publish menu, where you choose which documents to publish. For example, publish the page but not a header edit that isn't ready.

## Schedule

For collections and globals with scheduled publishing on, the publish menu can schedule them for later:

```ts
versions: { drafts: { autosave: true, schedulePublish: true } },
```

Payload then publishes each document's **latest saved draft** at that time, through the same `schedulePublish` job the admin uses. Two things to know:

- **Scheduled jobs need Payload's job queue to run:** `jobs.autoRun` in the config, or a cron calling `/api/payload-jobs/run`. See [Payload's jobs docs](https://payloadcms.com/docs/jobs-queue/overview).
- **Who can schedule:** the same users who can publish the document. The check is the one Payload's scheduler makes: update access for `_status: 'published'`.

Edits made after scheduling are included, since the job publishes the draft as it is then. See or cancel scheduled publishes in the admin's document view.

A custom `DataSource` offers scheduling by implementing `schedulePublish(ref, { at, type, locale })`.
