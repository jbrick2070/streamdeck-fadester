// SPDX-License-Identifier: GPL-2.0-or-later
import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { FadesterClient } from "./obs/fadester-client.js";
import { DirectObsClient } from "./obs/direct-obs-client.js";
import { FadesterStore } from "./state/fadester-store.js";
import { FaderDialAction } from "./actions/fader-dial.js";
import { AutoFadeKeyAction } from "./actions/auto-fade-key.js";
import { ObsFaderDialAction } from "./actions/obs-fader-dial.js";
import { ObsFadeKeyAction } from "./actions/obs-fade-key.js";
import { ObsSceneTransitionKeyAction } from "./actions/obs-scene-transition-key.js";
import { LayerController } from "./control/layer-controller.js";
import { ObsLayerControlAction } from "./actions/obs-layer-control.js";
import {
  PiIncomingMessage,
  PropertyInspectorBridge
} from "./pi/pi-bridge.js";
import { DirectObsPropertyInspectorBridge } from "./pi/direct-obs-bridge.js";
import { profilePathForSlug } from "./types/layouts.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  FadesterGlobalSettings
} from "./types/settings.js";

const enhancedClient = new FadesterClient(DEFAULT_GLOBAL_SETTINGS);
const store = new FadesterStore(enhancedClient);
const directClient = new DirectObsClient(DEFAULT_GLOBAL_SETTINGS);
const layers = new LayerController(directClient);

async function persistSharedConnection(
  settings: FadesterGlobalSettings
): Promise<void> {
  await streamDeck.settings.setGlobalSettings(settings);
  // Keep an optional enhanced action in sync if the operator later adds one.
  enhancedClient.updateSettings(settings);
  directClient.updateSettings(settings);
}

const bridge = new PropertyInspectorBridge(store, enhancedClient, {
  sendToPropertyInspector(payload) {
    if (!streamDeck.ui.action) {
      return;
    }
    void streamDeck.ui.sendToPropertyInspector(payload as JsonObject);
  },
  persistGlobalSettings: persistSharedConnection
});

const directBridge = new DirectObsPropertyInspectorBridge(directClient, {
  sendToPropertyInspector(payload) {
    if (!streamDeck.ui.action) {
      return;
    }
    void streamDeck.ui.sendToPropertyInspector(payload as JsonObject);
  },
  persistGlobalSettings: persistSharedConnection,
  getDeviceType: () => streamDeck.ui.action?.device.type,
  async activateLayout(slug) {
    const device = streamDeck.ui.action?.device;
    if (device) await streamDeck.profiles.switchToProfile(device.id, profilePathForSlug(slug));
  }
}, layers);

streamDeck.settings.onDidReceiveGlobalSettings<FadesterGlobalSettings>((ev) => {
  enhancedClient.updateSettings(ev.settings);
  directClient.updateSettings(ev.settings);
  bridge.broadcast();
  directBridge.broadcast();
});

streamDeck.ui.onDidAppear(() => {
  bridge.broadcast();
  directBridge.broadcast();
});

streamDeck.ui.onSendToPlugin<JsonObject>((ev) => {
  void (async () => {
    const payload = ev.payload as PiIncomingMessage;
    if (await directBridge.handleMessage(payload)) {
      return;
    }
    await bridge.handleMessage(payload);
  })();
});

streamDeck.actions.registerAction(new FaderDialAction(store));
streamDeck.actions.registerAction(new AutoFadeKeyAction(store));
streamDeck.actions.registerAction(new ObsFaderDialAction(directClient, layers));
streamDeck.actions.registerAction(new ObsFadeKeyAction(directClient));
streamDeck.actions.registerAction(new ObsSceneTransitionKeyAction(directClient));
streamDeck.actions.registerAction(new ObsLayerControlAction(layers));

void streamDeck.connect().then(async () => {
  const globalSettings =
    await streamDeck.settings.getGlobalSettings<FadesterGlobalSettings>();
  enhancedClient.updateSettings(globalSettings);
  directClient.updateSettings(globalSettings);
  directClient.start();
});
