/** Payload's Lexical rich-text JSON, typed loosely, with one walker for every transform. */

export interface LexicalNode {
  type: string
  children?: LexicalNode[]
  text?: string
  [key: string]: unknown
}

export interface LexicalState {
  root: LexicalNode
  [key: string]: unknown
}

export const isLexicalState = (value: unknown): value is LexicalState =>
  !!value &&
  typeof value === 'object' &&
  !!(value as { root?: unknown }).root &&
  typeof (value as { root: unknown }).root === 'object'

/**
 * Map every node of a rich-text value (depth first, children before the parent
 * sees them). Nodes `fn` returns unchanged are shared; non-Lexical values pass
 * through untouched.
 */
export function mapLexical<T>(value: T, fn: (node: LexicalNode) => LexicalNode): T {
  if (!isLexicalState(value)) return value
  const walk = (node: LexicalNode): LexicalNode => {
    const children = Array.isArray(node.children) ? node.children.map(walk) : undefined
    const withChildren =
      children && children.some((c, i) => c !== node.children?.[i]) ? { ...node, children } : node
    return fn(withChildren)
  }
  const root = walk(value.root)
  return root === value.root ? value : { ...value, root }
}

/** Visit every node (depth first). */
export function eachLexicalNode(value: unknown, fn: (node: LexicalNode) => void): void {
  if (!isLexicalState(value)) return
  const walk = (node: LexicalNode) => {
    fn(node)
    node.children?.forEach(walk)
  }
  walk(value.root)
}
