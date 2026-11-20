// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension service worker (docs/vjster/REQUIREMENTS.md R-LNK-3,
// R-TGT-1..4; PLAN.md 3.7). The wiring is in worker-core.ts; this file only
// hands it the real chrome object and WebSocket.

import type { SocketLike } from "./link-client.js";
import { installWorker, type WorkerChrome } from "./worker-core.js";

// A first install opens the options page, which says the extension needs the VJster plugin and links to it.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});

const worker = installWorker({
  chrome: chrome as unknown as WorkerChrome,
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  now: () => Date.now(),
  random: Math.random,
  log: (line) => console.info(line)
});

// Tabs that were open before the install, or whose scripts an update orphaned, get VJster's scripts now, so a video
// that is already playing can be controlled without reloading its tab (which would stop it).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") void worker.adoptOpenTabs();
});
