// SPDX-License-Identifier: GPL-2.0-or-later
import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { FadesterClient } from "./obs/fadester-client.js";
import { FadesterStore } from "./state/fadester-store.js";
import { FaderDialAction } from "./actions/fader-dial.js";
import { AutoFadeKeyAction } from "./actions/auto-fade-key.js";
import {
  PiIncomingMessage,
  PropertyInspectorBridge
} from "./pi/pi-bridge.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  FadesterGlobalSettings
} from "./types/settings.js";

const client = new FadesterClient(DEFAULT_GLOBAL_SETTINGS);
const store = new FadesterStore(client);

const bridge = new PropertyInspectorBridge(store, client, {
  sendToPropertyInspector(payload) {
    if (!streamDeck.ui.action) {
      return;
    }
    void streamDeck.ui.sendToPropertyInspector(payload as JsonObject);
  },
  async persistGlobalSettings(settings) {
    await streamDeck.settings.setGlobalSettings(settings);
  }
});

streamDeck.settings.onDidReceiveGlobalSettings<FadesterGlobalSettings>((ev) => {
  client.updateSettings(ev.settings);
  bridge.broadcast();
});

streamDeck.ui.onDidAppear(() => {
  bridge.broadcast();
});

streamDeck.ui.onSendToPlugin<JsonObject>((ev) => {
  void bridge.handleMessage(ev.payload as PiIncomingMessage);
});

streamDeck.actions.registerAction(new FaderDialAction(store));
streamDeck.actions.registerAction(new AutoFadeKeyAction(store));

void streamDeck.connect().then(async () => {
  const globalSettings =
    await streamDeck.settings.getGlobalSettings<FadesterGlobalSettings>();
  client.updateSettings(globalSettings);
  client.start();
});
