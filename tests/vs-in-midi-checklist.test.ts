// SPDX-License-Identifier: GPL-2.0-or-later
// Visual Sidechain is part of Midi Fadester from 0.9.0: the setup checklist reads the two plugins together (an old
// standalone Visual Sidechain still loaded, Visual Sidechain switched off) and tells a missing vendor from a missing
// vendor request the way obs-websocket answers (600 for both, told apart by the comment; 604 from test servers).
import { describe, expect, it } from "vitest";
import {
  ObsVendorError,
  isObsVendorMissingError,
  isObsVendorRequestMissingError
} from "../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";
import {
  evaluateSetupChecklist,
  parseVersion,
  vendorErrorKind,
  versionAtLeast,
  type SetupChecklistClientLike,
  type SetupChecklistItem
} from "../src/obs/setup-checklist.js";

const NO_VENDOR = () => new ObsVendorError("No vendor was found by that name.", 600);
const NO_REQUEST = () => new ObsVendorError("No request was found by that name.", 600);
const OLD_604 = () => new ObsVendorError("Request type not registered", 604);

type Answer = Record<string, unknown> | (() => Error);

function mf(version: string): Record<string, Answer> {
  return {
    get_state: { version, slots: [{ id: "fx_1", kind: "fx" }] },
    get_catalog: { scenes: [] }
  };
}

function vs(version: string): Record<string, Answer> {
  return {
    get_signals: { version, audio_present: true, beat_index: 3, bar_phase: 0.5 },
    get_safety: { version },
    get_decks: { version, decks: [] }
  };
}

function missingVendor(): Record<string, Answer> {
  return { get_state: NO_VENDOR, get_catalog: NO_VENDOR, get_signals: NO_VENDOR, get_safety: NO_VENDOR, get_decks: NO_VENDOR };
}

function stubClient(vendors: Record<string, Record<string, Answer>>): SetupChecklistClientLike {
  return {
    isConnected: () => true,
    getStatus: () => ({ kind: "connected" }) as never,
    getSettings: () => ({ host: "127.0.0.1", port: 4455, password: "" }),
    getCatalog: () => ({ studioMode: true, currentTransition: "Fade", inputDetails: [] }),
    sendObsRequest: async () => ({ obsVersion: "33.0.1" }),
    callNamedVendor: async <T,>(vendor: string, request: string): Promise<T> => {
      const answer = vendors[vendor]?.[request] ?? NO_VENDOR;
      if (typeof answer === "function") throw answer();
      return answer as T;
    }
  };
}

async function items(vendors: Record<string, Record<string, Answer>>): Promise<Record<string, SetupChecklistItem>> {
  const report = await evaluateSetupChecklist(stubClient(vendors), {
    platform: "linux",
    probeLocalObsProcess: () => ({ status: "not_applicable" }) as never,
    probeMacAccessibility: () => "not_applicable",
    probeVjsterPort: async () => ({ status: "free" }) as never
  });
  return Object.fromEntries(report.items.map((i) => [i.id, i]));
}

describe("setup checklist: Visual Sidechain in Midi Fadester", () => {
  it("reads versions numerically", () => {
    expect(parseVersion("0.10.0-beta+3")).toEqual([0, 10, 0]);
    expect(parseVersion("installed")).toBeNull();
    expect(versionAtLeast("0.10.0", [0, 9, 0])).toBe(true);
    expect(versionAtLeast("0.9.0", [0, 9, 0])).toBe(true);
    expect(versionAtLeast("0.8.12", [0, 9, 0])).toBe(false);
    expect(versionAtLeast(undefined, [0, 9, 0])).toBe(false);
  });

  it("tells a missing vendor from a missing request (600 by comment, 604)", () => {
    expect(vendorErrorKind(NO_VENDOR())).toBe("vendor_missing");
    expect(vendorErrorKind(NO_REQUEST())).toBe("request_missing");
    expect(vendorErrorKind(OLD_604())).toBe("request_missing");
    expect(vendorErrorKind(new ObsVendorError("OBS is not ready", 207))).toBe("other");
    expect(vendorErrorKind(new Error("timeout"))).toBe("other");
  });

  // A-04: the keys' "Update Midi Fadester" gates and the hotkey fallbacks ask this; OBS answers 600, never 604.
  it("a missing request is recognised by OBS's 600 comment as well as by 604, and a missing vendor is not one", () => {
    expect(isObsVendorRequestMissingError(NO_REQUEST())).toBe(true);
    expect(isObsVendorRequestMissingError(OLD_604())).toBe(true);
    expect(isObsVendorRequestMissingError(NO_VENDOR())).toBe(false);
    expect(isObsVendorRequestMissingError(new ObsVendorError("No hotkeys were found by that name.", 600))).toBe(false);
    expect(isObsVendorRequestMissingError(new ObsVendorError("OBS is not ready", 207))).toBe(false);
    expect(isObsVendorRequestMissingError(null)).toBe(false);
    for (const err of [NO_VENDOR(), NO_REQUEST(), OLD_604()]) expect(isObsVendorMissingError(err)).toBe(true);
  });

  it("Midi Fadester 0.9.0 with its own Visual Sidechain: ok", async () => {
    const r = await items({ "midi-fadester": mf("0.9.0"), "visual-sidechain": vs("0.9.0") });
    expect(r.visual_sidechain).toMatchObject({ state: "ok", code: "present", meta: { version: "0.9.0" } });
    expect(r.midi_fadester).toMatchObject({ state: "ok", code: "present" });
  });

  it("Midi Fadester 0.10.0 counts as newer than 0.9.0", async () => {
    const r = await items({ "midi-fadester": mf("0.10.0"), "visual-sidechain": vs("0.10.0") });
    expect(r.visual_sidechain).toMatchObject({ state: "ok", code: "present" });
  });

  it("an old standalone Visual Sidechain answering next to Midi Fadester 0.9.0: vs_conflict", async () => {
    const r = await items({ "midi-fadester": mf("0.9.0"), "visual-sidechain": vs("0.8.0") });
    expect(r.visual_sidechain).toMatchObject({ state: "warn", code: "vs_conflict", meta: { version: "0.8.0" } });
    expect(r.visual_sidechain.detail).toContain("0.8.0");
    expect(r.visual_sidechain.fix).toMatch(/Remove the old Visual Sidechain plugin/);
  });

  it("a very old Visual Sidechain (request missing) next to Midi Fadester 0.9.0: vs_conflict", async () => {
    const r = await items({
      "midi-fadester": mf("0.9.0"),
      "visual-sidechain": { get_signals: NO_REQUEST }
    });
    expect(r.visual_sidechain).toMatchObject({ state: "warn", code: "vs_conflict" });
  });

  it("no Visual Sidechain vendor with Midi Fadester 0.9.0: vs_off, never 'install'", async () => {
    const r = await items({ "midi-fadester": mf("0.9.0"), "visual-sidechain": missingVendor() });
    expect(r.visual_sidechain).toMatchObject({ state: "warn", code: "vs_off" });
    expect(r.visual_sidechain.fix).not.toMatch(/install/i);
  });

  it("neither plugin: optional, install Midi Fadester 0.9.0 or newer", async () => {
    const r = await items({ "midi-fadester": missingVendor(), "visual-sidechain": missingVendor() });
    expect(r.visual_sidechain).toMatchObject({ state: "info", code: "missing" });
    expect(r.visual_sidechain.fix).toMatch(/Midi Fadester 0\.9\.0 or newer/);
  });

  it("Midi Fadester 0.8.0 with the separate Visual Sidechain 0.8.0: both ok as before", async () => {
    const r = await items({ "midi-fadester": mf("0.8.0"), "visual-sidechain": vs("0.8.0") });
    expect(r.visual_sidechain).toMatchObject({ state: "ok", code: "present" });
  });

  it("an old Visual Sidechain without Midi Fadester 0.9.0: too_old, by 600 comment or 604", async () => {
    for (const err of [NO_REQUEST, OLD_604]) {
      const r = await items({ "midi-fadester": missingVendor(), "visual-sidechain": { get_signals: err } });
      expect(r.visual_sidechain).toMatchObject({ state: "warn", code: "too_old" });
      expect(r.visual_sidechain.fix).toMatch(/Midi Fadester 0\.9\.0 or newer/);
    }
  });

  it("an old Midi Fadester missing get_state is too old, not missing", async () => {
    const r = await items({ "midi-fadester": { get_state: NO_REQUEST }, "visual-sidechain": missingVendor() });
    expect(r.midi_fadester).toMatchObject({ state: "warn", code: "too_old" });
  });

  it("a Visual Sidechain read that times out stays unknown even with Midi Fadester 0.9.0", async () => {
    const r = await items({
      "midi-fadester": mf("0.9.0"),
      "visual-sidechain": { get_signals: () => new Error("Request timed out") }
    });
    expect(r.visual_sidechain).toMatchObject({ state: "unknown", code: "unknown" });
  });
});
