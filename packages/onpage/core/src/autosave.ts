/**
 * Debounced, single-flight autosave. Patches scheduled while a save is in
 * flight are merged and sent once it settles, so the server always ends with
 * the latest value of every field. A conflict (409) freezes the queue until
 * `reset()`. Transient failures (network, 429, 5xx) retry with backoff; other
 * failures (validation, permissions) stop immediately with the server's message.
 */
import type { FieldError, SaveResult } from './ports.ts'
import { errorText } from './util.ts'

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict'

export interface SaveState {
  status: SaveStatus
  lastSavedAt?: number | undefined
  message?: string | undefined
  /** The fields the last failed save's validation error named. */
  fields?: FieldError[] | undefined
  /** Increments with every successful save. */
  seq: number
}

export interface AutosaveOptions {
  send: (patch: Record<string, unknown>) => Promise<SaveResult>
  delay?: number
  retries?: number
  onState?: (state: SaveState) => void
  /** Injected for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const isTransient = (status: number | undefined) => !status || status === 429 || status >= 500

export class AutosaveQueue {
  private pending: Record<string, unknown> | null = null
  /** The changes a conflict stopped, kept so the editor can re-apply them on the latest version. */
  private conflicted: Record<string, unknown> | null = null
  private timer: unknown = null
  private inFlight: Promise<void> | null = null
  private attempt = 0
  private state: SaveState = { status: 'idle', seq: 0 }
  private readonly delay: number
  private readonly retries: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly opts: AutosaveOptions) {
    this.delay = opts.delay ?? 800
    this.retries = opts.retries ?? 3
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  get current(): SaveState {
    return this.state
  }

  get hasPending(): boolean {
    return this.pending !== null || this.inFlight !== null
  }

  private setState(next: Partial<SaveState>) {
    this.state = { ...this.state, ...next }
    this.opts.onState?.(this.state)
  }

  /** Queue fields to save; later values for the same key replace earlier ones. */
  schedule(patch: Record<string, unknown>) {
    if (this.state.status === 'conflict') {
      this.conflicted = { ...(this.conflicted ?? {}), ...patch }
      return
    }
    this.pending = { ...(this.pending ?? {}), ...patch }
    this.setState({ status: this.inFlight ? 'saving' : 'pending' })
    this.arm(this.delay)
  }

  private arm(ms: number) {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.flush()
    }, ms)
  }

  /** Send now (also used before publishing). Resolves when idle. */
  async flush(): Promise<void> {
    if (this.timer) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    if (this.inFlight) {
      await this.inFlight
      if (this.pending) return this.flush()
      return
    }
    if (!this.pending || this.state.status === 'conflict') return
    const patch = this.pending
    this.pending = null
    this.setState({ status: 'saving' })
    this.inFlight = (async () => {
      let result: SaveResult
      try {
        result = await this.opts.send(patch)
      } catch (err) {
        result = { ok: false, status: 0, message: errorText(err) }
      }
      this.inFlight = null
      if (result.ok) {
        this.attempt = 0
        this.setState({
          status: this.pending ? 'pending' : 'saved',
          lastSavedAt: Date.now(),
          message: undefined,
          fields: undefined,
          seq: this.state.seq + 1,
        })
        if (this.pending) this.arm(0)
        return
      }
      if (result.status === 409) {
        this.conflicted = { ...patch, ...(this.pending ?? {}) }
        this.pending = null
        this.setState({ status: 'conflict', message: result.message })
        return
      }
      // Put the failed patch back underneath anything newer.
      this.pending = { ...patch, ...(this.pending ?? {}) }
      if (isTransient(result.status) && this.attempt < this.retries) {
        this.attempt += 1
        this.setState({ status: 'pending', message: result.message })
        this.arm(1000 * 2 ** (this.attempt - 1))
      } else {
        this.attempt = 0
        this.setState({
          status: 'error',
          message: result.message ?? `Save failed (${result.status})`,
          fields: result.fields,
        })
      }
    })()
    await this.inFlight
  }

  /** Clear a conflict or error (after the caller reloaded the document). Drops unsent changes. */
  reset() {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    this.pending = null
    this.conflicted = null
    this.attempt = 0
    this.setState({ status: 'idle', message: undefined, fields: undefined })
  }

  /** The top-level fields a conflict kept from saving (null without a conflict). */
  get unsaved(): Readonly<Record<string, unknown>> | null {
    return this.state.status === 'conflict' ? this.conflicted : null
  }

  /** Retry after an error, keeping the unsent changes. */
  retry() {
    if (this.state.status !== 'error') return
    this.attempt = 0
    this.arm(0)
  }

  /** Stop timers (unmount). Unsent changes are dropped; call flush() first to keep them. */
  dispose() {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
  }
}
