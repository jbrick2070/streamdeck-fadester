// SPDX-License-Identifier: GPL-2.0-or-later
import { SurfaceSlotBase } from "./types.js";

/** Match Midi Fadester's reset_fx target set, independent of surface bank. */
export function isResetFxEligible(
  slot: Pick<SurfaceSlotBase, "enabled" | "target_mode">
): boolean {
  return slot.enabled !== false && slot.target_mode === "filter_param";
}
