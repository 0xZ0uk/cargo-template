/** Framework-free Renderer adapters. TanStack Start's router-invalidate renderer lives in @cargo/onpage-tanstack-start. */
import type { Renderer } from '@cargo/onpage-core'

/** The page renders from editor state (OnPageClient everywhere): nothing to do after a save. */
export const clientState = (): Renderer => ({ name: 'client', live: true, afterSave() {} })

/** Reload the whole page after each save. A last resort for frameworks without a soft refresh. */
export const fullReload = (): Renderer => ({
  name: 'reload',
  live: false,
  afterSave() {
    window.location.reload()
    return new Promise(() => {}) // never resolves: the page goes away
  },
})
