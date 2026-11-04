# Several editors: locks, conflicts and errors

## Document locks

payload-onpage uses Payload's own [document locking](https://payloadcms.com/docs/admin/locked-documents) (`lockDocuments`, on by default). While someone edits a page on the page, they hold the lock on each of its documents. It's taken when the document loads, refreshed every minute and after each save, and released when they leave. So in the admin, others see that the document is being edited, and the other way round.

When someone else holds a live lock, the dock says who ("Ada is editing this Page"). Payload refuses saves to a locked document, so your changes wait until they leave it or their lock expires (`lockDocuments.duration`, 5 minutes by default).

Set `lockDocuments: false` on a collection to turn it off, as in the admin.

## Conflicts

The editor sends the version it last saw with every save. If someone saved the document since, Payload's stale-write guard refuses the save and the dock offers two choices:

- **Keep my changes** loads their version and re-applies your unsaved changes on top of it, field by field. Fields only they changed keep their version; fields you both changed take yours. It's one undoable step.
- **Reload latest** loads their version and drops your unsaved changes.

## Invalid fields

When a save or publish fails validation (a required field left empty, say), the dock shows Payload's message, and every field it names is outlined in red on the page until it saves cleanly. Drafts are often saved without validation, so required fields usually show up at **Publish**.
