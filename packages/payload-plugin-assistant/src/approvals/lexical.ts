/**
 * Lexical editor state → readable text with light Markdown (headings, lists, quotes), for the
 * approval card. Never shows the JSON. Deliberately small: the card needs to read, not to
 * round-trip; `@payloadcms/richtext-lexical`'s converters need the editor config and the server.
 */

interface LexicalNode {
  type?: unknown;
  text?: unknown;
  tag?: unknown;
  listType?: unknown;
  checked?: unknown;
  children?: unknown;
  fields?: unknown;
  value?: unknown;
  relationTo?: unknown;
  url?: unknown;
}

/** `{ root: { type: "root", children: [...] } }`: a Lexical editor state. */
export function isLexicalState(value: unknown): value is { root: LexicalNode } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = (value as { root?: unknown }).root;
  return Boolean(
    root &&
    typeof root === "object" &&
    (root as LexicalNode).type === "root" &&
    Array.isArray((root as LexicalNode).children)
  );
}

const childrenOf = (node: LexicalNode): LexicalNode[] =>
  Array.isArray(node.children) ? (node.children as LexicalNode[]).filter((c) => c && typeof c === "object") : [];

const idOf = (value: unknown): string | undefined => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as { id?: unknown; title?: unknown; filename?: unknown };
    for (const candidate of [record.title, record.filename, record.id]) {
      if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
    }
  }
  return undefined;
};

/** The inline text of a node: text, line breaks, tabs, links (their text). */
function inline(node: LexicalNode): string {
  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "linebreak":
      return "\n";
    case "tab":
      return "\t";
    case "inlineBlock": {
      const fields = (node.fields ?? {}) as { blockType?: unknown };
      return `[${typeof fields.blockType === "string" ? fields.blockType : "block"}]`;
    }
    default:
      return childrenOf(node).map(inline).join("");
  }
}

function list(node: LexicalNode, depth: number): string[] {
  const lines: string[] = [];
  let index = 1;
  for (const item of childrenOf(node)) {
    const nested = childrenOf(item).filter((c) => c.type === "list");
    const own = childrenOf(item).filter((c) => c.type !== "list");
    if (own.length || !nested.length) {
      const marker =
        node.listType === "number" ? `${index}.` : node.listType === "check" ? (item.checked ? "- [x]" : "- [ ]") : "-";
      lines.push(`${"  ".repeat(depth)}${marker} ${own.map(inline).join("").trim()}`);
      index += 1;
    }
    for (const sub of nested) lines.push(...list(sub, depth + 1));
  }
  return lines;
}

function block(node: LexicalNode): string | undefined {
  switch (node.type) {
    case "heading": {
      const level = typeof node.tag === "string" ? Number(node.tag.replace(/\D/g, "")) || 1 : 1;
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline(node).trim()}`;
    }
    case "list":
      return list(node, 0).join("\n");
    case "quote":
      return inline(node)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "code":
      return `\`\`\`\n${inline(node)}\n\`\`\``;
    case "horizontalrule":
      return "---";
    case "upload": {
      const id = idOf(node.value);
      return `[${typeof node.relationTo === "string" ? node.relationTo : "upload"}${id ? `: ${id}` : ""}]`;
    }
    case "relationship": {
      const id = idOf(node.value);
      return `[${typeof node.relationTo === "string" ? node.relationTo : "link"}${id ? `: ${id}` : ""}]`;
    }
    case "block": {
      const fields = (node.fields ?? {}) as { blockType?: unknown; blockName?: unknown };
      const name = typeof fields.blockName === "string" && fields.blockName ? ` "${fields.blockName}"` : "";
      return `[${typeof fields.blockType === "string" ? fields.blockType : "block"} block${name}]`;
    }
    default: {
      const text = inline(node);
      return text.trim() ? text : undefined;
    }
  }
}

/** Readable text of a Lexical editor state; `""` when it has no content. */
export function lexicalToText(state: unknown): string {
  if (!isLexicalState(state)) return "";
  return childrenOf(state.root)
    .map(block)
    .filter((b): b is string => b !== undefined && b.trim() !== "")
    .join("\n\n");
}
