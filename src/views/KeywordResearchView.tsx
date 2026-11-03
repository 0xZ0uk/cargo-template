/**
 * KeywordResearchView — Server component wrapper.
 */

import type { AdminViewServerProps } from 'payload'
import type React from 'react'
import { KeywordResearchViewClient } from './KeywordResearchViewClient.js'
import { renderSeoAdminView } from './adminViewShell.js'

export const KeywordResearchView: React.FC<AdminViewServerProps> = (props) =>
  renderSeoAdminView(props, 'KeywordResearchView', <KeywordResearchViewClient />)

export default KeywordResearchView
