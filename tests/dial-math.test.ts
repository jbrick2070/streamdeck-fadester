// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import {
  computeDialDelta,
  DIAL_HOLD_THRESHOLD_MS,
  mapTouchTapToRequest,
  resolveDialLongPressCommand,
  resolveDialPressCommand
} from "../src/actions/dial-math.js";

describe("Step 1.4 — Dial Math (Steps, Acceleration, Press, 800 ms Long Press, TouchTap)", () => {
  it("computes unaccelerated and accelerated deltas for 1%, 2%, and 5% steps", () => {
    expect(DIAL_HOLD_THRESHOLD_MS).toBe(800);
    expect(computeDialDelta(1, 0.01, false, 200)).toBe(0.01);
    expect(computeDialDelta(-1, 0.02, false, 10)).toBe(-0.02);
    expect(computeDialDelta(2, 0.05, false, 10)).toBe(0.1);

    // Slow turn (> 60 ms, 1 tick) -> 1x
    expect(computeDialDelta(1, 0.02, true, 120)).toBe(0.02);
    // Medium turn (<= 60 ms or 2 ticks) -> 2x
    expect(computeDialDelta(1, 0.02, true, 45)).toBe(0.04);
    expect(computeDialDelta(2, 0.02, true, 120)).toBe(0.08);
    // Fast turn (<= 25 ms or >= 4 ticks) -> 3x
    expect(computeDialDelta(1, 0.02, true, 15)).toBe(0.06);
    expect(computeDialDelta(-4, 0.02, true, 120)).toBe(-0.24);
  });

  it("resolves all 5 short-press modes with exact release and rail rules", () => {
    expect(resolveDialPressCommand("crossfader", 0.2, "snap_0_100")).toEqual({
      kind: "set_fader_value",
      request: { slot: "crossfader", value: 1.0, release: true }
    });
    expect(resolveDialPressCommand("crossfader", 0.5, "snap_0_100")).toEqual({
      kind: "set_fader_value",
      request: { slot: "crossfader", value: 0.0, release: true }
    });
    expect(resolveDialPressCommand("fader_1", 0.1, "auto_fade_1s")).toEqual({
      kind: "auto_fade",
      request: { slot: "fader_1", to: 1.0, ms: 1000 }
    });
    expect(resolveDialPressCommand("fader_1", 0.9, "auto_fade_2s")).toEqual({
      kind: "auto_fade",
      request: { slot: "fader_1", to: 0.0, ms: 2000 }
    });
    expect(resolveDialPressCommand("crossfader", 0.3, "finish_tbar")).toEqual({
      kind: "set_fader_value",
      request: { slot: "crossfader", value: 1.0, release: true }
    });
  });

  it("resolves 800 ms long-press commands (Auto-fade 3 s, Finish T-bar, None)", () => {
    expect(
      resolveDialLongPressCommand("crossfader", 0.25, "auto_fade_3s")
    ).toEqual({
      kind: "auto_fade",
      request: { slot: "crossfader", to: 1.0, ms: 3000 }
    });
    expect(
      resolveDialLongPressCommand("crossfader", 0.75, "auto_fade_3s")
    ).toEqual({
      kind: "auto_fade",
      request: { slot: "crossfader", to: 0.0, ms: 3000 }
    });
    expect(resolveDialLongPressCommand("crossfader", 0.2, "none")).toBeNull();
  });

  it("maps touch-cell tap coordinates for standard bar, T-bar finish, and thumbnail sides", () => {
    // Left rail snap (<= 20 px)
    expect(mapTouchTapToRequest("fader_2", 10, 75, "layer_opacity", false)).toEqual({
      slot: "fader_2",
      value: 0.0,
      release: true
    });
    // Midpoint (x = 100 -> (100 - 20) / 160 = 0.5)
    expect(mapTouchTapToRequest("fader_2", 100, 75, "layer_opacity", false)).toEqual({
      slot: "fader_2",
      value: 0.5,
      release: false
    });
    // Right rail snap (>= 180 px)
    expect(mapTouchTapToRequest("fader_2", 190, 75, "layer_opacity", false)).toEqual({
      slot: "fader_2",
      value: 1.0,
      release: true
    });
    // Crossfade thumbnail tap: left thumbnail -> 0.0, right thumbnail -> 1.0
    expect(mapTouchTapToRequest("fader_1", 40, 30, "crossfade_ab", true)).toEqual({
      slot: "fader_1",
      value: 0.0,
      release: true
    });
    expect(mapTouchTapToRequest("fader_1", 150, 30, "crossfade_ab", true)).toEqual({
      slot: "fader_1",
      value: 1.0,
      release: true
    });
    // T-bar top tap finishes throw
    expect(mapTouchTapToRequest("crossfader", 60, 25, "tbar", false)).toEqual({
      slot: "crossfader",
      value: 1.0,
      release: true
    });
  });
});
