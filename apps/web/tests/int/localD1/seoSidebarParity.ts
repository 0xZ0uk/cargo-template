/**
 * The SEO sidebar scores what `/validate` scores (cargo-template #47).
 *
 * In the edit form, uploads, `reference` links and reusable sections are plain IDs. The
 * sidebar posts the form's values to `/seo-plugin/sidebar-content`, which populates them on
 * the server; `/validate` reads the saved page with `findByID({ depth: 1 })`. For a page
 * with an upload, a reference link and a reusable section, both must produce the same
 * checks. Runs against the real config, local D1 and R2.
 *
 * Not a spec file of its own: `api.int.spec.ts` runs it with its Payload instance. Two test
 * files booting Payload each start a workerd on the same local D1 file, and running in
 * parallel they fail with `SQLITE_BUSY`.
 */
import { analyzeSeo, buildSeoInputFromDoc, type SeoInput } from '@cargo/payload-seo-analyzer'
import { createPayloadRequest, type Payload, type PayloadHandler } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { heading, paragraph, richText } from '@/blocks/shared/lexical'

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** The content keys the sidebar takes from `/sidebar-content` (`DOC_CONTENT_INPUT_KEYS`). */
const CONTENT_KEYS = [
  'heroTitle',
  'heroRichText',
  'heroLinks',
  'heroMedia',
  'blocks',
  'blockContent',
  'content',
  'isPost',
  'metaImage',
  'robotsMeta',
] as const

/** The settings `defineBlock` adds to every block (required in the generated types). */
const sectionSettings = { background: 'default', spacing: 'md' } as const

let payload: Payload
let user: Record<string, unknown>
const created: Array<{ collection: 'media' | 'pages' | 'sections' | 'users'; id: number | string }> = []
const stamp = Date.now()
let pageId: number | string
let targetSlug: string

const sidebarHandler = (): PayloadHandler => {
  const endpoint = payload.config.endpoints.find(
    (e) => e.path === '/seo-plugin/sidebar-content' && e.method === 'post',
  )
  if (!endpoint) throw new Error('sidebar-content endpoint not registered')
  return endpoint.handler
}

/** What the sidebar's request returns for these form values. */
const sidebarContent = async (data: unknown, as: Record<string, unknown> | null = user) => {
  const req = await createPayloadRequest({
    payload,
    user: as as never,
    // A fresh copy, like a parsed request body: the endpoint populates it in place.
    req: { json: async () => ({ collection: 'pages', data: structuredClone(data) }) } as never,
  })
  return sidebarHandler()(req)
}

const checksOf = (input: SeoInput) =>
  analyzeSeo(input).checks.map(({ id, status, message }) => ({ id, status, message }))

export const seoSidebarParity = (getPayload: () => Payload) =>
  describe('SEO sidebar ↔ /validate parity', () => {
    beforeAll(async () => {
      payload = getPayload()

      const admin = await payload.create({
        collection: 'users',
        data: { email: `seo-parity-${stamp}@example.com`, password: 'parity-test-password' },
        overrideAccess: true,
      })
      created.push({ collection: 'users', id: admin.id })
      user = { ...admin, collection: 'users' }

      const media = await payload.create({
        collection: 'media',
        data: { alt: 'Espresso shot pouring into a cup' },
        file: { data: PNG, mimetype: 'image/png', name: `parity-${stamp}.png`, size: PNG.length },
        overrideAccess: true,
      })
      created.push({ collection: 'media', id: media.id })

      targetSlug = `parity-target-${stamp}`
      const target = await payload.create({
        collection: 'pages',
        data: {
          title: 'Brewing guide',
          slug: targetSlug,
          _status: 'published',
          layout: [
            {
              blockType: 'richText',
              variant: 'narrow',
              section: sectionSettings,
              richText: richText(paragraph('Grind, dose and time.')),
            },
          ],
        },
        overrideAccess: true,
      })
      created.push({ collection: 'pages', id: target.id })

      const section = await payload.create({
        collection: 'sections',
        data: {
          title: `Parity section ${stamp}`,
          layout: [
            {
              blockType: 'richText',
              variant: 'narrow',
              section: sectionSettings,
              richText: richText(
                heading('h2', 'Visit the roastery'),
                paragraph('Our roastery opens every Saturday for tastings, cupping sessions and brewing classes.'),
              ),
            },
          ],
        },
        overrideAccess: true,
      })
      created.push({ collection: 'sections', id: section.id })

      const page = await payload.create({
        collection: 'pages',
        data: {
          title: 'Espresso at home',
          slug: `parity-page-${stamp}`,
          _status: 'published',
          meta: {
            title: 'Espresso at home: a short guide | Cargo',
            description: 'How to pull a good espresso shot at home with fresh beans and a steady grind.',
            image: media.id,
          },
          layout: [
            {
              blockType: 'richText',
              variant: 'narrow',
              section: sectionSettings,
              richText: richText(
                heading('h1', 'Espresso at home'),
                paragraph('Espresso is brewed by forcing hot water through finely ground coffee.'),
              ),
            },
            {
              blockType: 'mediaBlock',
              variant: 'contained',
              section: sectionSettings,
              media: media.id,
              caption: 'A double shot.',
            },
            {
              blockType: 'cta',
              variant: 'banner',
              section: sectionSettings,
              title: 'Learn to brew',
              links: [
                {
                  link: {
                    type: 'reference',
                    reference: { relationTo: 'pages', value: target.id },
                    label: 'Read the brewing guide',
                  },
                },
              ],
            },
            { blockType: 'globalSection', reusableSection: section.id },
          ],
        },
        overrideAccess: true,
      })
      created.push({ collection: 'pages', id: page.id })
      pageId = page.id
    })

    afterAll(async () => {
      for (const { collection, id } of created.reverse()) {
        await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
      }
    })

    it('produces the same checks as /validate for a page with an upload, a reference link and a reusable section', async () => {
      // The form's values: the page at depth 0, where relations are IDs.
      const formValues = await payload.findByID({ collection: 'pages', id: pageId, depth: 0, overrideAccess: true })
      expect((formValues.layout?.[1] as { media?: unknown }).media).toBeTypeOf('number')

      // /validate: the saved page at depth 1.
      const saved = await payload.findByID({ collection: 'pages', id: pageId, depth: 1, overrideAccess: true })
      const fromValidate = buildSeoInputFromDoc(saved, 'pages', { extractors: payload })

      // The sidebar: the form's values, read through the endpoint.
      const response = await sidebarContent(formValues)
      expect(response.status).toBe(200)
      const content = (await response.json()) as Partial<SeoInput>

      // Everything but the content stays the same, so any difference comes from the content.
      const fromSidebar: SeoInput = { ...fromValidate }
      for (const key of CONTENT_KEYS) delete fromSidebar[key]
      Object.assign(fromSidebar, content)

      expect(checksOf(fromSidebar)).toEqual(checksOf(fromValidate))

      // Not vacuous: the populated content is what the server read, and the form's IDs alone
      // would have scored less.
      const words = (input: SeoInput) => analyzeSeo(input).checks.find((c) => c.id === 'content-wordcount')?.message
      expect(words(fromSidebar)).toBe(words(fromValidate))
      const blocks = JSON.stringify(content.blocks)
      expect(blocks).toContain('Espresso shot pouring into a cup') // the upload's alt text
      expect(blocks).toContain(targetSlug) // the reference link's page
      expect(blocks).toContain('Our roastery opens every Saturday') // the reusable section's text
      expect((content.metaImage as { alt?: string } | undefined)?.alt).toBe('Espresso shot pouring into a cup')

      const unpopulated = buildSeoInputFromDoc(formValues, 'pages')
      expect(checksOf(unpopulated)).not.toEqual(checksOf(fromValidate))
    })

    it('refuses callers outside the admin panel and collections the plugin does not analyse', async () => {
      expect((await sidebarContent({ title: 'x' }, null)).status).toBe(401)

      const req = await createPayloadRequest({
        payload,
        user: user as never,
        req: { json: async () => ({ collection: 'users', data: {} }) } as never,
      })
      expect((await sidebarHandler()(req)).status).toBe(403)
    })
  })
