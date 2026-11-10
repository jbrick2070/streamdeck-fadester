// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension options: whether the link to VJster is up, the link port,
// this extension's id (to pin it in the plugin), and the optional all-sites
// permission (docs/vjster D-4, R-LNK-1..2).

import { DEFAULT_LINK_PORT } from "../../src/vjster/shared/protocol.js";
import { message, translatePage } from "./i18n.js";
import { LINK_STATUS_REQUEST, linkLine, readLinkStatus, type LinkStatus } from "./messages.js";
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

/** How often the line at the top asks the service worker how the link is, while this page is open. */
const LINK_CHECK_MS = 2000;

/**
 * The line at the top: linked to VJster on a port, or not linked and what to check. While the link is still
 * opening (the worker just woke up, say) a line that already says something keeps it; the next check tells.
 */
async function showLink(): Promise<void> {
  let answer: LinkStatus | null = null;
  try {
    answer = readLinkStatus(await chrome.runtime.sendMessage(LINK_STATUS_REQUEST));
  } catch {
    answer = null;
  }
  const line = $<HTMLElement>("link-status");
  const next = linkLine(answer, !line.textContent);
  if (!answer || !next) return;
  line.textContent = message((n, s) => chrome.i18n.getMessage(n, s), next.name, [String(answer.port)]);
  // The line's colour: the class is the state, "up", "down" or "connecting" (the page's own colour).
  line.className = next.state;
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
void showLink();
setInterval(() => void showLink(), LINK_CHECK_MS);
