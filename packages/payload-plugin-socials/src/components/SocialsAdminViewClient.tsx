'use client'

import { Tabs, toast } from '@payloadcms/ui'
import React, { useEffect, useId, useState } from 'react'

import { SocialsDashboardWidget } from './SocialsDashboardWidget.js'
import { SocialPublishPanelClient } from './SourceSocialsPanelClient.js'
import './ui/styles.css'
import './socials.css'

type Props = {
  enabledPlatforms?: string[]
}

type Tab = 'compose' | 'connections'

/**
 * Two-tab client layout for the /admin/socials route:
 * - Compose: the standalone multi-channel composer
 * - Connections: the existing connection health widget
 */
export const SocialsAdminViewClient: React.FC<Props> = ({ enabledPlatforms }) => {
  const [activeTab, setActiveTab] = useState<Tab>('compose')
  const uid = useId()
  const tabId = (tab: Tab) => `${uid}-tab-${tab}`
  const panelId = `${uid}-panel`

  // Consume the one-shot OAuth callback marker without replaying it on reload.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    if (!connected) {
      return
    }
    setActiveTab('connections')
    // Capitalise the first letter for a friendlier toast message.
    const label = connected.charAt(0).toUpperCase() + connected.slice(1)
    toast.success(`${label} connected`)
    // Remove the ?connected param without adding a new history entry.
    params.delete('connected')
    const newSearch = params.toString()
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [])

  return (
    <div className="socials-stack">
      {/* Payload's Tabs takes no aria-label, so the group carries it (see #34). */}
      <div aria-label="Socials view" role="group">
        <Tabs<Tab>
          onChange={setActiveTab}
          tabs={[
            { id: tabId('compose'), label: 'Compose', panelID: panelId, value: 'compose' },
            { id: tabId('connections'), label: 'Connections', panelID: panelId, value: 'connections' },
          ]}
          value={activeTab}
        />
      </div>

      <div aria-labelledby={tabId(activeTab)} id={panelId} role="tabpanel">
        {activeTab === 'compose' && <SocialPublishPanelClient mode="standalone" />}
        {activeTab === 'connections' && (
          <SocialsDashboardWidget enabledPlatforms={enabledPlatforms} />
        )}
      </div>
    </div>
  )
}
