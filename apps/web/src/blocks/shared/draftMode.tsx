import React, { createContext, useContext } from 'react'

const DraftModeContext = createContext(false)

/**
 * Whether the page is shown as a draft (live preview, on-page editing, a preview link) or in
 * the `/dev/blocks` gallery. Blocks use it to show editor-only hints, such as an empty
 * placeholder, that visitors must never see.
 */
export const DraftModeProvider: React.FC<{ children: React.ReactNode; draft: boolean }> = ({
  children,
  draft,
}) => <DraftModeContext.Provider value={draft}>{children}</DraftModeContext.Provider>

export const useDraftMode = () => useContext(DraftModeContext)
