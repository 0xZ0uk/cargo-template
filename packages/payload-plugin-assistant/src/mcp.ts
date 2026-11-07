/**
 * `@cargo/payload-plugin-assistant/mcp`: plugin-mcp items for rich text as Markdown (#67). A
 * separate entry so the plugin itself never imports `@cargo/payload-plugin-mcp` (an optional peer).
 */
export {
  describeRichTextAsMarkdown,
  richTextAsMarkdown,
  richTextResultsAsMarkdown,
  richTextSchemaAsMarkdown,
  SET_RICH_TEXT_TOOL_NAME,
  setRichTextFromMarkdownTool,
  withMarkdownRichText,
} from "./richText/tool";
export {
  internalLinkUrl,
  INTERNAL_LINK_SCHEME,
  markdownLosses,
  parseInternalLinkUrl,
  RichTextPathError,
  unsupportedMarkdown,
} from "./richText/fields";
