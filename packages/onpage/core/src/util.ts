/** Small type-level and error helpers shared by every package. */

/** A thrown value's message (anything can be thrown, not only `Error`s). */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Exhaustiveness check: call in the `default` of a switch over a union. Adding a
 * member to the union then fails to compile until every switch handles it.
 */
export function assertNever(value: never, what = 'value'): never {
  throw new Error(`Unexpected ${what}: ${JSON.stringify(value)}`)
}
