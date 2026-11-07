/** Payload form state, for tests of the sidebar (which reads the edit form, flattened by path). */

export type FormState = Record<string, { value: unknown; disableFormData?: boolean }>

const isLexical = (v: unknown) =>
  !!v && typeof v === 'object' && 'root' in (v as Record<string, unknown>)

/** Flatten a document into form state the way Payload's admin form holds it. */
export function toFormState(value: unknown, path = '', state: FormState = {}): FormState {
  if (Array.isArray(value)) {
    // Array and blocks fields hold their row count and are left out of form data.
    if (path) state[path] = { value: value.length, disableFormData: true }
    value.forEach((row, i) => toFormState(row, path ? `${path}.${i}` : String(i), state))
  } else if (value && typeof value === 'object' && !isLexical(value)) {
    for (const [key, child] of Object.entries(value)) {
      toFormState(child, path ? `${path}.${key}` : key, state)
    }
  } else if (path) {
    state[path] = { value }
  }
  return state
}
