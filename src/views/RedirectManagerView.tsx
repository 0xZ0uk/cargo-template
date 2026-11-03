/**
 * RedirectManagerView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { RedirectManagerViewClient } from './RedirectManagerViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const RedirectManagerView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'RedirectManagerView', <RedirectManagerViewClient />)

export default RedirectManagerView
