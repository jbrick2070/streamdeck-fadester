// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the bridge, run in the isolated world (docs/vjster/PLAN.md
// 3.7). The logic is in bridge-core.ts; this file only hands it the real
// window and chrome.runtime.

import { installBridge, type BridgeRuntime, type BridgeWindow } from "./bridge-core.js";

installBridge(window as unknown as BridgeWindow, chrome.runtime as unknown as BridgeRuntime);
