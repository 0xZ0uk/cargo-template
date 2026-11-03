'use client'

// Import from our own package's client entry — tsup keeps this external,
// preserving the RSC boundary (this file = client, SeoView wrapper = server)
// @ts-ignore — self-reference via package exports
export { SeoView as SeoViewClient } from '@cargo/payload-seo-analyzer/client'
