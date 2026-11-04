/**
 * Outlines the page elements of fields the server called invalid (a failed
 * save or publish), until they save or publish cleanly.
 */
import type { RefKey, SessionSnapshot } from '@cargo/onpage-core'
import { useEffect } from 'react'
import { DOM_ATTR } from '../dom.ts'
import type { TargetIndex } from '../types.ts'

export function useInvalidTargets(snap: SessionSnapshot, targets: TargetIndex, docKeys: RefKey[]) {
  useEffect(() => {
    const marked: Element[] = []
    for (const key of docKeys) {
      for (const { path, message } of snap.docs[key]?.invalid ?? []) {
        const el = targets.find(key, path)?.el
        if (!el) continue
        el.setAttribute(DOM_ATTR.invalid, message || 'invalid')
        marked.push(el)
      }
    }
    return () => {
      for (const el of marked) el.removeAttribute(DOM_ATTR.invalid)
    }
  }, [snap, targets, docKeys])
}
