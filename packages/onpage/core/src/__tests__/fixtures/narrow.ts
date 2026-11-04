import type { FieldOf, SchemaField } from '../../schema.ts'

/** Test helper: assert a field's kind (failing loudly otherwise) and narrow its type. */
export function narrow<T extends SchemaField['type']>(
  field: SchemaField | undefined,
  type: T,
): FieldOf<T> {
  if (field?.type !== type)
    throw new Error(`expected a ${type} field, got ${field?.type ?? 'nothing'}`)
  return field as FieldOf<T>
}
