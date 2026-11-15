// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Visual Sidechain's Panic and Restore from the deck, with Visual Sidechain's
 * vendor truth channel (`get_safety`, `panic`, `restore`, `safety_changed`) and
 * the frontend-hotkey fallback (`visual_sidechain_panic` / `visual_sidechain_restore`)
 * for older Visual Sidechain builds (PLAN.md 10.3, R-RIG-6, P0-3).
 *
 * - Every Panic press sends: no debounce (Visual Sidechain saves its pre-panic
 *   values once, so a repeat is harmless and a retry must never be swallowed),
 *   and no `GetHotkeyList` pre-check.
 * - When Visual Sidechain answers `get_safety` / `panic` / `restore` on vendor
 *   `"visual-sidechain"`, the key shows real safety state (`panic`, `since_ms`)
 *   on connect/reconnect and within one `safety_changed` event when Panic or
 *   Restore is pressed on the OBS keyboard or another surface.
 * - When `CallVendorRequest` answers 600 or 604 (an older Visual Sidechain build
 *   without safety requests, or Visual Sidechain not loaded), `VisualSafety`
 *   falls back transparently to `TriggerHotkeyByName` and the local latch
 *   (600 on the hotkey answers "Visual Sidechain missing").
 * - Locally initiated Panic sets the latch before OBS answers so no Visual
 *   Sidechain filter write slips in behind it.
 */
import { EventEmitter } from "node:events";
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";
import { FilterController } from "./filter-controller.js";
import { ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";

export const VS_VENDOR_NAME = "visual-sidechain";
export const VS_PANIC_HOTKEY = "visual_sidechain_panic";
export const VS_RESTORE_HOTKEY = "visual_sidechain_restore";
const NOT_FOUND_CODE = 600;
const INVALID_RESOURCE_TYPE_CODE = 604;

interface VisualSafetyReply {
  api_version?: number;
  panic?: boolean;
  since_ms?: number;
}

function isMissingVendorOrRequest(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === NOT_FOUND_CODE || code === INVALID_RESOURCE_TYPE_CODE;
}

function readSinceMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

export class VisualSafety extends EventEmitter {
  private latched = false;
  private sinceMs = 0;
  private mode: "unknown" | "vendor" | "legacy" = "unknown";
  private connectionGen = 0;
  /** Panics sent so far: a Restore or initial `get_safety` answered after a newer Panic leaves that Panic's latch alone. */
  private panics = 0;
  /** In-flight local Panic sends: prevents a crossing `safety_changed { panic: false }` from clearing an outgoing Panic. */
  private inFlightPanics = 0;

  public constructor(private readonly client: DirectObsClient, private readonly filters?: FilterController) {
    super();
    this.setMaxListeners(0);
    // Fired before every reconnect and on every disconnect (a reconnect keeps the status "connected").
    client.on("connectionReset", () => {
      this.connectionGen++;
      this.mode = "unknown";
      this.setState(false, 0);
      this.emit("reset");
    });
    client.on("connectionReady", () => {
      void this.refreshSafety();
    });
    client.on(
      "namedVendorEvent",
      (vendorName: string, eventType: string, eventData: Record<string, unknown>) => {
        if (vendorName !== VS_VENDOR_NAME) return;
        if (eventType === "safety_changed") {
          this.mode = "vendor";
          const panic = Boolean(eventData.panic);
          if (!panic && this.inFlightPanics > 0) return;
          this.setState(panic, panic ? readSinceMs(eventData.since_ms) : 0);
          return;
        }
        if (eventType === "signals_changed" && typeof eventData.panic === "boolean") {
          const panic = eventData.panic;
          if (!panic && this.inFlightPanics > 0) return;
          this.setState(panic, panic ? this.sinceMs : 0);
        }
      }
    );
    if (client.isConnected()) {
      void this.refreshSafety();
    }
  }

  public isLatched(): boolean {
    return this.latched;
  }

  public getSinceMs(): number {
    return this.sinceMs;
  }

  public getMode(): "unknown" | "vendor" | "legacy" {
    return this.mode;
  }

  /** Queries `visual-sidechain` `get_safety` so a deck connected or restarted mid-Panic shows real state at once. */
  public async refreshSafety(): Promise<void> {
    if (!this.client.isIdentified()) return;
    const gen = this.connectionGen;
    const panics = this.panics;
    try {
      const reply = await this.client.callNamedVendor<VisualSafetyReply>(VS_VENDOR_NAME, "get_safety");
      if (gen !== this.connectionGen) return;
      this.mode = "vendor";
      const panic = Boolean(reply.panic);
      const sinceMs = panic ? readSinceMs(reply.since_ms) : 0;
      // Panic only ever gets stricter: apply `true` unconditionally, and apply `false` only if no newer local Panic ran.
      if (panic || (this.panics === panics && this.inFlightPanics === 0)) {
        this.setState(panic, sinceMs);
      }
    } catch (error) {
      if (gen !== this.connectionGen) return;
      if (isMissingVendorOrRequest(error) && this.mode === "unknown") {
        this.mode = "legacy";
      }
    }
  }

  /**
   * Sends Visual Sidechain's Panic. Every press sends; a failure throws (shown on the key). It needs only an
   * identified socket, not the catalog read that follows the identify: Panic is never delayed by it.
   */
  public async panic(): Promise<void> {
    if (!this.client.isIdentified()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
    const panic = ++this.panics;
    this.inFlightPanics++;
    this.setState(true, this.sinceMs || Date.now());
    try {
      if (this.mode !== "legacy") {
        try {
          const reply = await this.client.callNamedVendor<VisualSafetyReply>(VS_VENDOR_NAME, "panic");
          this.mode = "vendor";
          const sinceMs = readSinceMs(reply.since_ms) || this.sinceMs;
          this.setState(reply.panic !== false, reply.panic !== false ? sinceMs : 0);
          return;
        } catch (error) {
          if (!isMissingVendorOrRequest(error)) {
            throw this.failure(error, panic);
          }
          this.mode = "legacy";
        }
      }
      try {
        await this.client.triggerHotkeyByName(VS_PANIC_HOTKEY);
      } catch (error) {
        throw this.failure(error, panic);
      }
    } finally {
      this.inFlightPanics--;
    }
  }

  /** Sends Visual Sidechain's Restore (the key asks for a hold first); OBS's acceptance clears the latch. */
  public async restore(): Promise<void> {
    if (!this.client.isConnected()) throw new DirectObsError(ownText("layerErrorNotConnected"), 500);
    const panics = this.panics;
    if (this.mode !== "legacy") {
      try {
        const reply = await this.client.callNamedVendor<VisualSafetyReply>(VS_VENDOR_NAME, "restore");
        this.mode = "vendor";
        if (this.panics === panics && this.inFlightPanics === 0) {
          const active = Boolean(reply.panic);
          this.setState(active, active ? readSinceMs(reply.since_ms) : 0);
        }
        return;
      } catch (error) {
        if (!isMissingVendorOrRequest(error)) {
          throw this.failure(error, panics);
        }
        this.mode = "legacy";
      }
    }
    try {
      await this.client.triggerHotkeyByName(VS_RESTORE_HOTKEY);
    } catch (error) {
      throw this.failure(error, panics);
    }
    if (this.panics === panics && this.inFlightPanics === 0) this.setState(false, 0);
  }

  /**
   * 600: no such hotkey, so Visual Sidechain is not loaded and nothing panicked
   * (unless a newer Panic went out meanwhile); anything else keeps the latch.
   */
  private failure(error: unknown, panics: number): unknown {
    if ((error as { code?: unknown }).code !== NOT_FOUND_CODE) return error;
    if (this.panics === panics) this.setState(false, 0);
    return new DirectObsError(ownText("vpNotLoaded"), NOT_FOUND_CODE);
  }

  private setState(latched: boolean, sinceMs: number): void {
    this.sinceMs = latched ? sinceMs : 0;
    this.filters?.setPanicLatched(latched);
    if (this.latched === latched) return;
    this.latched = latched;
    this.emit("changed", latched);
  }
}
