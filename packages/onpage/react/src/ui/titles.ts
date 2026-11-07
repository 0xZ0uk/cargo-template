import { stegaClean, type DocumentState } from '@shipment/onpage-core'

/** A document's name for headings and lists: its title field, else its type. */
export function docTitle(state: DocumentState): string {
  const field = state.schema?.useAsTitle
  const titled = field ? state.doc?.[field] : undefined
  return typeof titled === 'string' && titled
    ? stegaClean(titled)
    : (state.schema?.labels.singular ?? state.ref.slug)
}
