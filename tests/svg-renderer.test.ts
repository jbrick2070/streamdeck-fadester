// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, it, expect } from "vitest";
import {
  renderAutoFadeKeySvg,
  renderDialCellSvg
} from "../src/gfx/svg-renderer.js";
import { PLAYLISTER_PALETTE } from "../src/gfx/palette.js";
import { ConnectionStatusInfo, FadesterSlot } from "../src/types/contract.js";

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

describe("Step 1.3 — Playlister Runtime SVG Renderer (Dial Cells & Keys)", () => {
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
    assertMinStrokeWidth(svg, 3);
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
    assertMinStrokeWidth(svg, 3);
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
    assertMinStrokeWidth(svg, 3);
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
    assertMinStrokeWidth(svg, 3);
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
    assertMinStrokeWidth(unassignedSvg, 3);

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
    assertMinStrokeWidth(unavailableSvg, 3);

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
    assertMinStrokeWidth(disconnectedSvg, 3);

    const keySvg = renderAutoFadeKeySvg({
      status: CONNECTED_STATUS,
      slot: unavailableSlot,
      slotId: "crossfader",
      to: 1,
      durationMs: 1000
    });
    expect(keySvg).toContain("Studio Mode is off");
    assertMinStrokeWidth(keySvg, 3);
  });
});
