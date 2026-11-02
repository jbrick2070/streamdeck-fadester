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
import { ObsNeoInfobarAction } from "./actions/obs-neo-infobar.js";
import { PlaylisterTransportKeyAction } from "./actions/playlister-transport-key.js";
import { FilterController } from "./control/filter-controller.js";
import { VisualSafety } from "./control/visual-safety.js";
import { ObsFilterControlAction } from "./actions/obs-filter-control.js";
import { VisualPanicKeyAction } from "./actions/visual-panic-key.js";
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
import { useStreamDeckLanguage } from "./i18n/load.js";
import { LanguageChoiceController } from "./i18n/language-choice.js";
import { GlobalSettingsStore, START_READ_TIMEOUT_MS, connectionSaver } from "./settings/global-store.js";

// Stream Deck's language, read once before any control draws (PLAN.md 8.4; 8.7 checks a language change).
// Automatic draws never wait; a fixed choice applies when the stored settings are read (PLAN.md 11.1).
let appLanguage: unknown = "en";
try {
  appLanguage = streamDeck.info.application.language;
  useStreamDeckLanguage(appLanguage);
} catch {
  useStreamDeckLanguage("en");
}

// Every global settings write goes through this one queue, so no save loses another's key (RL-1).
const settingsStore = new GlobalSettingsStore({
  getGlobalSettings: () => streamDeck.settings.getGlobalSettings<FadesterGlobalSettings>(),
  setGlobalSettings: (settings) => streamDeck.settings.setGlobalSettings(settings)
}, START_READ_TIMEOUT_MS, (message) => streamDeck.logger.warn(message));

const enhancedClient = new FadesterClient(DEFAULT_GLOBAL_SETTINGS);
const store = new FadesterStore(enhancedClient);
const directClient = new DirectObsClient(DEFAULT_GLOBAL_SETTINGS);
const layers = new LayerController(directClient);
// The VJ rig (PLAN.md 10): one filter controller and one panic latch for every control.
const filters = new FilterController(directClient);
const visualSafety = new VisualSafety(directClient, filters);

// The Language setting (PLAN.md 11.1): a change redraws every visible control and refills the pages.
const languageChoice = new LanguageChoiceController({
  store: settingsStore,
  appLanguage,
  broadcast() {
    bridge.broadcast();
    directBridge.broadcast();
  },
  log: (message) => streamDeck.logger.warn(message)
});

// The pages' connection saves go through the store's queue; the enhanced client is kept in sync
// too, should the operator later add an enhanced action.
const persistSharedConnection = connectionSaver(settingsStore, [enhancedClient, directClient]);

const bridge = new PropertyInspectorBridge(store, enhancedClient, {
  sendToPropertyInspector(payload) {
    if (!streamDeck.ui.action) {
      return;
    }
    void streamDeck.ui.sendToPropertyInspector(payload as JsonObject);
  },
  persistGlobalSettings: persistSharedConnection,
  getLanguage: () => languageChoice.state()
});

const directBridge = new DirectObsPropertyInspectorBridge(directClient, {
  sendToPropertyInspector(payload) {
    if (!streamDeck.ui.action) {
      return;
    }
    void streamDeck.ui.sendToPropertyInspector(payload as JsonObject);
  },
  persistGlobalSettings: persistSharedConnection,
  getLanguage: () => languageChoice.state(),
  getDeviceType: () => streamDeck.ui.action?.device.type,
  async activateLayout(slug) {
    const device = streamDeck.ui.action?.device;
    if (device) await streamDeck.profiles.switchToProfile(device.id, profilePathForSlug(slug));
  }
}, layers);

streamDeck.settings.onDidReceiveGlobalSettings<FadesterGlobalSettings>((ev) => {
  settingsStore.replace(ev.settings);
  enhancedClient.updateSettings(ev.settings);
  directClient.updateSettings(ev.settings);
  languageChoice.settingsReceived();
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
    if (await languageChoice.handleMessage(payload)) {
      return;
    }
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
streamDeck.actions.registerAction(new ObsNeoInfobarAction(directClient));
streamDeck.actions.registerAction(new PlaylisterTransportKeyAction(directClient));
streamDeck.actions.registerAction(new ObsFilterControlAction(filters));
streamDeck.actions.registerAction(new VisualPanicKeyAction(visualSafety, directClient));

void streamDeck.connect().then(async () => {
  const globalSettings = await settingsStore.start();
  enhancedClient.updateSettings(globalSettings);
  directClient.updateSettings(globalSettings);
  await languageChoice.start();
  directClient.start();
});
