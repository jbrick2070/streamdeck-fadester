// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: one YouTube video in an OBS browser source, driven from the
// deck over the loopback link as the `obs` target (docs/vjster/REQUIREMENTS.md
// R-OBS-1..3, D-5 a; PLAN.md Phase 2). The plugin serves this page itself at
// http://127.0.0.1:<port>/obs, so YouTube sees a proper http origin. The
// start-up is in page-boot.ts and the logic in page-core.ts; this file only
// hands them the real browser.

import type { SocketLike } from "../../vjster-extension/src/link-client.js";
import type { EmbedPlayer } from "./embed-control.js";
import { bootPage, type PlayerOptions } from "./page-boot.js";

declare global {
  interface Window {
    YT?: { Player: new (id: string, options: PlayerOptions) => EmbedPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

bootPage({
  location,
  replaceAddress: (url) => history.replaceState(null, "", url),
  show: (text) => {
    const note = document.getElementById("note");
    if (note) note.textContent = text;
  },
  addScript: (src, onError) => {
    const script = document.createElement("script");
    script.src = src;
    script.onerror = () => {
      script.remove();
      onError();
    };
    document.head.appendChild(script);
  },
  onApiReady: (fn) => {
    window.onYouTubeIframeAPIReady = fn;
  },
  createPlayer: (id, options) => (window.YT ? new window.YT.Player(id, options) : null),
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  random: Math.random
});
