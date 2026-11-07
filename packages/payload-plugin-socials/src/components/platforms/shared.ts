import type { SocialDraftMedia } from '../../types/index.js'
import type { ComposerDestination, ComposerState } from './types.js'

import { asRecord } from '../socialComposerViewModel.js'

/**
 * Parse a destination discovery response: take the platform's array out of the
 * body (`boards`, `pages`, `accounts`, `locations`), keep the rows that carry a
 * string id under `idField`, and label each with the first string among
 * name / pageName / title / storeCode, falling back to the id.
 */
export const parseDestinationResponse = (
  body: Record<string, unknown>,
  responseKey: string,
  idField: string,
): ComposerDestination[] => {
  const values = body[responseKey]
  const rows = Array.isArray(values)
    ? values.map(asRecord).filter((row): row is Record<string, unknown> => row !== undefined)
    : []
  return rows.flatMap((row) => {
    const idValue = row[idField]
    if (typeof idValue !== 'string') {
      return []
    }
    const label =
      [row.name, row.pageName, row.title, row.storeCode].find(
        (value): value is string => typeof value === 'string',
      ) ?? idValue
    return [{ id: idValue, label }]
  })
}

/**
 * Instagram and Facebook caption: the title becomes the first line. Skipped
 * when the message already begins with the title, so a hand-edited body that
 * repeats it is never doubled.
 */
export const captionWithTitle = (state: Pick<ComposerState, 'copy' | 'title'>): string => {
  if (state.title) {
    if (state.copy.trimStart().startsWith(state.title.trim()) && state.title.trim() !== '') {
      return state.copy
    }
    return state.copy ? `${state.title}\n\n${state.copy}` : state.title
  }
  return state.copy
}

export const firstOfType = (
  assets: SocialDraftMedia[],
  type: SocialDraftMedia['type'],
): SocialDraftMedia | undefined => assets.find((asset) => asset.type === type)
