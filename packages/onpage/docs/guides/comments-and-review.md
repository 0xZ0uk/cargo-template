# Comments and review requests

Turn on comments, and editors can discuss a page on the page and ask for a review. Optionally, people you send a share link to can comment too.

```ts
onpage({
  collections: ['pages'],
  session: nextSession(),
  comments: { guests: true }, // or `comments: true` for editors only
  onReviewRequest: async ({ req, ref, note, url, expiresAt }) => {
    // Tell your reviewers: email, Slack… `url` is a fresh share link to the page's draft.
    await req.payload.sendEmail({
      to: 'reviewers@example.com',
      subject: 'Review requested',
      text: `${note}\n\n${url} (until ${expiresAt})`,
    })
  },
})
```

Comments are stored in an `onpage-comments` collection that the plugin adds, so they're in the admin too (group "On-page"). On a site with migrations, generate one after turning comments on.

## Editors

**Comments** in the dock (with the number still open) lists each document's comments. Open ones come first, and each shows who wrote it, when, the field it's about, and any text a viewer quoted.

- **Comment** adds one. With a section or field selected, you can make it about that.
- **Resolve** closes a comment; **Reopen** brings it back.
- **Request review** sends your note and a share link to `onReviewRequest`, and keeps the request in the list.

Editors who may edit a page but not publish it (publishing needs update access with `_status: 'published'`, as in the admin) see Publish turned off, and a pointer to **Request review**.

## Share-link viewers

With `comments: { guests: true }`, the share-link toolbar has **Comment**. Viewers give their name and a comment. Text they had selected on the page is attached as a quote.

What a viewer can do is limited on the server:

- **Only the page they were sent.** The document is taken from their sealed share-link grant, never from the request. A grant that's expired, forged or for another page is refused.
- **Write only.** Viewers can't read comments, and they can't resolve them.
- **Short text.** 2,000 characters for a comment, 500 for a quote, 80 for a name, as plain text.
- **At most 20 comments per link per hour.** For anything public, also put the endpoints behind your own rate limiting.
