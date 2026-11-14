// SPDX-License-Identifier: GPL-2.0-or-later

export class CellRateLimiter<TPayload> {
  private readonly minIntervalMs: number;
  private readonly onFlush: (payload: TPayload) => void | Promise<void>;
  private readonly clock: () => number;
  private lastFlushTime = -Infinity;
  private pendingPayload: TPayload | undefined;
  private hasPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    onFlush: (payload: TPayload) => void | Promise<void>,
    minIntervalMs = 100,
    clock: () => number = Date.now
  ) {
    this.onFlush = onFlush;
    this.minIntervalMs = Math.max(16, minIntervalMs);
    this.clock = clock;
  }

  public push(payload: TPayload, now = this.clock()): void {
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
      const waitMs = Math.max(1, this.minIntervalMs - elapsed);
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.hasPending && this.pendingPayload !== undefined) {
          const toSend = this.pendingPayload;
          this.pendingPayload = undefined;
          this.hasPending = false;
          this.lastFlushTime = this.clock();
          this.flush(toSend);
        }
      }, waitMs);
    }
  }

  /** A draw that fails is dropped: the next push draws again, and a throw from the timer would end the process. */
  private flush(payload: TPayload): void {
    try {
      Promise.resolve(this.onFlush(payload)).catch(() => undefined);
    } catch {
      // dropped
    }
  }

  public dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.hasPending = false;
    this.pendingPayload = undefined;
  }
}
