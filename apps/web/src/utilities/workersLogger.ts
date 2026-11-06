import type { PayloadLogger } from 'payload'

/**
 * Payload's default pino logger doesn't suit Workers. This one writes one JSON line per
 * entry so Workers Logs can index the fields, and implements the slice of pino's API that
 * Payload and its plugins call: the level methods, `level`, `silent`, `isLevelEnabled` and
 * `child(bindings, { msgPrefix })` (plugin-mcp's `getLogger` calls it on every request and
 * then sets `.level` on the child).
 */

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
type Level = (typeof LEVELS)[number]

// Console method per level, looked up at call time so the runtime (and tests) can swap them.
const CONSOLE_METHOD: Record<Level, 'debug' | 'error' | 'info' | 'log' | 'warn'> = {
  debug: 'debug',
  error: 'error',
  fatal: 'error',
  info: 'log',
  trace: 'debug',
  warn: 'warn',
}

type Fields = Record<string, unknown>

export type WorkersLoggerOptions = {
  /** Fields added to every entry. */
  bindings?: Fields
  /** Minimum level to emit: `trace`…`fatal`, or `silent` for none. Defaults to `info`. */
  level?: string
  /** Prepended to every `msg`. */
  msgPrefix?: string
}

/** Rank of a level name; `silent` outranks everything. Unknown names behave like `info`. */
const rank = (level: string): number => {
  if (level === 'silent') return LEVELS.length
  const index = LEVELS.indexOf(level as Level)
  return index === -1 ? LEVELS.indexOf('info') : index
}

const serialiseError = (error: Error): Fields => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
  cause: error.cause,
})

// Errors have no enumerable own properties, so JSON.stringify turns them into `{}`.
// `cause` is returned as-is and visited by the same replacer, so chains serialise too.
const replaceError = (_key: string, value: unknown) =>
  value instanceof Error ? serialiseError(value) : value

const stringify = (entry: Fields): string => {
  try {
    return JSON.stringify(entry, replaceError)
  } catch {
    // Circular references or BigInts: a logger must never throw, so degrade instead.
    const seen = new WeakSet<object>()
    return JSON.stringify(entry, (key, value) => {
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return replaceError(key, value)
    })
  }
}

const emit = (
  level: Level,
  bindings: Fields,
  msgPrefix: string,
  objectOrMessage: unknown,
  message?: string,
) => {
  let fields: Fields = {}
  let msg: string | undefined

  if (typeof objectOrMessage === 'string') {
    msg = objectOrMessage
  } else if (objectOrMessage instanceof Error) {
    // pino's `logger.error(err)` form.
    fields = { err: objectOrMessage }
    msg = message ?? objectOrMessage.message
  } else if (typeof objectOrMessage === 'object' && objectOrMessage !== null) {
    fields = objectOrMessage as Fields
    msg = message ?? (typeof fields.msg === 'string' ? fields.msg : undefined)
  }

  // Order: level, bindings, fields, msg. Our `level` and `msg` win over same-named fields.
  const entry: Fields = { level, ...bindings, ...fields }
  entry.level = level
  delete entry.msg
  if (msg !== undefined) entry.msg = msgPrefix + msg

  console[CONSOLE_METHOD[level]](stringify(entry))
}

const create = ({
  bindings = {},
  level = 'info',
  msgPrefix = '',
}: WorkersLoggerOptions = {}): PayloadLogger => {
  const logger: Record<string, unknown> = {
    level,
    silent: () => undefined,
    isLevelEnabled: (name: string) => rank(name) >= rank(String(logger.level)),
    child: (childBindings: Fields = {}, options: { msgPrefix?: string } = {}) =>
      // The child starts at the parent's current level, then has its own.
      create({
        bindings: { ...bindings, ...childBindings },
        level: String(logger.level),
        msgPrefix: msgPrefix + (options.msgPrefix ?? ''),
      }),
  }

  for (const name of LEVELS) {
    logger[name] = (objectOrMessage: unknown, message?: string) => {
      if (rank(name) < rank(String(logger.level))) return
      emit(name, bindings, msgPrefix, objectOrMessage, message)
    }
  }

  return logger as unknown as PayloadLogger
}

export const createWorkersLogger = (options?: WorkersLoggerOptions): PayloadLogger =>
  create(options)
