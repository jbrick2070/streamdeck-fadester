// SPDX-License-Identifier: GPL-2.0-or-later
import streamDeck from "@elgato/streamdeck";

/** A control saves its settings on its own when it follows a rename in OBS (name-binding.ts); a failed save is logged. */
export function logBindingSaveFailure(error: unknown): void {
  streamDeck.logger.warn(`Could not save a control's OBS input or scene binding: ${error instanceof Error ? error.message : String(error)}`);
}
