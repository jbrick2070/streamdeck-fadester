// SPDX-License-Identifier: GPL-2.0-or-later
import {
  AutoFadeRequest,
  ResetFxRequest,
  SetFaderValueRequest,
  TargetMode
} from "../types/contract.js";
import {
  DialLongPressAction,
  DialPressAction,
  DialStepPerTick
} from "../types/settings.js";

export const DIAL_HOLD_THRESHOLD_MS = 800 as const;

export type ResolvedDialCommand =
  | { kind: "set_fader_value"; request: SetFaderValueRequest }
  | { kind: "auto_fade"; request: AutoFadeRequest }
  | { kind: "reset_fx"; request: ResetFxRequest };

export function normalizeStepPerTick(raw?: number): DialStepPerTick {
  if (
    raw === 0.005 ||
    raw === 0.01 ||
    raw === 0.02 ||
    raw === 0.05 ||
    raw === 0.1
  ) {
    return raw;
  }
  return 0.02;
}

export function computeDialDelta(
  ticks: number,
  stepPerTick: number,
  acceleration: boolean,
  elapsedSinceLastTurnMs: number
): number {
  if (!Number.isFinite(ticks) || ticks === 0) {
    return 0;
  }
  const step = normalizeStepPerTick(stepPerTick);
  if (!acceleration) {
    return Number((ticks * step).toFixed(4));
  }

  const absTicks = Math.abs(ticks);
  let multiplier = 1;
  if (absTicks >= 4 || elapsedSinceLastTurnMs <= 25) {
    multiplier = 3;
  } else if (absTicks >= 2 || elapsedSinceLastTurnMs <= 60) {
    multiplier = 2;
  }

  return Number((ticks * step * multiplier).toFixed(4));
}

export function resolveDialPressCommand(
  slot: string,
  currentValue: number,
  pressAction: DialPressAction
): ResolvedDialCommand {
  const targetRail = currentValue < 0.5 ? 1.0 : 0.0;

  switch (pressAction) {
    case "clean_0":
      return {
        kind: "set_fader_value",
        request: { slot, value: 0.0, release: true }
      };
    case "finish_tbar":
      return {
        kind: "set_fader_value",
        request: { slot, value: 1.0, release: true }
      };
    case "auto_fade_1s":
      return {
        kind: "auto_fade",
        request: { slot, to: targetRail, ms: 1000 }
      };
    case "auto_fade_2s":
      return {
        kind: "auto_fade",
        request: { slot, to: targetRail, ms: 2000 }
      };
    case "cut":
    case "snap_0_100":
    default:
      return {
        kind: "set_fader_value",
        request: { slot, value: targetRail, release: true }
      };
  }
}

export function resolveDialLongPressCommand(
  slot: string,
  currentValue: number,
  longPressAction: DialLongPressAction
): ResolvedDialCommand | null {
  if (longPressAction === "none") {
    return null;
  }
  if (longPressAction === "clean_all_fx") {
    return {
      kind: "reset_fx",
      request: { ms: 0 }
    };
  }
  if (longPressAction === "finish_tbar") {
    return {
      kind: "set_fader_value",
      request: { slot, value: 1.0, release: true }
    };
  }
  const targetRail = currentValue < 0.5 ? 1.0 : 0.0;
  return {
    kind: "auto_fade",
    request: { slot, to: targetRail, ms: 3000 }
  };
}

export function mapTouchTapToRequest(
  slot: string,
  tapX: number,
  tapY: number,
  targetMode: TargetMode,
  hasThumbnails: boolean
): SetFaderValueRequest {
  const x = Math.max(0, Math.min(200, tapX));
  const y = Math.max(0, Math.min(100, tapY));

  // Crossfade cell with live thumbnails: tapping a thumbnail side snaps to that source (0.0 or 1.0)
  if (targetMode === "crossfade_ab" && hasThumbnails && y <= 58) {
    if (x <= 98) {
      return { slot, value: 0.0, release: true };
    }
    if (x >= 102) {
      return { slot, value: 1.0, release: true };
    }
  }

  // T-bar cell: tapping the top half finishes the throw (1.0, release: true)
  if (targetMode === "tbar" && y <= 48) {
    return { slot, value: 1.0, release: true };
  }

  // Bar tap mapping with 20 px rail snap zones (0..20 -> 0.0, 180..200 -> 1.0)
  let value: number;
  if (x <= 20) {
    value = 0.0;
  } else if (x >= 180) {
    value = 1.0;
  } else {
    value = Math.round(((x - 20) / 160) * 100) / 100;
  }

  return {
    slot,
    value,
    release: value === 0.0 || value === 1.0
  };
}
