// SPDX-License-Identifier: GPL-2.0-or-later
// The standalone VJster Stream Deck plugin (docs/vjster D-12, R-HOME-2):
// the seven VJster actions around one shared hub, the plugin-wide settings,
// and the link status the settings page shows.

import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { DEFAULT_LINK_PORT } from "../shared/protocol.js";
import { PinAction, QualityDialAction, QualityPresetAction, SpeedDialAction, SpeedPresetAction, SpeedStepAction, TransportAction } from "./actions.js";
import { Hub } from "./hub.js";
import { newObsToken } from "./link-server.js";
import { globalSettings, type GlobalSettings } from "./settings.js";

// R-BEH-5: only reasons are logged, never a URL, a title or a message body.
const log = { info: (m: string) => streamDeck.logger.info(m), warn: (m: string) => streamDeck.logger.warn(m) };

let current: GlobalSettings = globalSettings({});
const hub = new Hub({ port: DEFAULT_LINK_PORT, log });

// No server until the stored settings are applied, so it never runs on the default port or without the
// extension pin; if Stream Deck never answers, the defaults apply after 5 s.
let settled: () => void = () => undefined;
hub.holdUntil(
  new Promise<void>((resolve) => {
    settled = resolve;
    setTimeout(resolve, 5000);
  })
);

async function apply(settings: GlobalSettings): Promise<void> {
  current = settings;
  await hub.reconfigure({ port: settings.port, allowedExtensionIds: settings.extensionIds, obsToken: settings.obsToken, log });
}

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  const incoming = globalSettings(ev.settings);
  if (incoming.obsToken === null && current.obsToken !== null) {
    // A write without the OBS token must not lose it (the OBS page's address carries it): keep it and write it back.
    void streamDeck.settings.setGlobalSettings({ ...ev.settings, obsToken: current.obsToken });
    void apply({ ...incoming, obsToken: current.obsToken });
    return;
  }
  void apply(incoming);
});

/** The link's status for the settings page. */
function sendStatus(): void {
  const browser = hub.view("browser");
  const obs = hub.view("obs");
  void streamDeck.ui.sendToPropertyInspector({
    event: "status",
    port: current.port,
    extensionIds: [...current.extensionIds],
    badIds: current.extensionIds.filter((id) => !/^[a-p]{32}$/.test(id)).length,
    browser: browser.status,
    obs: obs.status,
    portInUse: hub.portInUse,
    obsPageQuery: current.obsToken ? `?port=${current.port}&token=${current.obsToken}` : ""
  });
}

// Stream Deck drops messages to a settings page that has not appeared yet, so say it again when it does.
streamDeck.ui.onDidAppear(() => sendStatus());

/** The settings page asks for the link's status. */
streamDeck.ui.onSendToPlugin<JsonObject>((ev) => {
  if (ev.payload.event === "status") sendStatus();
});

for (const a of [SpeedDialAction, QualityDialAction, SpeedPresetAction, SpeedStepAction, QualityPresetAction, PinAction, TransportAction]) {
  streamDeck.actions.registerAction(new a(hub));
}

void streamDeck.connect().then(async () => {
  const stored = await streamDeck.settings.getGlobalSettings<JsonObject>();
  let settings = globalSettings(stored);
  if (settings.obsToken === null) {
    // One token per install for the Phase 2 OBS page (R-LNK-2), kept in the plugin's settings.
    settings = { ...settings, obsToken: newObsToken() };
    await streamDeck.settings.setGlobalSettings({ ...stored, obsToken: settings.obsToken });
  }
  await apply(settings);
  // Only now, with the stored settings and the OBS token applied, may the server start.
  settled();
});
