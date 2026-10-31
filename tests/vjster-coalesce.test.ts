// SPDX-License-Identifier: GPL-2.0-or-later
// VJster coalescing (docs/vjster/REQUIREMENTS.md R-BEH-3).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COALESCE_MS, createCoalescer, realClock, type CoalesceClock } from "../src/vjster/shared/coalesce.js";

/** A clock whose time only moves when the test says so, and may be set backward. */
function fakeClock(): CoalesceClock & { advance(ms: number): void; set(ms: number): void; readonly timers: number; readonly delays: number[] } {
  let now = 1000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const delays: number[] = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const handle = nextHandle++;
      delays.push(ms);
      timers.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    set(ms: number) {
      // Pending timers keep their delay relative to the moment they were set.
      const shift = ms - now;
      for (const t of timers.values()) t.at += shift;
      now = ms;
    },
    get timers() {
      return timers.size;
    },
    delays
  };
}

function harness(intervalMs?: number) {
  const clock = fakeClock();
  const sent: { value: number; at: number }[] = [];
  const c = createCoalescer<number>((value) => sent.push({ value, at: clock.now() }), intervalMs, clock);
  return { clock, sent, c };
}

describe("createCoalescer (R-BEH-3)", () => {
  it("uses a 50 ms interval by default", () => {
    expect(DEFAULT_COALESCE_MS).toBe(50);
    const { clock, sent, c } = harness();
    c.push(1);
    c.push(2);
    clock.advance(49);
    expect(sent).toHaveLength(1);
    clock.advance(1);
    expect(sent.map((s) => [s.value, s.at])).toEqual([
      [1, 1000],
      [2, 1050]
    ]);
  });

  it("sends the first value at once", () => {
    const { sent, c } = harness(50);
    c.push(1);
    expect(sent).toEqual([{ value: 1, at: 1000 }]);
    expect(c.pending).toBe(false);
  });

  it("holds the rest of a burst and sends only its last value when the interval ends", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    clock.advance(10);
    c.push(2);
    clock.advance(10);
    c.push(3);
    expect(c.pending).toBe(true);
    expect(sent.map((s) => s.value)).toEqual([1]);
    clock.advance(30);
    expect(sent).toEqual([
      { value: 1, at: 1000 },
      { value: 3, at: 1050 }
    ]);
    expect(c.pending).toBe(false);
  });

  it("keeps a single timer through a burst", () => {
    const { clock, c } = harness(50);
    c.push(0);
    for (let i = 1; i <= 4; i++) {
      clock.advance(10);
      c.push(i);
      expect(clock.timers).toBeLessThanOrEqual(1);
    }
    expect(clock.delays).toHaveLength(1);
  });

  it("never sends twice within the interval and always sends the final value", () => {
    const { clock, sent, c } = harness(50);
    for (let i = 1; i <= 50; i++) {
      c.push(i);
      clock.advance(10);
    }
    clock.advance(100);
    for (let k = 1; k < sent.length; k++) expect(sent[k].at - sent[k - 1].at).toBeGreaterThanOrEqual(50);
    expect(sent[sent.length - 1].value).toBe(50);
    expect(sent.length).toBeLessThanOrEqual(11);
    expect(clock.timers).toBe(0);
  });

  it("sends at once exactly one interval after the last send", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    clock.advance(50);
    c.push(2);
    expect(sent.map((s) => [s.value, s.at])).toEqual([
      [1, 1000],
      [2, 1050]
    ]);
    expect(clock.timers).toBe(0);
  });

  it("sends at once again after a quiet interval", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    clock.advance(200);
    c.push(2);
    expect(sent.map((s) => [s.value, s.at])).toEqual([
      [1, 1000],
      [2, 1200]
    ]);
  });

  it("waits only for the rest of the interval after a recent send", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    clock.advance(40);
    c.push(2);
    clock.advance(9);
    expect(sent).toHaveLength(1);
    clock.advance(1);
    expect(sent.map((s) => [s.value, s.at])).toEqual([
      [1, 1000],
      [2, 1050]
    ]);
  });

  it("still sends the last value within one interval when the clock steps backward", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    clock.set(1000 - 3_600_000);
    c.push(2);
    expect(Math.max(...clock.delays)).toBeLessThanOrEqual(50);
    clock.advance(50);
    expect(sent.map((s) => s.value)).toEqual([1, 2]);
  });

  it("throttles a push made from inside send", () => {
    const clock = fakeClock();
    const sent: { value: number; at: number }[] = [];
    const c = createCoalescer<number>(
      (value) => {
        sent.push({ value, at: clock.now() });
        if (value === 1) c.push(2);
      },
      50,
      clock
    );
    c.push(1);
    expect(sent).toHaveLength(1);
    clock.advance(50);
    expect(sent.map((s) => [s.value, s.at])).toEqual([
      [1, 1000],
      [2, 1050]
    ]);
  });

  it("flush sends the waiting value now, and the next push waits a full interval", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    c.push(2);
    c.flush();
    expect(sent.map((s) => s.value)).toEqual([1, 2]);
    expect(clock.timers).toBe(0);
    c.flush();
    expect(sent).toHaveLength(2);
    c.push(3);
    expect(sent).toHaveLength(2);
    clock.advance(50);
    expect(sent.map((s) => s.value)).toEqual([1, 2, 3]);
  });

  it("cancel drops the waiting value and its timer, and keeps the spacing", () => {
    const { clock, sent, c } = harness(50);
    c.push(1);
    clock.advance(10);
    c.push(2);
    c.cancel();
    expect(clock.timers).toBe(0);
    expect(c.pending).toBe(false);
    c.push(3);
    clock.advance(39);
    expect(sent.map((s) => s.value)).toEqual([1]);
    clock.advance(1);
    expect(sent.map((s) => [s.value, s.at])).toEqual([
      [1, 1000],
      [3, 1050]
    ]);
  });

  it("rejects an interval that is not a positive number", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createCoalescer(() => undefined, bad)).toThrow(RangeError);
    }
  });
});

describe("the default clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drives the coalescer with the host's own timers and a clock that moves", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    const t0 = realClock.now();
    vi.advanceTimersByTime(30);
    expect(realClock.now() - t0).toBe(30);

    const sent: number[] = [];
    const c = createCoalescer<number>((value) => sent.push(value));
    c.push(1);
    c.push(2);
    vi.advanceTimersByTime(49);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([1, 2]);
  });
});
