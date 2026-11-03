/**
 * SeoView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { SeoViewClient } from './SeoViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const SeoView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'SeoView', <SeoViewClient />)

export default SeoView
