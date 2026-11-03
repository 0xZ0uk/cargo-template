/**
 * PerformanceView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { PerformanceViewClient } from './PerformanceViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const PerformanceView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'PerformanceView', <PerformanceViewClient />)

export default PerformanceView
