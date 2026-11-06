/**
 * Base of the generation marker (`gen/frontend-redirects`) the host's frontend compares to know
 * when to reload its redirect table. Bumped by the redirect hooks (`REDIRECT_CACHE_BASES`).
 * Kept in its own module, free of Node globals, so the `shared` entry can export it.
 */
export const FRONTEND_REDIRECTS_CACHE_BASE = 'frontend-redirects'
