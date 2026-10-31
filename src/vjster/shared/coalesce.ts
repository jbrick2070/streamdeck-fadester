// SPDX-License-Identifier: GPL-2.0-or-later
// VJster coalescing (docs/vjster/REQUIREMENTS.md R-BEH-3, PLAN.md 3.6).
//
// Fast dial turns produce many values; the page gets at most one per interval
// and always the last one. The first value after a quiet interval goes out at
// once, so a single notch feels immediate.

export const DEFAULT_COALESCE_MS = 50;

/** The timer functions the coalescer uses; tests pass fakes. */
export interface CoalesceClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * The host's clock: `performance.now()`, which never steps backward, where it
 * exists (Node, browsers, service workers), else `Date.now()`.
 */
export const realClock: CoalesceClock = {
  now: () => (typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now()),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

export interface Coalescer<T> {
  /** Offer a value; it is sent now or replaces the value waiting to be sent. */
  push(value: T): void;
  /** Send the waiting value now, if there is one. */
  flush(): void;
  /** Drop the waiting value and stop the timer; the spacing from the last send still applies. */
  cancel(): void;
  /** Whether a value is waiting. */
  readonly pending: boolean;
}

/**
 * Last-value-wins throttle: `send` runs at most once per `intervalMs`, the
 * first value of a burst is sent at once, and the last value of every burst is
 * always sent within `intervalMs`, even if the clock steps backward. A `send`
 * that pushes again is throttled like any other push.
 */
export function createCoalescer<T>(
  send: (value: T) => void,
  intervalMs: number = DEFAULT_COALESCE_MS,
  clock: CoalesceClock = realClock
): Coalescer<T> {
  if (!(intervalMs > 0) || !Number.isFinite(intervalMs)) throw new RangeError(`intervalMs must be positive, got ${intervalMs}`);
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let waiting: { value: T } | null = null;
  let timer: unknown = null;

  const sendNow = (value: T): void => {
    lastSentAt = clock.now();
    send(value);
  };

  const fire = (): void => {
    timer = null;
    if (waiting) {
      const { value } = waiting;
      waiting = null;
      sendNow(value);
    }
  };

  return {
    push(value: T): void {
      const since = clock.now() - lastSentAt;
      if (timer === null && since >= intervalMs) {
        sendNow(value);
        return;
      }
      waiting = { value };
      // A clock that stepped backward makes `since` negative; the cap keeps the wait within one interval.
      if (timer === null) timer = clock.setTimeout(fire, Math.min(intervalMs, Math.max(0, intervalMs - since)));
    },
    flush(): void {
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      if (waiting) {
        const { value } = waiting;
        waiting = null;
        sendNow(value);
      }
    },
    cancel(): void {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      waiting = null;
    },
    get pending(): boolean {
      return waiting !== null;
    }
  };
}
