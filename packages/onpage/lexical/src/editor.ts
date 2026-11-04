/** The rich-text editor component and its Lexical nodes (statically imported; prefer `lexicalEditors` for lazy loading). */
export { InlineRichText, RICH_TEXT_NODES } from './InlineRichText.tsx'
export {
  PayloadLinkNode,
  OpaqueNode,
  $createPayloadLinkNode,
  $isPayloadLinkNode,
  describeNode,
  type OpaqueData,
} from './nodes.tsx'
