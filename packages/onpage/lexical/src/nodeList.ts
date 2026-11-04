/** The node classes the inline editor registers (no React UI imported here). */
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { OpaqueNode, PayloadLinkNode } from './nodes.tsx'

export const RICH_TEXT_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  PayloadLinkNode,
  OpaqueNode,
]
