// SPDX-License-Identifier: GPL-2.0-or-later
import streamDeck, { type Device } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { fileURLToPath } from "node:url";
import { isOpenDeckInstall, provisionOpenDeckStarter } from "./opendeck/starter.js";
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
import { readLanguageTable, useStreamDeckLanguage } from "./i18n/load.js";
import { translatorFor } from "./i18n/strings.js";
import { LanguageChoiceController } from "./i18n/language-choice.js";
import { GlobalSettingsStore, START_READ_TIMEOUT_MS, connectionSaver } from "./settings/global-store.js";

// Stream Deck's language, read once before any control draws (PLAN.md 8.4; 8.7 checks a language change).
// Automatic draws never wait; a fixed choice applies when the stored settings are read (PLAN.md 11.1).
let appLanguage: unknown = "en";
let midiPagesLanguage = "en";
try {
  appLanguage = streamDeck.info.application.language;
  midiPagesLanguage = useStreamDeckLanguage(appLanguage);
} catch {
  useStreamDeckLanguage("en");
}
// The two Midi Fadester settings pages stay in Stream Deck's language until they get the Language choice (R-LANG-3,
// PLAN.md step L.6), so what the plugin sends them is worded in that language too, whatever the choice.
const midiPagesTranslate = translatorFor(midiPagesLanguage === "en" ? {} : readLanguageTable(midiPagesLanguage) ?? {});

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

// bin/fadester.js runs inside the installed suite, including after the launcher restarts this child.
const pluginDir = fileURLToPath(new URL("../", import.meta.url));
const openDeckStarters = new Map<string, string>();

const bridge = new PropertyInspectorBridge(store, enhancedClient, {
  sendToPropertyInspector(payload) {
    if (!streamDeck.ui.action) {
      return;
    }
    void streamDeck.ui.sendToPropertyInspector(payload as JsonObject);
  },
  persistGlobalSettings: persistSharedConnection,
  getLanguage: () => languageChoice.state(),
  translate: midiPagesTranslate
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
  getOpenDeckStarter() {
    if (!isOpenDeckInstall(pluginDir)) return undefined;
    const device = streamDeck.ui.action?.device;
    return { profileName: device ? openDeckStarters.get(device.id) ?? null : null };
  },
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

function offerOpenDeckStarter(device: Pick<Device, "id" | "type" | "size">): void {
  openDeckStarters.delete(device.id);
  try {
    const result = provisionOpenDeckStarter({
      pluginDir, deviceId: device.id, deviceType: device.type,
      rows: device.size.rows, columns: device.size.columns
    });
    if (result.status !== "skipped") openDeckStarters.set(device.id, result.name);
  } catch (error) {
    streamDeck.logger.warn("Could not prepare the OpenDeck starter profile", error);
  }
}
// A fresh OpenDeck install can create its profiles directory only when its first device connects.
streamDeck.devices.onDeviceDidConnect(({ device }) => offerOpenDeckStarter(device));
streamDeck.devices.onDeviceDidDisconnect(({ device }) => {
  if (device) openDeckStarters.delete(device.id);
});

void streamDeck.connect().then(async () => {
  // The SDK's registration list also includes devices that have not emitted deviceDidConnect.
  for (const device of streamDeck.devices) offerOpenDeckStarter(device);
  const globalSettings = await settingsStore.start();
  enhancedClient.updateSettings(globalSettings);
  directClient.updateSettings(globalSettings);
  await languageChoice.start();
  directClient.start();
});
