/**
 * Server-safe, runtime-agnostic helpers for the frontend: no Payload, React or Node
 * imports, so a host can import them statically from route code (the package root also
 * holds the Payload plugin and its endpoints).
 *
 *   import { buildJsonLd, serializeJsonLd } from '@cargo/payload-seo-analyzer/shared'
 */
export { buildJsonLd, serializeJsonLd } from './helpers/buildSchema.js'
export { normalizeFromPath, validateRedirectTarget, type RedirectTargetResult } from './helpers/redirectSafety.js'
