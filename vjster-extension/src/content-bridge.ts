// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the bridge, run in the isolated world (docs/vjster/PLAN.md
// 3.7). The logic is in bridge-core.ts; this file only hands it the real
// window and chrome.runtime.

import { installBridge, type BridgeRuntime, type BridgeWindow } from "./bridge-core.js";

// One live bridge per page. After an install or an update the worker gives this script to tabs that are already open
// (worker-core.ts adoptOpenTabs); a page whose bridge still reaches the extension keeps it, one whose bridge was
// orphaned by the update gets this one.
const page = globalThis as { __vjsterBridgeAlive?: () => boolean };
const alive = (): boolean => {
  try {
    return typeof chrome.runtime?.id === "string";
  } catch {
    return false;
  }
};
if (page.__vjsterBridgeAlive?.() !== true) {
  page.__vjsterBridgeAlive = alive;
  // The window's own document goes with it: the bridge reads the page's media elements itself (bridge-core.ts).
  installBridge(window as unknown as BridgeWindow, chrome.runtime as unknown as BridgeRuntime);
}
