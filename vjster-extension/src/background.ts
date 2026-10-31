// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension service worker (docs/vjster/REQUIREMENTS.md R-LNK-3,
// R-TGT-1..4; PLAN.md 3.7). The wiring is in worker-core.ts; this file only
// hands it the real chrome object and WebSocket.

import type { SocketLike } from "./link-client.js";
import { installWorker, type WorkerChrome } from "./worker-core.js";

installWorker({
  chrome: chrome as unknown as WorkerChrome,
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  now: () => Date.now(),
  random: Math.random,
  log: (line) => console.info(line)
});
