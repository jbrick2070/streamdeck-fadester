// SPDX-License-Identifier: GPL-2.0-or-later
import streamDeck from "@elgato/streamdeck";
import { FadesterClient } from "./obs/fadester-client.js";
import { FadesterStore } from "./state/fadester-store.js";
import { FaderDialAction } from "./actions/fader-dial.js";
import { AutoFadeKeyAction } from "./actions/auto-fade-key.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  FadesterGlobalSettings
} from "./types/settings.js";

const client = new FadesterClient(DEFAULT_GLOBAL_SETTINGS);
const store = new FadesterStore(client);

function broadcastToPropertyInspector(): void {
  if (!streamDeck.ui.action) {
    return;
  }
  const status = store.getStatus();
  const slots = store.getSlots().map((s) => ({
    id: s.id,
    name: s.name,
    label: s.label,
    target_mode: s.target_mode,
    available: s.available,
    reason: s.reason
  }));
  void streamDeck.ui.sendToPropertyInspector({
    event: "fadesterState",
    status: {
      kind: status.kind,
      sentence: status.sentence,
      cellReason: status.cellReason,
      linkUrl: status.linkUrl ?? ""
    },
    globalSettings: client.getSettings(),
    slots,
    lastErrorComment: store.getLastErrorComment()
  });
}

store.on("changed", broadcastToPropertyInspector);
store.on("vendorError", broadcastToPropertyInspector);

streamDeck.settings.onDidReceiveGlobalSettings<FadesterGlobalSettings>((ev) => {
  client.updateSettings(ev.settings);
  broadcastToPropertyInspector();
});

streamDeck.ui.onDidAppear(() => {
  broadcastToPropertyInspector();
});

streamDeck.ui.onSendToPlugin<{
  event?: string;
  host?: string;
  port?: number;
  password?: string;
}>((ev) => {
  const payload = ev.payload ?? {};
  if (payload.event === "piReady") {
    broadcastToPropertyInspector();
    return;
  }
  if (payload.event === "updateGlobalSettings") {
    const next: FadesterGlobalSettings = {
      host: payload.host ?? DEFAULT_GLOBAL_SETTINGS.host,
      port: Number(payload.port ?? DEFAULT_GLOBAL_SETTINGS.port),
      password: payload.password ?? DEFAULT_GLOBAL_SETTINGS.password
    };
    void streamDeck.settings.setGlobalSettings(next);
    client.updateSettings(next);
    broadcastToPropertyInspector();
    return;
  }
  if (payload.event === "testConnection") {
    client.reconnectNow();
    broadcastToPropertyInspector();
  }
});

streamDeck.actions.registerAction(new FaderDialAction(store));
streamDeck.actions.registerAction(new AutoFadeKeyAction(store));

void streamDeck.connect().then(async () => {
  const globalSettings =
    await streamDeck.settings.getGlobalSettings<FadesterGlobalSettings>();
  client.updateSettings(globalSettings);
  client.start();
});
