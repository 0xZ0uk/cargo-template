/**
 * Integration tests: a real Payload (SQLite in memory) with the plugin, driven
 * through Payload's own request handling (`handleEndpoints`). Each security
 * property of the endpoints has a test here.
 */
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import {
  createModeCookie,
  HEADER,
  readModeCookie,
  stegaDecode,
  stegaEncode,
  type OnPageMode,
  type SessionAdapter,
} from '@cargo/onpage-core'
import {
  buildConfig,
  getPayload,
  handleEndpoints,
  type Payload,
  type SanitizedConfig,
} from 'payload'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onpage } from '../index.ts'
import { verifyPreviewToken } from '../tokens.ts'

const ORIGIN = 'http://onpage.test'
const SECRET = 'integration-secret'

/** Records what the endpoints asked the framework adapter to do. */
const calls: Array<{ fn: string; args: unknown }> = []
const session: SessionAdapter = {
  async enable(mode: OnPageMode, { sealMode, ...opts }) {
    // What the adapter would store, read back with the plugin's secret: proves it is sealed with it.
    const cookie = await createModeCookie(mode, {
      sealMode,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const verified = (await readModeCookie(cookie, () => undefined, SECRET))?.mode
    calls.push({ fn: 'enable', args: { mode, ...opts, verified } })
  },
  async enableLink(opts) {
    calls.push({ fn: 'enableLink', args: { ...opts, sealed: await opts.seal('NEXT_SECRET') } })
  },
  async disable() {
    calls.push({ fn: 'disable', args: null })
  },
  async getMode() {
    return null
  },
}

const reviews: Array<{ ref: unknown; note: string; url: string }> = []

let config: SanitizedConfig
let payload: Payload
// Filled in beforeAll.
const ids = {} as Record<'admin' | 'editor' | 'adminPage' | 'editorPage', string | number>
const tokens: Record<string, string> = {}

const isAdmin = (user: any) => user?.collection === 'users' && user.role === 'admin'

beforeAll(async () => {
  config = await buildConfig({
    secret: SECRET,
    serverURL: ORIGIN,
    db: sqliteAdapter({ client: { url: ':memory:' } }),
    telemetry: false,
    logger: { options: { level: 'silent' } },
    admin: { user: 'users' },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [
          {
            name: 'role',
            type: 'select',
            options: ['admin', 'editor', 'viewer'],
            defaultValue: 'editor',
          },
        ],
      },
      { slug: 'customers', auth: true, fields: [] },
      {
        slug: 'pages',
        versions: { drafts: { autosave: { interval: 1500 }, schedulePublish: true } },
        admin: { useAsTitle: 'title' },
        access: {
          read: () => true,
          // Row-level rule: admins edit anything, editors only their own pages.
          update: ({ req }) =>
            isAdmin(req.user)
              ? true
              : req.user?.collection === 'users' &&
                  (req.user as { role?: string }).role === 'editor'
                ? { author: { equals: req.user.id } }
                : false,
          create: ({ req }) => !!req.user,
        },
        fields: [
          { name: 'title', type: 'text', required: true },
          { name: 'slug', type: 'text', required: true },
          { name: 'body', type: 'textarea' },
          { name: 'author', type: 'relationship', relationTo: 'users' },
          { name: 'price', type: 'number', access: { update: ({ req }) => isAdmin(req.user) } },
          // A rule that depends on the document: frozen on the admin's page.
          {
            name: 'featured',
            type: 'checkbox',
            access: { update: ({ doc }) => doc?.slug !== 'admin-page' },
          },
          // Shown only when featured: a field condition the editor asks about.
          {
            name: 'badge',
            type: 'text',
            admin: { condition: (_, sibling) => Boolean(sibling?.featured) },
          },
        ],
      },
      {
        slug: 'fragile',
        access: {
          read: () => true,
          update: () => {
            throw new Error('broken rule')
          },
        },
        fields: [{ name: 'title', type: 'text' }],
      },
      {
        slug: 'locked',
        access: { read: () => true, update: () => false },
        fields: [{ name: 'title', type: 'text' }],
      },
    ],
    globals: [
      {
        slug: 'header',
        access: {
          read: () => true,
          update: ({ req }) =>
            req.user?.collection === 'users' && (req.user as { role?: string }).role !== 'viewer',
        },
        fields: [{ name: 'tagline', type: 'text' }],
      },
    ],
    plugins: [
      onpage({
        collections: ['pages', 'fragile', 'locked'],
        globals: ['header'],
        session,
        comments: { guests: true },
        patterns: true,
        onReviewRequest: async (args) => {
          reviews.push({ ref: args.ref, note: args.note, url: args.url })
        },
      }),
    ],
  })
  payload = await getPayload({ config })
  const admin = await payload.create({
    overrideAccess: true,
    collection: 'users',
    data: { email: 'admin@test.dev', password: 'correct-horse-battery', role: 'admin' },
  })
  const editor = await payload.create({
    overrideAccess: true,
    collection: 'users',
    data: { email: 'editor@test.dev', password: 'correct-horse-battery', role: 'editor' },
  })
  await payload.create({
    overrideAccess: true,
    collection: 'users',
    data: { email: 'viewer@test.dev', password: 'correct-horse-battery', role: 'viewer' },
  })
  await payload.create({
    overrideAccess: true,
    collection: 'customers',
    data: { email: 'customer@test.dev', password: 'correct-horse-battery' },
  })
  ids.admin = admin.id
  ids.editor = editor.id
  ids.adminPage = (
    await payload.create({
      overrideAccess: true,
      collection: 'pages',
      data: { title: 'Admin page', slug: 'admin-page', author: admin.id, _status: 'published' },
    })
  ).id
  ids.editorPage = (
    await payload.create({
      overrideAccess: true,
      collection: 'pages',
      data: { title: 'Editor page', slug: 'editor-page', author: editor.id, _status: 'published' },
    })
  ).id
  for (const [name, collection, email] of [
    ['admin', 'users', 'admin@test.dev'],
    ['editor', 'users', 'editor@test.dev'],
    ['viewer', 'users', 'viewer@test.dev'],
    ['customer', 'customers', 'customer@test.dev'],
  ] as const) {
    const res = await payload.login({
      collection,
      data: { email, password: 'correct-horse-battery' },
    })
    tokens[name] = res.token!
  }
}, 60_000)

beforeEach(() => {
  calls.length = 0
})

type As = 'admin' | 'editor' | 'viewer' | 'customer' | null
function call(
  method: string,
  path: string,
  opts: { as?: As; origin?: string | null; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.as) headers.authorization = `JWT ${tokens[opts.as]}`
  if (opts.origin !== null && method !== 'GET') headers.origin = opts.origin ?? ORIGIN
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return handleEndpoints({
    config,
    request: new Request(`${ORIGIN}/api${path}`, {
      method,
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }),
  })
}
const enterPath = (id: string | number, extra = '') =>
  `/onpage/enter?kind=collection&slug=pages&id=${id}${extra}`

describe('schema endpoint', () => {
  it('requires an editor of the admin user collection', async () => {
    expect((await call('GET', '/onpage/schema/collection/pages')).status).toBe(403)
    expect((await call('GET', '/onpage/schema/collection/pages', { as: 'customer' })).status).toBe(
      403,
    )
    expect((await call('GET', '/onpage/schema/collection/media', { as: 'admin' })).status).toBe(404)
  })
  it('leaves out system fields and fields the user may not update; lists relation targets', async () => {
    const editor = await (
      await call('GET', '/onpage/schema/collection/pages', { as: 'editor' })
    ).json()
    expect(editor.editable).toEqual(['title', 'slug', 'body', 'author', 'featured', 'badge'])
    expect(editor.drafts).toBe(true)
    expect(editor.autosaveInterval).toBe(1500)
    expect(editor.relations).toEqual({ users: { titleField: 'id', label: 'User' } })
    const admin = await (
      await call('GET', '/onpage/schema/collection/pages', { as: 'admin' })
    ).json()
    expect(admin.editable).toContain('price')
    expect((await call('GET', '/onpage/schema/global/header', { as: 'admin' })).status).toBe(200)
  })
  it('with an id, evaluates field rules against that document', async () => {
    const schemaFor = async (id: string | number) =>
      (
        await (
          await call('GET', `/onpage/schema/collection/pages?id=${id}`, { as: 'admin' })
        ).json()
      ).editable
    expect(await schemaFor(ids.adminPage)).not.toContain('featured')
    expect(await schemaFor(ids.editorPage)).toContain('featured')
    // Row-level rules too: an editor gets no schema for someone else's page.
    expect(
      (await call('GET', `/onpage/schema/collection/pages?id=${ids.adminPage}`, { as: 'editor' }))
        .status,
    ).toBe(403)
  })
  it('denies the schema when update access is definitively false or throws', async () => {
    // Row-level editors still get the schema (their rule needs a document to evaluate).
    expect((await call('GET', '/onpage/schema/collection/pages', { as: 'editor' })).status).toBe(
      200,
    )
    // Definitive denial: boolean false, and a rule that throws (fail closed, not unfiltered).
    expect((await call('GET', '/onpage/schema/collection/pages', { as: 'viewer' })).status).toBe(
      403,
    )
    expect((await call('GET', '/onpage/schema/collection/locked', { as: 'admin' })).status).toBe(
      403,
    )
    expect((await call('GET', '/onpage/schema/collection/fragile', { as: 'admin' })).status).toBe(
      403,
    )
  })
})

describe("Payload's validation errors (what the editor reads per field)", () => {
  it('name the invalid field by path', async () => {
    const res = await call('PATCH', `/pages/${ids.editorPage}`, {
      as: 'editor',
      body: { title: '', _status: 'published' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].data.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'title' })]),
    )
  })
})

describe('lock endpoint', () => {
  const lockFor = (as: As, action: 'take' | 'release' = 'take', id: unknown = ids.editorPage) =>
    call('POST', '/onpage/lock', {
      as,
      body: { kind: 'collection', slug: 'pages', id, action },
    })
  const locks = async () =>
    (
      await payload.find({
        collection: 'payload-locked-documents',
        where: { 'document.value': { equals: ids.editorPage } },
        depth: 0,
        overrideAccess: true,
      })
    ).docs
  it("takes Payload's document lock, which the admin sees and which blocks others' saves", async () => {
    expect(await (await lockFor('editor')).json()).toEqual({ lockedBy: null })
    expect((await locks())[0]?.user).toMatchObject({ relationTo: 'users', value: ids.editor })
    // Someone else: told who holds it, and nothing is taken.
    expect(await (await lockFor('admin')).json()).toEqual({ lockedBy: 'editor@test.dev' })
    expect((await locks())[0]?.user).toMatchObject({ value: ids.editor })
    // Their REST save (as the admin would make it) is refused while the lock is live.
    const save = await call('PATCH', `/pages/${ids.editorPage}?draft=true`, {
      as: 'admin',
      body: { title: 'Admin edit' },
    })
    expect(save.status).toBe(423)
    // Released: the admin can take it.
    expect(await (await lockFor('editor', 'release')).json()).toEqual({ lockedBy: null })
    expect(await locks()).toHaveLength(0)
    expect(await (await lockFor('admin')).json()).toEqual({ lockedBy: null })
    await lockFor('admin', 'release')
  })
  it('only for documents the user may edit', async () => {
    expect((await lockFor('editor', 'take', ids.adminPage)).status).toBe(403)
    expect((await lockFor(null)).status).toBe(403)
  })
})

describe('conditions endpoint', () => {
  const ask = (data: unknown, as: As = 'editor', id: unknown = ids.editorPage) =>
    call('POST', '/onpage/conditions', {
      as,
      body: { kind: 'collection', slug: 'pages', id, data },
    })
  it("returns the fields a condition hides for the editor's current data", async () => {
    expect(await (await ask({ featured: false })).json()).toEqual({ hidden: ['badge'] })
    expect(await (await ask({ featured: true })).json()).toEqual({ hidden: [] })
    const schema = await (
      await call('GET', '/onpage/schema/collection/pages', { as: 'editor' })
    ).json()
    expect(schema.conditions).toBe(true)
  })
  it('only for documents the user may edit, same-site, with a document body', async () => {
    expect((await ask({}, 'editor', ids.adminPage)).status).toBe(403)
    expect((await ask({}, null)).status).toBe(403)
    expect((await ask('nope')).status).toBe(400)
    expect(
      (
        await call('POST', '/onpage/conditions', {
          as: 'editor',
          origin: 'https://evil.test',
          body: { kind: 'collection', slug: 'pages', id: ids.editorPage, data: {} },
        })
      ).status,
    ).toBe(403)
  })
})

describe('schedule endpoint', () => {
  const at = () => new Date(Date.now() + 3600_000).toISOString()
  const body = (over: Record<string, unknown> = {}) => ({
    kind: 'collection',
    slug: 'pages',
    id: ids.editorPage,
    at: at(),
    ...over,
  })
  it('queues a schedulePublish job for a document the user may publish', async () => {
    const res = await call('POST', '/onpage/schedule', { as: 'editor', body: body() })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.type).toBe('publish')
    const job = await payload.findByID({
      overrideAccess: true,
      collection: 'payload-jobs',
      id: out.id,
    })
    expect(job).toMatchObject({
      taskSlug: 'schedulePublish',
      input: { type: 'publish', doc: { relationTo: 'pages', value: ids.editorPage } },
    })
    expect(new Date(job.waitUntil as string).toISOString()).toBe(out.waitUntil)
  })
  it("refuses other people's pages, past times, documents without scheduling, and cross-site posts", async () => {
    const status = async (opts: Parameters<typeof call>[2]) =>
      (await call('POST', '/onpage/schedule', opts)).status
    expect(await status({ as: 'editor', body: body({ id: ids.adminPage }) })).toBe(403)
    expect(await status({ as: 'viewer', body: body() })).toBe(403)
    expect(await status({ body: body() })).toBe(403)
    expect(await status({ as: 'admin', body: body({ at: '2001-01-01T00:00:00Z' }) })).toBe(400)
    expect(await status({ as: 'admin', body: body({ at: 'soon' }) })).toBe(400)
    expect(await status({ as: 'admin', body: body({ slug: 'locked', id: 1 }) })).toBe(400)
    expect(await status({ as: 'admin', body: body(), origin: 'https://evil.test' })).toBe(403)
  })
  it('tells the editor which documents can be scheduled', async () => {
    const pages = await (
      await call('GET', '/onpage/schema/collection/pages', { as: 'admin' })
    ).json()
    const header = await (await call('GET', '/onpage/schema/global/header', { as: 'admin' })).json()
    expect(pages.schedulePublish).toBe(true)
    expect(header.schedulePublish).toBeUndefined()
  })
})

describe('enter / mode / exit', () => {
  it("warns when the editor's auth cookie isn't sent (the mode can't be bound)", async () => {
    const warn = vi.spyOn(payload.logger, 'warn').mockImplementation(() => undefined)
    try {
      await call('POST', '/onpage/mode?mode=edit&path=/', { as: 'admin' }) // header auth only
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"payload-token"'))
      warn.mockClear()
      await call('POST', '/onpage/mode?mode=edit&path=/', {
        as: 'admin',
        headers: { cookie: `payload-token=${tokens.admin}` },
      })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('only accepts same-origin POSTs (CSRF)', async () => {
    expect((await call('GET', enterPath(ids.adminPage), { as: 'admin' })).status).toBe(404) // no GET route
    expect(
      (await call('POST', enterPath(ids.adminPage), { as: 'admin', origin: 'https://evil.test' }))
        .status,
    ).toBe(403)
    expect(
      (await call('POST', enterPath(ids.adminPage), { as: 'admin', origin: null })).status,
    ).toBe(403)
  })
  it("enforces row-level access: an editor can't open someone else's page", async () => {
    expect((await call('POST', enterPath(ids.adminPage), { as: 'editor' })).status).toBe(403)
    const own = await call('POST', enterPath(ids.editorPage), { as: 'editor' })
    expect(own.status).toBe(303)
    expect(own.headers.get('location')).toBe(`${ORIGIN}/editor-page`)
    expect(calls).toEqual([
      {
        fn: 'enable',
        args: { mode: 'edit', secure: false, bindTo: 'payload-token', verified: 'edit' },
      },
    ])
  })
  it('refuses users of other auth collections', async () => {
    expect((await call('POST', enterPath(ids.editorPage), { as: 'customer' })).status).toBe(403)
    // Signed in but not allowed → 403; not signed in at all → 401.
    expect((await call('POST', '/onpage/mode?mode=edit&path=/', { as: 'customer' })).status).toBe(
      403,
    )
    expect((await call('POST', '/onpage/mode?mode=edit&path=/')).status).toBe(401)
    expect(calls).toEqual([])
  })
  it('refuses mode to users who can edit nothing, keeps it for row-level editors', async () => {
    expect((await call('POST', '/onpage/mode?mode=edit&path=/', { as: 'viewer' })).status).toBe(403)
    expect(calls).toEqual([])
    const editor = await call('POST', '/onpage/mode?mode=edit&path=/', { as: 'editor' })
    expect(editor.status).toBe(303)
    expect(calls).toEqual([
      {
        fn: 'enable',
        args: { mode: 'edit', secure: false, bindTo: 'payload-token', verified: 'edit' },
      },
    ])
  })
  it('answers anonymous callers uniformly, whatever the slug', async () => {
    const bad = '/onpage/enter?kind=collection&slug=nope&id=1'
    expect((await call('POST', bad)).status).toBe(401)
    expect((await call('POST', bad, { as: 'customer' })).status).toBe(403)
    expect((await call('POST', bad, { as: 'admin' })).status).toBe(400)
    const body = { kind: 'collection', slug: 'nope', id: 1 }
    expect((await call('POST', '/onpage/preview-link', { body })).status).toBe(403)
    expect((await call('POST', '/onpage/preview-link', { as: 'customer', body })).status).toBe(403)
    expect((await call('POST', '/onpage/preview-link', { as: 'admin', body })).status).toBe(400)
  })
  it('never redirects off-site', async () => {
    for (const bad of ['//evil.test', '/%09/evil.test', '/\t/evil.test', 'https://evil.test']) {
      const res = await call('POST', `/onpage/exit?path=${encodeURIComponent(bad)}`)
      expect(new URL(res.headers.get('location')!).origin).toBe(ORIGIN)
      const enter = await call(
        'POST',
        enterPath(ids.adminPage, `&path=${encodeURIComponent(bad)}`),
        { as: 'admin' },
      )
      expect(new URL(enter.headers.get('location')!).origin).toBe(ORIGIN)
    }
  })
})

describe('new pages from the page', () => {
  it('duplicates a page as a draft with a unique slug, and creates blank ones', async () => {
    const dup = await call('POST', '/onpage/pages', {
      as: 'editor',
      body: { action: 'duplicate', slug: 'pages', id: ids.editorPage },
    })
    expect(dup.status).toBe(200)
    const { id, path } = await dup.json()
    const copy = await payload.findByID({
      overrideAccess: true,
      collection: 'pages',
      id,
      draft: true,
    })
    expect(copy).toMatchObject({
      title: 'Editor page (copy)',
      slug: 'editor-page-copy',
      _status: 'draft',
    })
    expect(path).toBe('/editor-page-copy')
    const a = await (
      await call('POST', '/onpage/pages', {
        as: 'editor',
        body: { slug: 'pages', title: 'Über uns!' },
      })
    ).json()
    const b = await (
      await call('POST', '/onpage/pages', {
        as: 'editor',
        body: { slug: 'pages', title: 'Uber Uns' },
      })
    ).json()
    expect([a.path, b.path]).toEqual(['/uber-uns', '/uber-uns-2'])
  })
  it("needs a signed-in editor, Payload's create access, a title, and an enabled collection", async () => {
    const status = async (as: As, body: Record<string, unknown>) =>
      (await call('POST', '/onpage/pages', { ...(as ? { as } : {}), body })).status
    expect(await status(null, { slug: 'pages', title: 'x' })).toBe(403)
    expect(await status('customer', { slug: 'pages', title: 'x' })).toBe(403)
    expect(await status('editor', { slug: 'users', title: 'x' })).toBe(400)
    expect(await status('editor', { slug: 'pages' })).toBe(400)
    expect(await status('editor', { slug: 'pages', title: '   ' })).toBe(400)
  })
})

describe('saved sections', () => {
  it('saves a section without markers and lists them by allowed block type', async () => {
    const marked = stegaEncode('Big idea', {
      ref: 'c:pages:1',
      path: 'layout.0.heading',
      kind: 'text',
    })
    const save = await call('POST', '/onpage/patterns', {
      as: 'editor',
      body: { name: 'Launch hero', block: { id: 'x', blockType: 'hero', heading: marked } },
    })
    expect(save.status).toBe(200)
    await call('POST', '/onpage/patterns', {
      as: 'editor',
      body: { name: 'CTA', block: { blockType: 'cta', label: 'Go' } },
    })
    const heroes = await (
      await call('GET', '/onpage/patterns?blocks=hero', { as: 'editor' })
    ).json()
    expect(heroes.patterns).toEqual([
      expect.objectContaining({
        name: 'Launch hero',
        blockType: 'hero',
        data: { id: 'x', blockType: 'hero', heading: 'Big idea' },
      }),
    ])
    const all = await (await call('GET', '/onpage/patterns', { as: 'editor' })).json()
    expect(all.patterns.map((p: { name: string }) => p.name)).toEqual(['CTA', 'Launch hero'])
  })
  it('only for editors, and only blocks', async () => {
    expect((await call('GET', '/onpage/patterns')).status).toBe(403)
    expect(
      (
        await call('POST', '/onpage/patterns', {
          body: { name: 'x', block: { blockType: 'hero' } },
        })
      ).status,
    ).toBe(403)
    expect(
      (await call('POST', '/onpage/patterns', { as: 'editor', body: { name: 'x', block: 'nope' } }))
        .status,
    ).toBe(400)
    expect(
      (
        await call('POST', '/onpage/patterns', {
          as: 'editor',
          body: { block: { blockType: 'hero' } },
        })
      ).status,
    ).toBe(400)
  })
})

describe('comments and review requests', () => {
  const page = () => ({ kind: 'collection', slug: 'pages', id: ids.editorPage })
  /** Open a share link to the editor's page; returns the sealed grant cookie a viewer holds. */
  const grantCookie = async () => {
    const link = await (
      await call('POST', '/onpage/preview-link', { as: 'admin', body: page() })
    ).json()
    calls.length = 0
    await handleEndpoints({ config, request: new Request(link.url) })
    return `onpage_preview=${(calls[0]!.args as { sealed: string }).sealed}`
  }
  const list = async (as: As = 'editor') =>
    call(
      'GET',
      `/onpage/comments?kind=collection&slug=pages&id=${ids.editorPage}`,
      as ? { as } : {},
    )

  it('editors comment and read comments on their documents only', async () => {
    const res = await call('POST', '/onpage/comments', {
      as: 'editor',
      body: { ...page(), body: '  Tighten this heading  ', path: 'title' },
    })
    expect(res.status).toBe(200)
    const { comments } = await (await list()).json()
    expect(comments[0]).toMatchObject({
      body: 'Tighten this heading',
      path: 'title',
      author: 'editor@test.dev',
      guest: false,
      resolved: false,
    })
    // Someone else's page, or nobody: no.
    const other = { kind: 'collection', slug: 'pages', id: ids.adminPage, body: 'x' }
    expect((await call('POST', '/onpage/comments', { as: 'editor', body: other })).status).toBe(403)
    expect(
      (
        await call('GET', `/onpage/comments?kind=collection&slug=pages&id=${ids.adminPage}`, {
          as: 'editor',
        })
      ).status,
    ).toBe(403)
    expect((await list(null)).status).toBe(403)
    // Resolve it.
    expect(
      (
        await call('POST', '/onpage/comments/resolve', {
          as: 'editor',
          body: { id: comments[0].id },
        })
      ).status,
    ).toBe(200)
    expect((await (await list()).json()).comments[0].resolved).toBe(true)
  })

  it('share-link viewers comment on the page they were sent, by name, within limits', async () => {
    const cookie = await grantCookie()
    const guest = (body: Record<string, unknown>, extra: Record<string, string> = {}) =>
      call('POST', '/onpage/comments', {
        headers: { cookie, ...extra },
        body: { ...page(), ...body },
      })
    // The toolbar asks first.
    expect(
      await (await call('GET', '/onpage/comments/guest', { headers: { cookie } })).json(),
    ).toEqual({ enabled: true })
    expect(await (await call('GET', '/onpage/comments/guest')).json()).toEqual({ enabled: false })
    expect((await guest({ body: 'Looks good', name: 'Sam' })).status).toBe(200)
    // Without naming the document: the grant's.
    expect(
      (
        await call('POST', '/onpage/comments', {
          headers: { cookie },
          body: { body: 'Grant decides', name: 'Sam' },
        })
      ).status,
    ).toBe(200)
    expect((await guest({ body: 'No name' })).status).toBe(400)
    expect((await guest({ body: 'x'.repeat(2001), name: 'Sam' })).status).toBe(400)
    // Another page than the link's: no.
    expect(
      (
        await call('POST', '/onpage/comments', {
          headers: { cookie },
          body: { kind: 'collection', slug: 'pages', id: ids.adminPage, body: 'hi', name: 'Sam' },
        })
      ).status,
    ).toBe(403)
    // No grant (or a forged one): no.
    expect(
      (
        await call('POST', '/onpage/comments', {
          headers: { cookie: 'onpage_preview=forged' },
          body: { ...page(), body: 'hi', name: 'Sam' },
        })
      ).status,
    ).toBe(403)
    const { comments } = await (await list()).json()
    expect(comments[0]).toMatchObject({ body: 'Grant decides', author: 'Sam', guest: true })
    // A cap per link.
    for (let i = 2; i < 20; i++) await guest({ body: `n${i}`, name: 'Sam' })
    expect((await guest({ body: 'one too many', name: 'Sam' })).status).toBe(429)
  })

  it("review requests mint a share link, call the site's hook, and are kept as a comment", async () => {
    const res = await call('POST', '/onpage/review', {
      as: 'editor',
      body: { ...page(), note: 'Ready for legal' },
    })
    expect(res.status).toBe(200)
    expect(reviews.at(-1)).toMatchObject({
      note: 'Ready for legal',
      ref: { slug: 'pages', id: ids.editorPage },
    })
    expect(reviews.at(-1)!.url).toContain('/api/onpage/preview?token=')
    const { comments } = await (await list()).json()
    expect(comments[0]).toMatchObject({ kind: 'review', body: 'Ready for legal' })
    expect(
      (
        await call('POST', '/onpage/review', {
          as: 'editor',
          body: { kind: 'collection', slug: 'pages', id: ids.adminPage },
        })
      ).status,
    ).toBe(403)
  })

  it('tells the editor whether they may publish', async () => {
    const schema = await (
      await call('GET', `/onpage/schema/collection/pages?id=${ids.editorPage}`, { as: 'editor' })
    ).json()
    expect(schema).toMatchObject({ comments: true, canPublish: true })
  })
})

describe('preview links', () => {
  it('needs JSON, edit rights, and derives the path on the server', async () => {
    expect(
      (
        await call('POST', '/onpage/preview-link', {
          as: 'admin',
          headers: { 'content-type': 'text/plain' },
        })
      ).status,
    ).toBe(415)
    expect(
      (
        await call('POST', '/onpage/preview-link', {
          as: 'editor',
          body: { kind: 'collection', slug: 'pages', id: ids.adminPage },
        })
      ).status,
    ).toBe(403)
    const res = await call('POST', '/onpage/preview-link', {
      as: 'admin',
      body: { kind: 'collection', slug: 'pages', id: ids.adminPage, path: '/somewhere-else' },
    })
    expect(res.status).toBe(200)
    const { url, expiresAt } = await res.json()
    const token = new URL(url).searchParams.get('token')!
    const payloadOf = await verifyPreviewToken(token, SECRET)
    expect(payloadOf).toMatchObject({ path: '/admin-page', ref: `c:pages:${ids.adminPage}` })
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000)
  })
  it('opens: hands the adapter a sealed grant for that page only', async () => {
    const link = await (
      await call('POST', '/onpage/preview-link', {
        as: 'admin',
        body: { kind: 'collection', slug: 'pages', id: ids.adminPage },
      })
    ).json()
    const res = await handleEndpoints({ config, request: new Request(link.url) })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/admin-page`)
    const args = calls[0]!.args as { path: string; sealed: string }
    expect(calls[0]!.fn).toBe('enableLink')
    expect(args.path).toBe('/admin-page')
    expect(args.sealed).not.toContain('NEXT_SECRET')
  })
  it('rejects tampered tokens, and links whose document moved', async () => {
    expect((await call('GET', '/onpage/preview?token=nope')).status).toBe(403)
    const link = await (
      await call('POST', '/onpage/preview-link', {
        as: 'admin',
        body: { kind: 'collection', slug: 'pages', id: ids.editorPage },
      })
    ).json()
    await payload.update({
      overrideAccess: true,
      collection: 'pages',
      id: ids.editorPage,
      data: { slug: 'moved' },
      draft: true,
    })
    expect((await handleEndpoints({ config, request: new Request(link.url) })).status).toBe(403)
    await payload.update({
      overrideAccess: true,
      collection: 'pages',
      id: ids.editorPage,
      data: { slug: 'editor-page' },
      draft: true,
    })
    expect(calls.find((c) => c.fn === 'enableLink')).toBeUndefined()
  })
})

describe('writes', () => {
  const save = (id: string | number, data: object, seen?: string) =>
    call('PATCH', `/pages/${id}?draft=true&autosave=true&depth=0`, {
      as: 'admin',
      body: data,
      headers: seen ? { [HEADER.ifUnmodifiedSince]: seen } : {},
    })

  it('rejects a stale write with 409, accepts consecutive editor saves', async () => {
    const current = await payload.findByID({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      draft: true,
    })
    const first = await save(ids.adminPage, { body: 'one' }, current.updatedAt)
    expect(first.status).toBe(200)
    const afterFirst = (await first.json()).doc.updatedAt as string
    const second = await save(ids.adminPage, { body: 'two' }, afterFirst)
    expect(second.status).toBe(200)
    // Someone else saves in between…
    await payload.update({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      data: { body: 'theirs' },
      draft: true,
    })
    const stale = await save(ids.adminPage, { body: 'mine' }, (await second.json()).doc.updatedAt)
    expect(stale.status).toBe(409)
    // …and writes without the header (admin, API) are untouched.
    expect((await save(ids.adminPage, { body: 'api' })).status).toBe(200)
  })

  it('drops __proto__ keys from writes without breaking the save', async () => {
    const res = await save(ids.adminPage, JSON.parse('{"body":"kept","__proto__":{"x":1}}'))
    expect(res.status).toBe(200)
    const stored = await payload.findByID({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      draft: true,
    })
    expect(stored.body).toBe('kept')
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
  })

  it('never stores markers, and only marks reads that ask for them', async () => {
    const marked = await payload.findByID({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      draft: true,
      context: { onpage: true },
    })
    expect(stegaDecode(marked.title)[0]).toMatchObject({ path: 'title' })
    expect(stegaDecode(String(marked.slug))).toEqual([]) // machine value
    const plain = await payload.findByID({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      draft: true,
    })
    expect(stegaDecode(plain.title)).toEqual([])
    await payload.update({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      data: { title: marked.title },
      draft: true,
    })
    const stored = await payload.findByID({
      overrideAccess: true,
      collection: 'pages',
      id: ids.adminPage,
      draft: true,
    })
    expect(stored.title).toBe('Admin page')
  })
})
