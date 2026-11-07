import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkersLogger } from '@/utilities/workersLogger'

type Entry = Record<string, unknown>
type ErrorFields = { name: string; message: string; stack: string; cause: ErrorFields }

let lines: { method: string; entry: Entry }[]

beforeEach(() => {
  lines = []
  for (const method of ['debug', 'error', 'log', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((line: string) => {
      lines.push({ method, entry: JSON.parse(line) })
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

const entries = () => lines.map((l) => l.entry)

describe('createWorkersLogger', () => {
  it('writes one JSON line per entry, ordered level, bindings, fields, msg', () => {
    const logger = createWorkersLogger({ bindings: { app: 'shipment' } })
    logger.info({ msg: 'ignored', userID: 7 }, 'hello')

    expect(lines).toHaveLength(1)
    expect(Object.keys(lines[0].entry)).toEqual(['level', 'app', 'userID', 'msg'])
    expect(lines[0].entry).toEqual({ level: 'info', app: 'shipment', userID: 7, msg: 'hello' })
  })

  it('accepts the string form and the object form', () => {
    const logger = createWorkersLogger()
    logger.info('plain')
    logger.info({ a: 1 }, 'with fields')
    logger.info({ a: 2, msg: 'msg in object' })
    logger.info({ a: 3 })

    expect(entries()).toEqual([
      { level: 'info', msg: 'plain' },
      { level: 'info', a: 1, msg: 'with fields' },
      { level: 'info', a: 2, msg: 'msg in object' },
      { level: 'info', a: 3 },
    ])
  })

  it('keeps its own level and msg over same-named fields', () => {
    const logger = createWorkersLogger()
    logger.warn({ level: 'bogus', msg: 'from fields' })

    expect(entries()).toEqual([{ level: 'warn', msg: 'from fields' }])
  })

  it('routes levels to console methods', () => {
    const logger = createWorkersLogger({ level: 'trace' })
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      logger[level]('x')
    }

    expect(lines.map((l) => [l.entry.level, l.method])).toEqual([
      ['trace', 'debug'],
      ['debug', 'debug'],
      ['info', 'log'],
      ['warn', 'warn'],
      ['error', 'error'],
      ['fatal', 'error'],
    ])
  })

  describe('levels', () => {
    it('drops entries below the level', () => {
      const logger = createWorkersLogger({ level: 'warn' })
      logger.trace('t')
      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')
      logger.fatal('f')

      expect(entries().map((e) => e.msg)).toEqual(['w', 'e', 'f'])
    })

    it('defaults to info', () => {
      const logger = createWorkersLogger()
      logger.debug('d')
      logger.info('i')

      expect(entries().map((e) => e.msg)).toEqual(['i'])
    })

    it('respects `level` changed after creation', () => {
      const logger = createWorkersLogger({ level: 'error' })
      logger.warn('before')
      logger.level = 'debug'
      logger.debug('after')

      expect(entries().map((e) => e.msg)).toEqual(['after'])
    })

    it('emits nothing at `silent`, and `silent()` is a no-op', () => {
      const logger = createWorkersLogger({ level: 'silent' })
      logger.fatal('f')
      logger.silent('s')

      expect(lines).toHaveLength(0)
    })

    it('reports isLevelEnabled', () => {
      const logger = createWorkersLogger({ level: 'warn' })

      expect(logger.isLevelEnabled('info')).toBe(false)
      expect(logger.isLevelEnabled('warn')).toBe(true)
      expect(logger.isLevelEnabled('fatal')).toBe(true)
    })
  })

  describe('child', () => {
    it('composes bindings and msgPrefix across two levels of children', () => {
      const root = createWorkersLogger({ bindings: { app: 'shipment' } })
      const mcp = root.child({ plugin: 'mcp' }, { msgPrefix: '[plugin-mcp] ' })
      const tool = mcp.child({ tool: 'find' }, { msgPrefix: '[find] ' })

      root.info('root')
      mcp.info({ id: 1 }, 'mcp')
      tool.info({ id: 2 }, 'tool')

      expect(entries()).toEqual([
        { level: 'info', app: 'shipment', msg: 'root' },
        { level: 'info', app: 'shipment', plugin: 'mcp', id: 1, msg: '[plugin-mcp] mcp' },
        {
          level: 'info',
          app: 'shipment',
          plugin: 'mcp',
          tool: 'find',
          id: 2,
          msg: '[plugin-mcp] [find] tool',
        },
      ])
      expect(Object.keys(lines[2].entry)).toEqual(['level', 'app', 'plugin', 'tool', 'id', 'msg'])
    })

    it('lets a child binding override its parent, without touching the parent', () => {
      const parent = createWorkersLogger({ bindings: { plugin: 'a' } })
      const child = parent.child({ plugin: 'b' })
      parent.info('p')
      child.info('c')

      expect(entries()).toEqual([
        { level: 'info', plugin: 'a', msg: 'p' },
        { level: 'info', plugin: 'b', msg: 'c' },
      ])
    })

    it('works without bindings or options', () => {
      const child = createWorkersLogger().child({})
      child.info('x')

      expect(entries()).toEqual([{ level: 'info', msg: 'x' }])
    })

    it('inherits the parent level, then has its own', () => {
      const parent = createWorkersLogger({ level: 'error' })
      const child = parent.child({ plugin: 'mcp' })
      const grandchild = child.child({ tool: 'x' })

      expect(child.level).toBe('error')
      expect(grandchild.level).toBe('error')

      // plugin-mcp's getLogger does exactly this.
      child.level = 'debug'
      child.debug('child debug')
      parent.debug('parent debug')
      grandchild.debug('grandchild debug')
      expect(entries().map((e) => e.msg)).toEqual(['child debug'])
      expect(parent.level).toBe('error')

      // A child created later starts from the parent's current level.
      parent.level = 'info'
      expect(parent.child({}).level).toBe('info')
      expect(child.child({}).level).toBe('debug')
    })
  })

  describe('errors', () => {
    it('serialises name, message, stack and cause', () => {
      const logger = createWorkersLogger()
      const cause = new RangeError('root cause')
      logger.error({ err: new TypeError('boom', { cause }) }, 'failed')

      const { err } = lines[0].entry as { err: ErrorFields }
      expect(err.name).toBe('TypeError')
      expect(err.message).toBe('boom')
      expect(err.stack).toContain('TypeError: boom')
      expect(err.cause.name).toBe('RangeError')
      expect(err.cause.message).toBe('root cause')
      expect(err.cause.stack).toContain('RangeError: root cause')
      expect(lines[0].entry.msg).toBe('failed')
    })

    it('serialises errors nested anywhere in the fields', () => {
      const logger = createWorkersLogger()
      logger.error({ results: [{ ok: false, error: new Error('deep') }] }, 'nested')

      const { results } = lines[0].entry as { results: { error: Record<string, unknown> }[] }
      expect(results[0].error).toMatchObject({ name: 'Error', message: 'deep' })
    })

    it('serialises errors in child bindings', () => {
      const child = createWorkersLogger().child({ lastError: new Error('bound') })
      child.warn('x')

      expect((lines[0].entry.lastError as Record<string, unknown>).message).toBe('bound')
    })

    it('takes a bare Error as the first argument, like pino', () => {
      const logger = createWorkersLogger()
      logger.error(new Error('bare'))
      logger.error(new Error('bare'), 'custom message')

      expect(lines[0].entry).toMatchObject({ err: { message: 'bare' }, msg: 'bare' })
      expect(lines[1].entry).toMatchObject({ err: { message: 'bare' }, msg: 'custom message' })
    })

    it('does not throw on circular references', () => {
      const logger = createWorkersLogger()
      const circular: Record<string, unknown> = { name: 'loop' }
      circular.self = circular

      expect(() => logger.info({ circular, big: 1n }, 'x')).not.toThrow()
      expect(lines[0].entry).toMatchObject({
        circular: { name: 'loop', self: '[Circular]' },
        big: '1',
        msg: 'x',
      })
    })
  })
})
