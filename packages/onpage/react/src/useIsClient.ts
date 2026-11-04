import { useEffect, useSyncExternalStore } from 'react'
import { injectStyles } from './styles.ts'

const noopSubscribe = () => () => {}

/** False during SSR and hydration, true after: for UI that only exists in the browser. */
export const useIsClient = (): boolean =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )

/** Adds the editor's stylesheet to the page while mounted. */
export const useEditorStyles = (): void => useEffect(() => injectStyles(), [])
