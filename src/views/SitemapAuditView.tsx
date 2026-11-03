/**
 * SitemapAuditView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { SitemapAuditViewClient } from './SitemapAuditViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const SitemapAuditView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'SitemapAuditView', <SitemapAuditViewClient />)

export default SitemapAuditView
