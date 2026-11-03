/**
 * SchemaBuilderView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { SchemaBuilderViewClient } from './SchemaBuilderViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const SchemaBuilderView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'SchemaBuilderView', <SchemaBuilderViewClient />)

export default SchemaBuilderView
