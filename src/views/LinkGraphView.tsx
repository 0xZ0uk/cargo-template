/**
 * LinkGraphView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { LinkGraphViewClient } from './LinkGraphViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const LinkGraphView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'LinkGraphView', <LinkGraphViewClient />)

export default LinkGraphView
