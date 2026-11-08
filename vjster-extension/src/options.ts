// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension options: the link port, this extension's id (to pin it in
// the plugin), and the optional all-sites permission (docs/vjster D-4, R-LNK-1..2).

import { DEFAULT_LINK_PORT } from "../../src/vjster/shared/protocol.js";
import { message, translatePage } from "./i18n.js";
import { ALL_SITES_IDS, ALL_SITES_KEY, ALL_SITES_SCRIPTS, PORT_KEY, allSitesChecked, readPort } from "./settings.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get([PORT_KEY, ALL_SITES_KEY]);
  $<HTMLInputElement>("port").value = String(readPort(stored[PORT_KEY]));
  $<HTMLElement>("ext-id").textContent = chrome.runtime.id;
  // The Chrome Web Store build is YouTube only: with no optional all-sites permission in the manifest, the option is not offered.
  const offered = (chrome.runtime.getManifest().optional_host_permissions ?? []).includes("<all_urls>");
  $<HTMLElement>("all-sites-row").hidden = !offered;
  const granted = offered && (await chrome.permissions.contains({ origins: ["<all_urls>"] }));
  $<HTMLInputElement>("all-sites").checked = allSitesChecked(offered, stored[ALL_SITES_KEY], granted);
}

/** Show a status line in Chrome's language (`_locales`, PLAN.md 8.5). */
function status(name: string, substitutions: string[] = []): void {
  $<HTMLElement>("status").textContent = message((n, s) => chrome.i18n.getMessage(n, s), name, substitutions);
}

$<HTMLButtonElement>("save").addEventListener("click", async () => {
  const value = Number($<HTMLInputElement>("port").value);
  const port = readPort(value);
  if (port !== value) {
    status("statusBadPort", [String(DEFAULT_LINK_PORT)]);
    return;
  }
  await chrome.storage.local.set({ [PORT_KEY]: port });
  status("statusSaved", [String(port)]);
});

$<HTMLInputElement>("all-sites").addEventListener("change", async (event) => {
  const box = event.target as HTMLInputElement;
  const ids = ALL_SITES_IDS;
  if (box.checked) {
    // The permission prompt must come from this click.
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) {
      box.checked = false;
      status("statusNotAllowed");
      return;
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
    await chrome.scripting.registerContentScripts(ALL_SITES_SCRIPTS);
    await chrome.storage.local.set({ [ALL_SITES_KEY]: true });
    status("statusAllSites");
  } else {
    await chrome.scripting.unregisterContentScripts({ ids }).catch(() => undefined);
    // Chrome may refuse to drop the permission; the scripts are already gone, so VJster stays on YouTube either way.
    const removed = await chrome.permissions.remove({ origins: ["<all_urls>"] }).catch(() => false);
    await chrome.storage.local.set({ [ALL_SITES_KEY]: false });
    status(removed ? "statusYouTubeOnly" : "statusYouTubeOnlyKept");
  }
});

translatePage(document, (n, s) => chrome.i18n.getMessage(n, s));
void show();
