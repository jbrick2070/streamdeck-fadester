// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import {
  renderAutoFadeKeySvg,
  renderDialCellSvg
} from "../src/gfx/svg-renderer.js";
import { PLAYLISTER_PALETTE } from "../src/gfx/palette.js";
import { ConnectionStatusInfo, FadesterSlot } from "../src/types/contract.js";
import { renderDirectDialSvg, renderDirectKeySvg } from "../src/gfx/direct-obs-renderer.js";

const CONNECTED_STATUS: ConnectionStatusInfo = {
  kind: "connected",
  sentence: "Connected: OBS 33.0.0, Midi Fadester 0.1.0",
  cellReason: ""
};

function assertMinStrokeWidth(svg: string, minPx = 3): void {
  const matches = [...svg.matchAll(/stroke-width="([0-9.]+)"/g)];
  expect(matches.length).toBeGreaterThan(0);
  for (const m of matches) {
    expect(Number(m[1])).toBeGreaterThanOrEqual(minPx);
  }
}

function assertSvgRules(svg: string): void {
  assertMinStrokeWidth(svg, 3);
  const textRows = new Set(
    [...svg.matchAll(/<text\b[^>]*\by="([^"]+)"/g)].map((match) => match[1])
  );
  expect(textRows.size).toBeLessThanOrEqual(2);
}

describe("Step 1.3 — Playlister Runtime SVG Renderer (Dial Cells & Keys)", () => {
  it("shows the native scene mixer's Live/Next endpoints with semantic colors and scene names", () => {
    const svg = renderDirectDialSvg({
      connected: true, reason: "", configured: true, target: "tbar", studioMode: true,
      label: "Scene transition", value: 0.56,
      programSceneName: "Camera & Mic", previewSceneName: "Next <Cam>"
    });
    expect(svg).toContain('data-cell="scene-mixer"');
    expect(svg).toContain('>LIVE</text>');
    expect(svg).toContain('>NEXT</text>');
    expect(svg).toContain("Next &lt;Cam&gt;");
    expect(svg).toContain(PLAYLISTER_PALETTE.programRed);
    expect(svg).toContain(PLAYLISTER_PALETTE.previewGreen);
    expect(svg).toContain(PLAYLISTER_PALETTE.orangeAccent);
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain("Press to take Next live");
  });

  it("shows custom audio press instructions but gives connection problems priority", () => {
    const input = {
      connected: true, configured: true, reason: "", target: "input_volume" as const,
      label: "Desktop Audio", value: 0.4, pressHint: "Press: next blend"
    };
    const ready = renderDirectDialSvg(input);
    expect(ready).toContain("40 %");
    expect(ready).toContain("Press: next blend");
    const offline = renderDirectDialSvg({ ...input, connected: false, reason: "Wrong password" });
    expect(offline).toContain("Wrong password");
    expect(offline).not.toContain("Press: next blend");
  });

  it("keeps long scene names readable on two escaped lines with their operation visible", () => {
    const svg = renderDirectKeySvg({
      connected: true, configured: true, reason: "", title: "Camera & opening slate",
      subtitle: "Next · Preview", icon: "next"
    });
    expect(svg).toMatch(/<text[^>]+y="69"[^>]*>Camera &amp;<\/text>/);
    expect(svg).toMatch(/<text[^>]+y="85"[^>]*>opening slate<\/text>/);
    expect(svg).toMatch(/<text[^>]+y="107"[^>]*>Next · Preview<\/text>/);
  });

  it("makes a same-scene or disabled Studio Mode mixer actionable instead of showing a working fader", () => {
    const input = {
      connected: true, reason: "", configured: true, target: "tbar" as const, studioMode: true,
      label: "Scene transition", value: 0.56,
      programSceneName: "Scene", previewSceneName: "Scene"
    };
    expect(renderDirectDialSvg(input)).toContain("Choose a different Next scene");
    expect(renderDirectDialSvg({ ...input, studioMode: false })).toContain("Turn on OBS Studio Mode");
    const offline = renderDirectDialSvg({ ...input, connected: false, reason: "Wrong password" });
    expect(offline).toContain("Wrong password");
    expect(offline).not.toContain("56%");
  });
  it("renders Fader cell with A-to-B gradient bar, takeover arrow, and >= 3px strokes", () => {
    const slot: FadesterSlot = {
      id: "fader_1",
      name: "Fader 1",
      kind: "fader",
      target_mode: "layer_opacity",
      source_a: "Cam 1",
      source_b: "Loop 3",
      curve: "dip_free",
      afv: false,
      value: 0.42,
      takeover_pending: "up",
      label: "Cam 1 -> Loop 3",
      available: true,
      reason: ""
    };

    const svg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot,
      slotId: "fader_1"
    });

    expect(svg).toContain('data-cell="fader"');
    expect(svg).toContain("42%");
    expect(svg).toContain('data-takeover="up"');
    expect(svg).toContain(PLAYLISTER_PALETTE.bgTop);
    expect(svg).toContain(PLAYLISTER_PALETTE.orangeAccent);
    assertSvgRules(svg);
  });

  it("renders T-bar cell with green Preview, red Program, and transition glow mid-throw", () => {
    const slot: FadesterSlot = {
      id: "crossfader",
      name: "Crossfader",
      kind: "crossfader",
      target_mode: "tbar",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.65,
      takeover_pending: "none",
      label: "T-Bar",
      available: true,
      reason: ""
    };

    const svg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot,
      slotId: "crossfader",
      previewSceneName: "Cam Wide",
      programSceneName: "Stage Main"
    });

    expect(svg).toContain('data-cell="tbar"');
    expect(svg).toContain('data-transition-glow="true"');
    expect(svg).toContain("Cam Wide");
    expect(svg).toContain("Stage Main");
    expect(svg).toContain(PLAYLISTER_PALETTE.previewGreen);
    expect(svg).toContain(PLAYLISTER_PALETTE.programRed);
    assertSvgRules(svg);
  });

  it("renders Crossfade cell with dual 96x54 live thumbnails and fader knob", () => {
    const slot: FadesterSlot = {
      id: "fader_1",
      name: "Fader 1",
      kind: "fader",
      target_mode: "crossfade_ab",
      source_a: "Cam 1",
      source_b: "Loop 3",
      curve: "dip_free",
      afv: false,
      value: 0.5,
      takeover_pending: "none",
      label: "Cam 1 -> Loop 3",
      available: true,
      reason: ""
    };

    const svg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot,
      slotId: "fader_1",
      showThumbnails: true,
      thumbnailA: "data:image/jpeg;base64,AAA",
      thumbnailB: "data:image/jpeg;base64,BBB"
    });

    expect(svg).toContain('data-cell="crossfade-thumbnails"');
    expect(svg).toContain('data-thumb="a"');
    expect(svg).toContain('data-thumb="b"');
    expect(svg).toContain('width="96" height="54"');
    expect(svg).toContain('data-knob="true"');
    assertSvgRules(svg);
  });

  it("renders the 800 ms Hold indicator overlay when holdingForLongPress is true", () => {
    const slot: FadesterSlot = {
      id: "crossfader",
      name: "Crossfader",
      kind: "crossfader",
      target_mode: "tbar",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "T-Bar",
      available: true,
      reason: ""
    };

    const svg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot,
      slotId: "crossfader",
      holdingForLongPress: true
    });

    expect(svg).toContain('data-hold-indicator="true"');
    expect(svg).toContain("HOLD 3s FADE");
    assertSvgRules(svg);
  });

  it("enforces the Never-Blank rule for Unassigned, Unavailable (verbatim reason), and Disconnected", () => {
    const unassignedSlot: FadesterSlot = {
      id: "fader_3",
      name: "Fader 3",
      kind: "fader",
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    };
    const unassignedSvg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot: unassignedSlot,
      slotId: "fader_3"
    });
    expect(unassignedSvg).toContain("Unassigned, set in OBS");
    assertSvgRules(unassignedSvg);

    const unavailableSlot: FadesterSlot = {
      ...unassignedSlot,
      id: "crossfader",
      name: "Crossfader",
      target_mode: "tbar",
      available: false,
      reason: "Studio Mode is off"
    };
    const unavailableSvg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot: unavailableSlot,
      slotId: "crossfader"
    });
    expect(unavailableSvg).toContain("Studio Mode is off");
    assertSvgRules(unavailableSvg);

    const disconnectedSvg = renderDialCellSvg({
      status: {
        kind: "wrong_password",
        sentence:
          "Wrong password. Check OBS Tools > WebSocket Server Settings > Show Connect Info.",
        cellReason: "Wrong password"
      },
      slotId: "crossfader"
    });
    expect(disconnectedSvg).toContain("Wrong password");
    assertSvgRules(disconnectedSvg);

    const keySvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slot: unavailableSlot,
      slotId: "crossfader",
      to: 1,
      durationMs: 1000
    });
    expect(keySvg).toContain("Studio Mode is off");
    assertSvgRules(keySvg);
  });

  it("wraps long key target names instead of truncating Crossfader (A/B)", () => {
    const crossfaderSlot: FadesterSlot = {
      id: "crossfader",
      name: "Crossfader (A/B)",
      kind: "crossfader",
      target_mode: "layer_opacity",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.5,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    };

    const connectedSvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slot: crossfaderSlot,
      slotId: "crossfader",
      to: 1,
      durationMs: 1000
    });
    expect(connectedSvg).toContain('data-title-lines="2"');
    expect(connectedSvg).toContain("Crossfader<tspan");
    expect(connectedSvg).toContain("(A/B)</tspan>");
    expect(connectedSvg).not.toContain("Crossfade…");
    assertSvgRules(connectedSvg);

    const disconnectedSvg = renderAutoFadeKeySvg({
      status: {
        kind: "obs_unreachable",
        sentence: "OBS is not running or the websocket is off (Tools > WebSocket Server Settings)",
        cellReason: "OBS is not running or websocket is off"
      },
      slot: crossfaderSlot,
      slotId: "crossfader",
      to: 1,
      durationMs: 1000
    });
    expect(disconnectedSvg).toContain('data-title-lines="2"');
    expect(disconnectedSvg).toContain("Crossfader<tspan");
    assertSvgRules(disconnectedSvg);
  });

  it("renders Midi Fadester 0.3.0 verbatim reason for profile-disabled slots (target_mode=unassigned, available=false) and parked indicator", () => {
    const disabledByProfileSlot: FadesterSlot = {
      id: "crossfader",
      name: "Crossfader (A/B)",
      kind: "crossfader",
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.72,
      takeover_pending: "none",
      parked: false,
      label: "Disabled",
      available: false,
      reason: "Not used. Click to set up."
    };

    const dialSvg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot: disabledByProfileSlot,
      slotId: "crossfader"
    });
    expect(dialSvg).toContain("Not used. Click to set up.");
    expect(dialSvg).toContain(PLAYLISTER_PALETTE.orangeAccent);
    expect(dialSvg).not.toContain("Unassigned, set in OBS");
    expect(dialSvg).not.toContain("72%");
    assertSvgRules(dialSvg);

    const keySvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slot: disabledByProfileSlot,
      slotId: "crossfader",
      to: 1,
      durationMs: 1000
    });
    expect(keySvg).toContain("Not used. Click to set up.");
    expect(keySvg).not.toContain("Unassigned, set in OBS");
    expect(keySvg).not.toContain("72%");
    assertSvgRules(keySvg);

    const parkedSlot: FadesterSlot = {
      ...disabledByProfileSlot,
      target_mode: "tbar",
      available: true,
      reason: "",
      value: 1.0,
      parked: true
    };
    const parkedSvg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot: parkedSlot,
      slotId: "crossfader"
    });
    expect(parkedSvg).toContain('data-parked="true"');
    assertSvgRules(parkedSvg);
  });

  it("renders FX readouts and All FX states within the two-line, 3px-stroke visual rules", () => {
    const fxSlot: FadesterSlot = {
      id: "fx_1",
      name: "FX 1",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Cam 1",
      source_b: "",
      filter_name: "Blur",
      filter_prop: "radius",
      from_val: 0,
      to_val: 32,
      bypass_at_zero: true,
      curve: "linear",
      afv: false,
      value: 0.44,
      display_value: "14.1 px",
      takeover_pending: "none",
      label: "Cam 1 • Blur",
      available: true,
      reason: ""
    };

    const fxDialSvg = renderDialCellSvg({
      status: CONNECTED_STATUS,
      slot: fxSlot,
      slotId: "fx_1"
    });
    expect(fxDialSvg).toContain('data-cell="fx"');
    expect(fxDialSvg).toContain("14.1 px");
    expect(fxDialSvg).toContain(PLAYLISTER_PALETTE.fxCyanStart);
    expect(fxDialSvg).toContain(PLAYLISTER_PALETTE.fxAmberEnd);
    assertSvgRules(fxDialSvg);

    const fxKeySvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slot: fxSlot,
      slotId: "fx_1",
      to: 0,
      durationMs: 0
    });
    expect(fxKeySvg).toContain('data-key="auto-fade"');
    expect(fxKeySvg).toContain("14.1 px");
    assertSvgRules(fxKeySvg);

    const allFxSvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slots: [
        fxSlot,
        {
          ...fxSlot,
          id: "fx_2",
          name: "FX 2",
          target_mode: "unassigned",
          value: 0,
          display_value: "0 (Off)",
          label: "FX 2"
        }
      ],
      slotId: "__all_fx__",
      to: 0,
      durationMs: 0
    });
    expect(allFxSvg).toContain('data-key="clean-fx"');
    expect(allFxSvg).toContain('data-active-fx="1"');
    expect(allFxSvg).toContain("CLEAN FX");
    assertSvgRules(allFxSvg);

    const mixedSlots: FadesterSlot[] = [
      { ...fxSlot, target_mode: "audio_volume", value: 0.8 },
      { ...fxSlot, id: "fx_2", enabled: false, value: 0.9 },
      { ...fxSlot, id: "fx_3", target_mode: "crossfade_ab", value: 0.7 },
      { ...fxSlot, id: "fx_4", target_mode: "layer_opacity", value: 0.6 },
      { ...fxSlot, id: "fader_7", kind: "fader", value: 0.4 }
    ];
    const renderMixed = (slots: FadesterSlot[]) => renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slots,
      slotId: "__all_fx__",
      to: 0,
      durationMs: 0,
      labelOverride: "Panic & FX"
    });
    const mixedSvg = renderMixed(mixedSlots);
    expect(mixedSvg).toContain('data-active-fx="1"');
    expect(mixedSvg).toContain("Panic &amp; FX");
    assertSvgRules(mixedSvg);
    const cleanSvg = renderMixed(mixedSlots.map((slot) =>
      slot.id === "fader_7" ? { ...slot, value: 0 } : slot
    ));
    expect(cleanSvg).toContain('data-active-fx="0"');
    expect(cleanSvg).toContain("ALL 0%");
    expect(cleanSvg).toContain("Panic &amp; FX");
    assertSvgRules(cleanSvg);

    const legacyAllFxSvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slots: [
        {
          ...fxSlot,
          id: "fader_1",
          name: "Fader 1",
          kind: "fader",
          target_mode: "layer_opacity",
          label: "Cam 1"
        }
      ],
      slotId: "__all_fx__",
      to: 0,
      durationMs: 0
    });
    expect(legacyAllFxSvg).toContain('data-key="status"');
    expect(legacyAllFxSvg).toContain("Update Midi Fadester to 0.4.0");
    assertSvgRules(legacyAllFxSvg);
  });
});
