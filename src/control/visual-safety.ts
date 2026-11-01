// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Visual Sidechain's Panic and Restore from the deck, and the deck's latch
 * (PLAN.md 10.3, R-RIG-6). Both are Visual Sidechain's own frontend hotkeys,
 * fired with obs-websocket's `TriggerHotkeyByName` (OBS routes it through the
 * hotkey's callback, so OBS's focus does not matter; it acts on the press).
 *
 * - Every Panic press sends: no debounce (Visual Sidechain saves its pre-panic
 *   values once, so a repeat is harmless and a retry must never be swallowed),
 *   and no `GetHotkeyList` pre-check (600 answers a missing hotkey).
 * - The latch ("PANIC SENT") is set when Panic is sent, before OBS answers, so
 *   no filter write slips in behind it; it is cleared by a Restore OBS accepts
 *   (unless a Panic was sent after that Restore), by a Panic or Restore answered
 *   600 (Visual Sidechain is not loaded, nothing panicked), and on every
 *   disconnect and reconnect (an OBS restart resets Visual Sidechain's panic
 *   state). A timeout keeps it: Panic may have landed.
 * - The latch is a display aid; Visual Sidechain enforces Panic itself.
 */
import { EventEmitter } from "node:events";
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";
import { FilterController } from "./filter-controller.js";
import { ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";

export const VS_PANIC_HOTKEY = "visual_sidechain_panic";
export const VS_RESTORE_HOTKEY = "visual_sidechain_restore";
const NOT_FOUND_CODE = 600;

export class VisualSafety extends EventEmitter {
  private latched = false;
  /** Panics sent so far: a Restore answered after a newer Panic leaves that Panic's latch alone. */
  private panics = 0;

  public constructor(private readonly client: DirectObsClient, private readonly filters?: FilterController) {
    super();
    this.setMaxListeners(0);
    // Fired before every reconnect and on every disconnect (a reconnect keeps the status "connected").
    client.on("connectionReset", () => {
      this.setLatched(false);
      this.emit("reset");
    });
  }

  public isLatched(): boolean {
    return this.latched;
  }

  /**
   * Sends Visual Sidechain's Panic. Every press sends; a failure throws (shown on the key). It needs only an
   * identified socket, not the catalog read that follows the identify: Panic is never delayed by it.
   */
  public async panic(): Promise<void> {
    if (!this.client.isIdentified()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
    const panic = ++this.panics;
    this.setLatched(true);
    try {
      await this.client.triggerHotkeyByName(VS_PANIC_HOTKEY);
    } catch (error) {
      throw this.failure(error, panic);
    }
  }

  /** Sends Visual Sidechain's Restore (the key asks for a hold first); OBS's acceptance clears the latch. */
  public async restore(): Promise<void> {
    if (!this.client.isConnected()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
    const panics = this.panics;
    try {
      await this.client.triggerHotkeyByName(VS_RESTORE_HOTKEY);
    } catch (error) {
      throw this.failure(error, panics);
    }
    if (this.panics === panics) this.setLatched(false);
  }

  /**
   * 600: no such hotkey, so Visual Sidechain is not loaded and nothing panicked
   * (unless a newer Panic went out meanwhile); anything else keeps the latch.
   */
  private failure(error: unknown, panics: number): unknown {
    if ((error as { code?: unknown }).code !== NOT_FOUND_CODE) return error;
    if (this.panics === panics) this.setLatched(false);
    return new DirectObsError(ownText("vpNotLoaded"), NOT_FOUND_CODE);
  }

  private setLatched(latched: boolean): void {
    this.filters?.setPanicLatched(latched);
    if (this.latched === latched) return;
    this.latched = latched;
    this.emit("changed", latched);
  }
}
