/**
 * SeoConfigView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { SeoConfigViewClient } from './SeoConfigViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const SeoConfigView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'SeoConfigView', <SeoConfigViewClient />)

export default SeoConfigView
