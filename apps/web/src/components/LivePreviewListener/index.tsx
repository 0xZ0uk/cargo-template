import { RefreshRouteOnSave } from '@payloadcms/live-preview-react'
import { useRouter } from '@tanstack/react-router'
import React from 'react'

/** Reloads the route's data whenever the document is saved in the admin's live preview. */
export const LivePreviewListener: React.FC = () => {
  const router = useRouter()

  return (
    <RefreshRouteOnSave
      refresh={() => router.invalidate()}
      serverURL={typeof window === 'undefined' ? '' : window.location.origin}
    />
  )
}
