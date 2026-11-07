import { isReady } from '@shipment/onpage-core'
import { useOnPage } from '../context.tsx'
import { settable } from '../settings.ts'

/** The page's documents that have settings, with their top-level settable fields. */
export function usePageSettings() {
  const { snap, docKeys, targets } = useOnPage()
  return docKeys
    .map((key) => snap.docs[key])
    .filter(isReady)
    .map((state) => ({
      state,
      fields: state.schema.fields.filter(
        (f) => state.schema.editable.includes(f.name) && settable(f, '', state.key, targets),
      ),
    }))
    .filter((d) => d.fields.length)
}
