// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the bridge, run in the isolated world (docs/vjster/PLAN.md
// 3.7). The logic is in bridge-core.ts; this file only hands it the real
// window and chrome.runtime.

import { installBridge, type BridgeRuntime, type BridgeWindow } from "./bridge-core.js";
import { installHotkeys, type HotkeyStorage, type HotkeyWindow } from "./hotkeys.js";

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
  const bridge = installBridge(window as unknown as BridgeWindow, chrome.runtime as unknown as BridgeRuntime);
  // Keyboard hotkeys: installed only while the operator has them on (off by default, hotkeys.ts).
  let counter = 0;
  const prefix = Math.floor(Math.random() * 36 ** 6).toString(36);
  const storage: HotkeyStorage = { get: (keys) => chrome.storage.local.get(keys), onChanged: chrome.storage.onChanged };
  installHotkeys(window as unknown as HotkeyWindow, storage, {
    post: (intent) => bridge.intentToPage(intent),
    newId: () => `hk${prefix}-${++counter}`,
    alive
  });
}
