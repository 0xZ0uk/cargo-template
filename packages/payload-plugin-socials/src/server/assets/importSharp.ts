/**
 * Loads sharp, an OPTIONAL peer dependency (only `assets.autoConvert` needs it).
 *
 * The specifier is a variable on purpose: host bundlers (Vite, webpack) resolve
 * every literal dynamic import at build time, so a literal sharp import breaks the
 * host's build when sharp isn't installed, which is the normal case on Cloudflare
 * Workers (sharp is a native module and can't run there). See
 * `src/__tests__/optionalImports.test.ts`.
 */
const SHARP = 'sharp'

export const importSharp = async <T>(): Promise<T> =>
  ((await import(/* @vite-ignore */ /* webpackIgnore: true */ SHARP)) as { default: T }).default
