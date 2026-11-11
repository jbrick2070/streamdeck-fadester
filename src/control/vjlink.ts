// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * VJLink (BosoVR's obs-vjlink plugin for OBS, https://github.com/BosoVR/obs-vjlink)
 * driven over its obs-websocket vendor API, vendor "obs-vjlink": its presets,
 * BPM tap, blackout and five macros. Fadester only sends requests through OBS;
 * no VJLink code is used or shipped (VJLink's own licence covers VJLink).
 *
 * VJLink sends no events, so its state is read with GetState once a second, and
 * only while a VJLink control is on screen (`watch`). A macro turned on the deck
 * keeps the deck's value for a moment, so a read in flight cannot pull the dial
 * back, and turns made while a SetMacros is on its way are sent as one newest
 * value when it returns.
 */
import { EventEmitter } from "node:events";
import { ObsVendorError } from "../../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";
import { ownText, verbatimText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import type { DirectObsClient } from "../obs/direct-obs-client.js";
import { VJLINK_MACROS, VjlinkMacro } from "../types/settings.js";

export const VJLINK_VENDOR = "obs-vjlink";

/** obs-websocket's ResourceNotFound: no plugin registered the vendor (VJLink is not installed or not loaded). */
const NO_SUCH_VENDOR = 600;

export type VjlinkAvailability = "disconnected" | "loading" | "missing" | "ok";

export interface VjlinkState {
  availability: VjlinkAvailability;
  /** VJLink's preset index; -1 while an effect runs without a preset; null before the first read. */
  presetIndex: number | null;
  /** The running effect's id ("classic_tunnel"), or "" when VJLink names none. */
  effectId: string;
  bpm: number | null;
  blackout: boolean | null;
  /** Each macro 0..1, or null before VJLink has said. */
  macros: Record<VjlinkMacro, number | null>;
}

/** The part of the OBS client VJLink needs: the direct client, or a stand-in in tests. */
export type VjlinkClient = Pick<DirectObsClient,
  "sendObsRequest" | "isConnected" | "getStatus" | "nudgeReconnect" | "on" | "off">;

function emptyMacros(): Record<VjlinkMacro, number | null> {
  return { energy: null, chaos: null, speed: null, color: null, react: null };
}

function emptyState(availability: VjlinkAvailability): VjlinkState {
  return { availability, presetIndex: null, effectId: "", bpm: null, blackout: null, macros: emptyMacros() };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value: unknown): number | null {
  const number = numberOrNull(value);
  return number === null ? null : Math.trunc(number);
}

export class VjlinkController extends EventEmitter {
  private state: VjlinkState;
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading = false;
  /** Bumped by every disconnect and reconnect: a read that started before it is dropped. */
  private generation = 0;
  /** A macro the deck set keeps the deck's value until then, whatever a read says. */
  private readonly heldUntil = new Map<VjlinkMacro, number>();
  /** The SetMacros on its way, per macro, and the newest value turned while it travels. */
  private readonly sending = new Map<VjlinkMacro, Promise<void>>();
  private readonly pending = new Map<VjlinkMacro, number>();

  private readonly onStatusChanged = (): void => {
    if (this.client.isConnected()) return;
    this.generation++;
    this.stopTimer();
    this.heldUntil.clear();
    this.replace(emptyState("disconnected"));
  };

  /** Every completed (re)connection: VJLink may have been installed or removed meanwhile (that needs an OBS restart). */
  private readonly onConnectionReady = (): void => {
    this.generation++;
    this.replace({ ...emptyState("loading") });
    if (this.watchers > 0) {
      this.startTimer();
      void this.refresh().catch(() => {});
    }
  };

  public constructor(
    public readonly client: VjlinkClient,
    private readonly pollMs = 1000,
    private readonly holdMs = 800
  ) {
    super();
    this.state = emptyState(client.isConnected() ? "loading" : "disconnected");
    this.client.on("statusChanged", this.onStatusChanged);
    this.client.on("connectionReady", this.onConnectionReady);
  }

  /** Stops reading and listening (tests; the plugin keeps one for its lifetime). */
  public dispose(): void {
    this.stopTimer();
    this.client.off("statusChanged", this.onStatusChanged);
    this.client.off("connectionReady", this.onConnectionReady);
  }

  public getState(): VjlinkState {
    return { ...this.state, macros: { ...this.state.macros } };
  }

  /** A control on screen: VJLink is read while at least one is. Returns the release. */
  public watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) {
      this.startTimer();
      void this.refresh().catch(() => {});
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) this.stopTimer();
    };
  }

  public isWatched(): boolean {
    return this.watchers > 0;
  }

  /** One GetState read; skipped while one runs or OBS is not connected. */
  public async refresh(): Promise<void> {
    if (this.reading || !this.client.isConnected()) return;
    this.reading = true;
    const generation = this.generation;
    try {
      const data = await this.call("GetState");
      if (generation !== this.generation) return;
      const now = Date.now();
      const macros = { ...this.state.macros };
      for (const macro of VJLINK_MACROS) {
        // The deck's own value stands while it is held, sending or waiting to send.
        if ((this.heldUntil.get(macro) ?? 0) > now || this.sending.has(macro) || this.pending.has(macro)) continue;
        const value = numberOrNull(data[`macro_${macro}`]);
        macros[macro] = value === null ? null : clampUnit(value);
      }
      this.replace({
        availability: "ok",
        presetIndex: integerOrNull(data.preset_index),
        effectId: typeof data.effect_id === "string" ? data.effect_id : "",
        bpm: numberOrNull(data.bpm),
        blackout: typeof data.blackout === "boolean" ? data.blackout : null,
        macros
      });
    } catch {
      // A missing VJLink is recorded by call(); any other failed read keeps the last state until the next one.
    } finally {
      this.reading = false;
    }
  }

  public async nextPreset(): Promise<void> {
    await this.stepPreset("NextPreset");
  }

  public async previousPreset(): Promise<void> {
    await this.stepPreset("PrevPreset");
  }

  /** Selects a preset by VJLink's display name or id; VJLink's own words come back when it has no such preset. */
  public async selectPreset(name: string): Promise<void> {
    const data = await this.call("SetPreset", { preset_name: name });
    this.takePresetIndex(data);
  }

  public async tapBpm(): Promise<void> {
    const data = await this.call("TapBPM");
    const bpm = numberOrNull(data.bpm);
    if (bpm !== null) this.replace({ ...this.state, bpm });
  }

  /** VJLink's Blackout request toggles; its reply says which way. */
  public async toggleBlackout(): Promise<void> {
    const data = await this.call("Blackout");
    if (typeof data.blackout === "boolean") this.replace({ ...this.state, blackout: data.blackout });
  }

  /** Moves a macro by `delta` (in its 0..1 range) from the deck's last value, or from the middle when none is known. */
  public async stepMacro(macro: VjlinkMacro, delta: number): Promise<void> {
    const current = this.pending.get(macro) ?? this.state.macros[macro] ?? 0.5;
    await this.setMacro(macro, current + delta);
  }

  /** Sets a macro (clamped to 0..1). A value set while one is on its way replaces any waiting value. */
  public async setMacro(macro: VjlinkMacro, value: number): Promise<void> {
    const target = Math.round(clampUnit(value) * 1000) / 1000;
    this.heldUntil.set(macro, Date.now() + this.holdMs);
    this.replace({ ...this.state, macros: { ...this.state.macros, [macro]: target } });
    const running = this.sending.get(macro);
    if (running) {
      this.pending.set(macro, target);
      return running;
    }
    const send = (async () => {
      try {
        let next: number | undefined = target;
        while (next !== undefined) {
          this.pending.delete(macro);
          await this.call("SetMacros", { [macro]: next });
          next = this.pending.get(macro);
        }
      } finally {
        this.sending.delete(macro);
        this.pending.delete(macro);
        this.heldUntil.set(macro, Date.now() + this.holdMs);
      }
    })();
    this.sending.set(macro, send);
    return send;
  }

  private async stepPreset(type: "NextPreset" | "PrevPreset"): Promise<void> {
    const data = await this.call(type);
    this.takePresetIndex(data);
  }

  private takePresetIndex(data: Record<string, unknown>): void {
    const index = integerOrNull(data.preset_index);
    if (index !== null && index >= 0) this.replace({ ...this.state, presetIndex: index });
    // The preset's effect is known only from the next read.
    void this.refresh().catch(() => {});
  }

  private async call(requestType: string, requestData: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let outer: Record<string, unknown>;
    try {
      outer = await this.client.sendObsRequest("CallVendorRequest", { vendorName: VJLINK_VENDOR, requestType, requestData });
    } catch (error) {
      if (error instanceof ObsVendorError && error.code === NO_SUCH_VENDOR) {
        if (this.client.isConnected()) this.replace({ ...emptyState("missing") });
        throw new ObsVendorError(ownText("vjlinkMissing"), NO_SUCH_VENDOR);
      }
      throw error;
    }
    const inner = outer.responseData;
    const response = (inner && typeof inner === "object" ? inner : {}) as Record<string, unknown>;
    if (response.success === false) {
      // VJLink's own words, as VJLink wrote them ("Preset not found").
      const words = typeof response.error === "string" ? response.error.trim() : "";
      throw new ObsVendorError(words ? verbatimText(words) : ownText("vjlinkRefused"), 400);
    }
    if (this.state.availability === "missing") this.replace({ ...this.state, availability: "ok" });
    return response;
  }

  private startTimer(): void {
    if (this.timer || !this.client.isConnected()) return;
    this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, this.pollMs);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private replace(next: VjlinkState): void {
    const before = JSON.stringify(this.state);
    this.state = next;
    if (JSON.stringify(next) !== before) this.emit("changed");
  }
}
