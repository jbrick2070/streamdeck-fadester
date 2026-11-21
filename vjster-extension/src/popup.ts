// SPDX-License-Identifier: GPL-2.0-or-later
// The toolbar button's popup (UI review U2-14): three lines that answer "is VJster working here?" without opening the
// options. The version, whether the link to VJster is up (and what to check when it is not), and which tab VJster
// controls: this one, another one, or none yet. Nothing is drawn on the video page itself, which is often captured
// into OBS.

import { message, translatePage } from "./i18n.js";
import { LINK_STATUS_REQUEST, linkLine, readLinkStatus, tabLine, type LinkStatus } from "./messages.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const text = (name: string, substitutions: string[] = []): string => message((n, s) => chrome.i18n.getMessage(n, s), name, substitutions);

/** How often the lines ask the service worker again, while the popup is open. */
const CHECK_MS = 1500;

/** The tab the popup was opened over: the active tab of the window it belongs to. */
async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return typeof tab?.id === "number" ? tab.id : null;
  } catch {
    return null;
  }
}

async function show(): Promise<void> {
  let answer: LinkStatus | null = null;
  try {
    answer = readLinkStatus(await chrome.runtime.sendMessage(LINK_STATUS_REQUEST));
  } catch {
    answer = null;
  }
  const link = $<HTMLElement>("link-status");
  const next = linkLine(answer, !link.textContent);
  if (answer && next) {
    link.textContent = text(next.name, [String(answer.port)]);
    link.className = next.state;
    // Not connected: what to check, one line per program that can hold the link.
    $<HTMLElement>("link-help").hidden = next.state !== "down" && next.state !== "waiting";
  }
  const tab = tabLine(answer, await activeTabId());
  const line = $<HTMLElement>("tab-status");
  line.hidden = tab === null;
  if (tab !== null) line.textContent = text(tab);
}

$<HTMLElement>("version").textContent = `v${chrome.runtime.getManifest().version}`;
$<HTMLAnchorElement>("open-options").addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});
translatePage(document, (n, s) => chrome.i18n.getMessage(n, s));
void show();
setInterval(() => void show(), CHECK_MS);
