// SPDX-License-Identifier: GPL-2.0-or-later
// A dial turned while it is held in (push-and-turn) is a turn: its release must not fire the press action, and on the
// Midi Fadester dial the long press must not fire either. VJster's dials already work this way (turnedWhileDown).
import { afterEach, describe, expect, it, vi } from "vitest";
import { FaderDialAction, FaderDialInstanceController } from "../src/actions/fader-dial.js";
import { ObsFaderDialAction, ObsFaderDialInstanceController } from "../src/actions/obs-fader-dial.js";
import { ObsLayerControlAction, ObsLayerInstanceController } from "../src/actions/obs-layer-control.js";
import { LayerController } from "../src/control/layer-controller.js";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";

afterEach(() => { vi.useRealTimers(); });

function faderDial() {
  const client = {
    isConnected: vi.fn(() => true),
    nudgeReconnect: vi.fn(),
    nudgeFader: vi.fn(async () => {}),
    setFaderValue: vi.fn(async () => {}),
    autoFade: vi.fn(async () => {}),
    resetFx: vi.fn(async () => {})
  };
  const store = {
    getClient: () => client,
    getSlot: () => ({ id: "fader_1", available: true, value: 0.3, target_mode: "opacity" }),
    on: vi.fn(), off: vi.fn()
  };
  const sink = { setFeedback: vi.fn(async () => {}), showAlert: vi.fn(async () => {}) };
  const controller = new FaderDialInstanceController(store as unknown as FadesterStore, sink,
    { slot: "fader_1", pressAction: "snap_0_100", longPressAction: "auto_fade_3s" }, 1);
  return { controller, client };
}

function obsFaderDial() {
  const catalog = { studioMode: true, currentProgramScene: "Live", currentPreviewScene: "Next", tbarPosition: 0, inputVolumes: {} };
  const client = {
    isConnected: vi.fn(() => true),
    getCatalog: vi.fn(() => catalog),
    nudgeReconnect: vi.fn(),
    takeTbar: vi.fn(async () => {}),
    nudgeTbar: vi.fn(async () => {})
  };
  const sink = { setFeedback: vi.fn(async () => {}), showAlert: vi.fn(async () => {}) };
  const controller = new ObsFaderDialInstanceController(client as unknown as DirectObsClient, sink,
    { target: "tbar", pressAction: "finish_transition" }, 1);
  return { controller, client };
}

function layerDial() {
  const layers = { perform: vi.fn(async () => {}), client: { isConnected: () => true, nudgeReconnect: vi.fn() } };
  const controller = new ObsLayerInstanceController(layers as unknown as LayerController,
    { render: async () => {}, showAlert: async () => {} }, true, { dialMode: "blend" });
  return { controller, layers };
}

describe("Push-and-turn on the dials", () => {
  it("Midi Fadester dial: a pressed turn fires neither the long press nor the release's press", async () => {
    vi.useFakeTimers();
    const { controller, client } = faderDial();
    controller.handleDialDown();
    await controller.handleRotate(2, 1000, true);
    expect(client.nudgeFader).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    await controller.handleDialUp();
    expect(client.autoFade).not.toHaveBeenCalled();
    expect(client.setFaderValue).not.toHaveBeenCalled();
    // The next plain press works as before.
    controller.handleDialDown();
    await controller.handleDialUp();
    expect(client.setFaderValue).toHaveBeenCalledOnce();
    // A turn that is not pressed leaves the press alone.
    controller.handleDialDown();
    await controller.handleRotate(1, 5000, false);
    await controller.handleDialUp();
    expect(client.setFaderValue).toHaveBeenCalledTimes(2);
  });

  it("T-bar dial: the release after a pressed turn does not take the scene to air", async () => {
    const { controller, client } = obsFaderDial();
    controller.handleDialDown();
    await controller.handleRotate(3, 1000, true);
    expect(client.nudgeTbar).toHaveBeenCalledOnce();
    await controller.handleDialUp();
    expect(client.takeTbar).not.toHaveBeenCalled();
    controller.handleDialDown();
    await controller.handleDialUp();
    expect(client.takeTbar).toHaveBeenCalledOnce();
  });

  it("Source & Layer dial: the release after a pressed turn does not reset the blend", async () => {
    const { controller, layers } = layerDial();
    controller.dialDown();
    await controller.rotate(1, true);
    expect(layers.perform).toHaveBeenLastCalledWith(expect.anything(), "blend_next", 1);
    await controller.dialUp();
    expect(layers.perform).toHaveBeenCalledOnce();
    controller.dialDown();
    await controller.dialUp();
    expect(layers.perform).toHaveBeenLastCalledWith(expect.anything(), "blend_normal", 1);
  });

  it("each action passes Stream Deck's pressed flag on to its dial", async () => {
    const ev = (pressed: boolean) => ({ action: { id: "d" }, payload: { ticks: 1, pressed, settings: {} } });
    const fader = { handleRotate: vi.fn(async () => {}), handleDialDown: vi.fn(), handleDialUp: vi.fn(async () => {}) };
    const faderAction = Object.assign(Object.create(FaderDialAction.prototype), { instances: new Map([["d", fader]]) });
    await faderAction.onDialRotate(ev(true));
    expect(fader.handleRotate).toHaveBeenCalledWith(1, expect.any(Number), true);

    const obs = { handleRotate: vi.fn(async () => {}), handleDialDown: vi.fn(), handleDialUp: vi.fn(async () => {}) };
    const obsAction = Object.assign(Object.create(ObsFaderDialAction.prototype), { instances: new Map([["d", obs]]) });
    await obsAction.onDialRotate(ev(true));
    obsAction.onDialDown(ev(false));
    expect(obs.handleRotate).toHaveBeenCalledWith(1, expect.any(Number), true);
    expect(obs.handleDialDown).toHaveBeenCalledOnce();

    const layer = { rotate: vi.fn(async () => {}), dialDown: vi.fn(), dialUp: vi.fn(async () => {}), press: vi.fn(async () => {}) };
    const layerAction = Object.assign(Object.create(ObsLayerControlAction.prototype), { instances: new Map([["d", layer]]) });
    await layerAction.onDialRotate(ev(true));
    layerAction.onDialDown(ev(false));
    await layerAction.onDialUp(ev(false));
    expect(layer.rotate).toHaveBeenCalledWith(1, true);
    expect(layer.dialDown).toHaveBeenCalledOnce();
    expect(layer.dialUp).toHaveBeenCalledOnce();
    expect(layer.press).not.toHaveBeenCalled();
  });
});
