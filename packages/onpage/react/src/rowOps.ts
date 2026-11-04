/**
 * Row operations on array and blocks fields, with one set of rules (bounds,
 * `minRows`, `maxRows`) for the toolbar, the keyboard shortcuts, the block
 * picker and "+ Add". Each returns where the selection should go, or null when
 * the operation isn't allowed (nothing changes).
 */
import {
  cloneRow,
  insertItem,
  moveItem,
  removeItem,
  updateArray,
  type EditorSession,
  type RowInfo,
  type RefKey,
} from '@cargo/onpage-core'
import type { Selection } from './types.ts'

const rowAt = (key: RefKey, listPath: string, index: number): Selection => ({
  key,
  path: `${listPath}.${index}`,
})

/** Insert a row into the list at `listPath`; returns the new row's selection. */
export function insertRow(
  session: EditorSession,
  key: RefKey,
  listPath: string,
  index: number,
  row: unknown,
): Selection {
  session.apply(key, (d) => updateArray(d, listPath, (a) => insertItem(a, index, row)))
  return rowAt(key, listPath, index)
}

export function rowOps(session: EditorSession, key: RefKey, info: RowInfo) {
  const { listPath, index, length, rowFields, listField } = info
  const apply = (fn: (rows: unknown[]) => unknown[]) =>
    session.apply(key, (d) => updateArray(d, listPath, fn))
  const canMove = (dir: -1 | 1) => index + dir >= 0 && index + dir < length
  const canDuplicate = listField.maxRows === undefined || length < listField.maxRows
  const canRemove = length > (listField.minRows ?? 0)
  return {
    canMove,
    canDuplicate,
    canRemove,
    move(dir: -1 | 1): Selection | null {
      if (!canMove(dir)) return null
      apply((a) => moveItem(a, index, index + dir))
      return rowAt(key, listPath, index + dir)
    },
    /** Move the row to position `to` (drag and drop). */
    moveTo(to: number): Selection | null {
      if (!Number.isInteger(to) || to === index || to < 0 || to >= length) return null
      apply((a) => moveItem(a, index, to))
      return rowAt(key, listPath, to)
    },
    duplicate(): Selection | null {
      if (!canDuplicate) return null
      apply((a) => insertItem(a, index + 1, cloneRow(a[index], rowFields)))
      return rowAt(key, listPath, index + 1)
    },
    /** Removes the row; true when it did. */
    remove(): boolean {
      if (!canRemove) return false
      apply((a) => removeItem(a, index))
      return true
    },
  }
}
