'use client'

/**
 * Panels loaded on first use (see ../OnDemand.tsx), so the editor's first
 * download stays small. Prefetched when the browser is idle.
 */
import { useOnPage } from '../../context.tsx'
import { BlockPicker } from './BlockPicker.tsx'
import { CommentsPanel } from './CommentsPanel.tsx'
import { PublishPanel } from './PublishPanel.tsx'
import { SaveSectionPanel } from './SaveSectionPanel.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'
import { VersionsPanel } from './VersionsPanel.tsx'

export function OnDemandPanel() {
  const { panel } = useOnPage()
  switch (panel?.kind) {
    case 'publish':
      return <PublishPanel />
    case 'versions':
      return <VersionsPanel />
    case 'comments':
      return <CommentsPanel />
    case 'saveSection':
      return <SaveSectionPanel />
    case 'blocks':
      return <BlockPicker />
    case 'settings':
    case 'page':
      return <SettingsPanel />
    default:
      return null
  }
}

export default OnDemandPanel
