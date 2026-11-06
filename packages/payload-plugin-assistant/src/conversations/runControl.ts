/** How long a stopped run may take to wind down before its stream is cut. */
export const STOP_GRACE_MS = 10_000;

/**
 * The two ways a live run ends early, kept apart:
 *
 * - **Stop** (the user's button): aborts the runner's `signal`. The turn runner aborts `chat()`
 *   and ends its stream with a `RUN_ERROR` (`code: "stopped"`), which still goes through the
 *   durable log, so the viewer and any rejoin see why it ended. A runner that ignores the signal
 *   gets its stream cut after {@link STOP_GRACE_MS}.
 * - **Kill** (the conversation is deleted): aborts the signal and cuts the stream at once.
 *
 * A closed tab is neither: the run goes on.
 */
export class RunControl {
  private readonly stopController = new AbortController();
  /** For `toServerSentEventsResponse({ abortController })`: aborting it stops pumping the stream. */
  readonly pipe = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The runner's signal (`TurnContext.signal`). */
  get signal(): AbortSignal {
    return this.stopController.signal;
  }

  stop(): void {
    if (this.stopController.signal.aborted) return;
    this.stopController.abort();
    this.timer = setTimeout(() => this.pipe.abort(), STOP_GRACE_MS);
  }

  kill(): void {
    this.stopController.abort();
    this.pipe.abort();
    this.done();
  }

  /** The run ended: drop the grace timer. */
  done(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
