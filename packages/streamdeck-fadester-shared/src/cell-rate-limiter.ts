// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Milliseconds on a clock that only runs forward. Pacing (so long since the last draw or write, so far into a fade)
 * is measured on it: the wall clock can be set back (a time sync after start or resume), and an interval measured
 * across that step is negative, which held redraws and writes back for the size of the step.
 */
export function monotonicNow(): number {
  return performance.now();
}

/**
 * The clock a control paces its draws on: its own clock when a test gave it one, and the monotonic clock when it runs
 * on the wall clock (`Date.now`, the controls' default, which they still use for what is not pacing).
 */
export function pacingClock(clock: () => number): () => number {
  return clock === Date.now ? monotonicNow : clock;
}

/** Equal pictures: the same string, or (a feedback object) the same content. */
function samePayload(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Paces one key's or dial's draws: at most one per interval, the newest last. It also remembers the picture it sent
 * last and does not send an equal one again: the controls redraw on every OBS state event (a volume step, a T-bar
 * write), and most of those change nothing a key shows. One limiter serves one appearance of one control (a control
 * that appears again builds a new one), so a key Stream Deck has just shown always gets its first picture.
 */
export class CellRateLimiter<TPayload> {
  private readonly minIntervalMs: number;
  private readonly onFlush: (payload: TPayload) => void | Promise<void>;
  private readonly clock: () => number;
  private lastFlushTime = -Infinity;
  private pendingPayload: TPayload | undefined;
  private hasPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The picture sent last; null before the first, after a draw that failed and after dispose. */
  private lastSent: { payload: TPayload } | null = null;

  public constructor(
    onFlush: (payload: TPayload) => void | Promise<void>,
    minIntervalMs = 100,
    clock: () => number = monotonicNow
  ) {
    this.onFlush = onFlush;
    this.minIntervalMs = Math.max(16, minIntervalMs);
    this.clock = pacingClock(clock);
  }

  public push(payload: TPayload, now = this.clock()): void {
    // What the key already shows, with nothing newer waiting: nothing to send, and no interval used up.
    if (!this.hasPending && this.lastSent && samePayload(this.lastSent.payload, payload)) {
      return;
    }
    const elapsed = now - this.lastFlushTime;
    if (elapsed >= this.minIntervalMs && this.timer === null) {
      this.lastFlushTime = now;
      this.hasPending = false;
      this.pendingPayload = undefined;
      this.flush(payload);
      return;
    }

    this.pendingPayload = payload;
    this.hasPending = true;
    if (this.timer === null) {
      // Never longer than one interval, whatever clock the caller's `now` came from.
      const waitMs = Math.min(this.minIntervalMs, Math.max(1, this.minIntervalMs - elapsed));
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.hasPending && this.pendingPayload !== undefined) {
          const toSend = this.pendingPayload;
          this.pendingPayload = undefined;
          this.hasPending = false;
          // Back to the picture already shown (it changed and changed back within one interval): nothing to send.
          if (this.lastSent && samePayload(this.lastSent.payload, toSend)) return;
          this.lastFlushTime = this.clock();
          this.flush(toSend);
        }
      }, waitMs);
    }
  }

  /** A draw that fails is dropped: the next push draws again, and a throw from the timer would end the process. */
  private flush(payload: TPayload): void {
    const sent = { payload };
    this.lastSent = sent;
    // A picture that did not arrive is not what the key shows: the same picture pushed again is sent again.
    const failed = (): void => {
      if (this.lastSent === sent) this.lastSent = null;
    };
    try {
      Promise.resolve(this.onFlush(payload)).catch(failed);
    } catch {
      failed();
    }
  }

  public dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.hasPending = false;
    this.pendingPayload = undefined;
    this.lastSent = null;
  }
}
