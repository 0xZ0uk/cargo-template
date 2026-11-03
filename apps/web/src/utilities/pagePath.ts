/** The page with the slug `home` is served at `/`; every other page at `/<slug>`. */
export const pagePath = (slug: string) => (slug === 'home' ? '/' : `/${encodeURIComponent(slug)}`)
