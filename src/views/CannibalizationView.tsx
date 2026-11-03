/**
 * CannibalizationView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { CannibalizationViewClient } from './CannibalizationViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const CannibalizationView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'CannibalizationView', <CannibalizationViewClient />)

export default CannibalizationView
