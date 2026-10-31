// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension options: the link port, this extension's id (to pin it in
// the plugin), and the optional all-sites permission (docs/vjster D-4, R-LNK-1..2).

import { DEFAULT_LINK_PORT } from "../../src/vjster/shared/protocol.js";
import { ALL_SITES_KEY, ALL_SITES_SCRIPTS, PORT_KEY, readPort } from "./settings.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function show(): Promise<void> {
  const stored = await chrome.storage.local.get([PORT_KEY, ALL_SITES_KEY]);
  $<HTMLInputElement>("port").value = String(readPort(stored[PORT_KEY]));
  $<HTMLElement>("ext-id").textContent = chrome.runtime.id;
  $<HTMLInputElement>("all-sites").checked = await chrome.permissions.contains({ origins: ["<all_urls>"] });
}

function status(text: string): void {
  $<HTMLElement>("status").textContent = text;
}

$<HTMLButtonElement>("save").addEventListener("click", async () => {
  const value = Number($<HTMLInputElement>("port").value);
  const port = readPort(value);
  if (port !== value) {
    status(`Use a whole number from 1024 to 65535; ${DEFAULT_LINK_PORT} is the default.`);
    return;
  }
  await chrome.storage.local.set({ [PORT_KEY]: port });
  status(`Saved. VJster now connects to port ${port}.`);
});

$<HTMLInputElement>("all-sites").addEventListener("change", async (event) => {
  const box = event.target as HTMLInputElement;
  const ids = ALL_SITES_SCRIPTS.map((s) => s.id);
  if (box.checked) {
    // The permission prompt must come from this click.
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    if (!granted) {
      box.checked = false;
      status("Not allowed: VJster stays on YouTube only.");
      return;
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (existing.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
    await chrome.scripting.registerContentScripts(ALL_SITES_SCRIPTS);
    await chrome.storage.local.set({ [ALL_SITES_KEY]: true });
    status("VJster now controls videos on every site. Reload open tabs to include them.");
  } else {
    await chrome.scripting.unregisterContentScripts({ ids }).catch(() => undefined);
    // Chrome may refuse to drop the permission; the scripts are already gone, so VJster stays on YouTube either way.
    const removed = await chrome.permissions.remove({ origins: ["<all_urls>"] }).catch(() => false);
    await chrome.storage.local.set({ [ALL_SITES_KEY]: false });
    status(removed ? "VJster is back to YouTube only." : "VJster is back to YouTube only; Chrome kept the all-sites permission, remove it on the extension's details page.");
  }
});

void show();
