// SPDX-License-Identifier: GPL-2.0-or-later
// The standalone VJster Stream Deck plugin (docs/vjster D-12, R-HOME-2):
// the seven VJster actions around one shared hub, the plugin-wide settings,
// and the link status the settings page shows.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { DEFAULT_LINK_PORT } from "../shared/protocol.js";
import { PinAction, QualityDialAction, QualityPresetAction, SpeedDialAction, SpeedPresetAction, SpeedStepAction, TransportAction } from "./actions.js";
import { Hub } from "./hub.js";
import { newObsToken } from "./link-server.js";
import { ObsKeepAlive } from "./obs-keepalive.js";
import { loadObsPage, obsPageAddress, videoIdFrom } from "./obs-page.js";
import { globalSettings, type GlobalSettings } from "./settings.js";

// R-BEH-5: only reasons are logged, never a URL, a title or a message body.
const log = { info: (m: string) => streamDeck.logger.info(m), warn: (m: string) => streamDeck.logger.warn(m) };

// The OBS page is built into bin/obs next to this bundle (vjster-page/rollup.config.mjs) and served at /obs (Phase 2).
// VJSTER_PAGE_DIR points the end-to-end tests at fixture files; Stream Deck never sets it.
const pages = loadObsPage(process.env.VJSTER_PAGE_DIR || join(dirname(fileURLToPath(import.meta.url)), "obs"), log);
/** True once the start-up path has made sure an OBS token exists. */
let startupDone = false;
let current: GlobalSettings = globalSettings({});
const hub = new Hub({ port: DEFAULT_LINK_PORT, log, pages });

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
  await hub.reconfigure({ port: settings.port, allowedExtensionIds: settings.extensionIds, obsToken: settings.obsToken, log, pages });
  keepAlive.set(settings.obsAlwaysOn);
}

/** Merge into the stored plugin-wide settings, save, and apply. */
async function saveGlobal(change: JsonObject): Promise<void> {
  const stored = await streamDeck.settings.getGlobalSettings<JsonObject>();
  const merged = { ...stored, ...change };
  await streamDeck.settings.setGlobalSettings(merged);
  await apply(globalSettings(merged));
}

// The first OBS page to connect turns "keep the link on for OBS" on, so OBS finds its page after a restart.
const keepAlive = new ObsKeepAlive(hub, () => {
  if (current.obsAlwaysOn === null) saveGlobal({ obsAlwaysOn: true }).catch(() => log.warn("could not save keep-the-link-on"));
});

/** The OBS browser source address for what the operator pasted, or with a placeholder. */
function obsAddress(input: unknown): { address: string; found: boolean } {
  if (!current.obsToken) return { address: "", found: false };
  const id = typeof input === "string" ? videoIdFrom(input) : null;
  return { address: obsPageAddress(current.port, current.obsToken, id), found: id !== null };
}

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  const incoming = globalSettings(ev.settings);
  if (startupDone) {
    // A write from a settings page whose copy is older than the plugin's own changes must not lose
    // them: keep the OBS token (the page's address carries it; make one if it was never there) and
    // the keep-the-link-on choice, and write them back.
    const repaired: JsonObject = { ...ev.settings };
    if (incoming.obsToken === null) repaired.obsToken = current.obsToken ?? newObsToken();
    if (!("obsAlwaysOn" in ev.settings) && current.obsAlwaysOn !== null) repaired.obsAlwaysOn = current.obsAlwaysOn;
    if (Object.keys(repaired).length !== Object.keys(ev.settings).length || repaired.obsToken !== ev.settings.obsToken) {
      void streamDeck.settings.setGlobalSettings(repaired).catch(() => undefined);
      void apply(globalSettings(repaired));
      return;
    }
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
    obsPage: pages.size > 0,
    obsAlwaysOn: current.obsAlwaysOn,
    ...obsAddress(null)
  });
}

// Stream Deck drops messages to a settings page that has not appeared yet, so say it again when it does.
streamDeck.ui.onDidAppear(() => sendStatus());

/** The settings page asks for the link's status and for the OBS page address. */
streamDeck.ui.onSendToPlugin<JsonObject>((ev) => {
  const message = ev.payload;
  if (message.event === "status") sendStatus();
  if (message.event === "obs-address") {
    void streamDeck.ui.sendToPropertyInspector({ event: "obs-address", ...obsAddress(message.input) });
  }
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
  startupDone = true;
  settled();
});
