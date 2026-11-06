// SPIKE (#59): seed users and a draft page in the local D1. `pnpm payload run src/spike/seed.ts`
import { getPayload } from 'payload'
import config from '@payload-config'

const payload = await getPayload({ config })
for (const email of ['admin@spike.test', 'readonly@spike.test']) {
  const found = await payload.find({ collection: 'users', where: { email: { equals: email } }, limit: 1, overrideAccess: true })
  if (!found.docs.length) await payload.create({ collection: 'users', data: { email, password: 'spike-password-1' }, overrideAccess: true })
}
const page = await payload.find({ collection: 'pages', where: { slug: { equals: 'spike-draft' } }, limit: 1, draft: true, overrideAccess: true })
if (!page.docs.length) {
  await payload.create({
    collection: 'pages',
    draft: true,
    overrideAccess: true,
    data: { title: 'Spike draft page', slug: 'spike-draft', _status: 'draft' } as never,
  })
}
const all = await payload.find({ collection: 'pages', draft: true, limit: 10, select: { title: true, slug: true, _status: true }, overrideAccess: true })
console.log(JSON.stringify(all.docs))
process.exit(0)
