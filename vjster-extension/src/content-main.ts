// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the adapter, run in the page's own JavaScript world
// ("world": "MAIN") so it can call YouTube's player API
// (docs/vjster/REQUIREMENTS.md F-5; PLAN.md 3.7). It talks only to the bridge,
// by window.postMessage, and re-validates every intent it is given
// (page-wiring.ts).

import { Adapter, type MediaControl } from "./adapter-core.js";
import { chooseVideo, videoControl } from "./generic-video.js";
import { claimPage, listenToBridge, postReport, type PageWindow } from "./page-wiring.js";
import { findYouTubePlayer, isYouTubeHost, youTubeControl, type YouTubePlayerElement } from "./youtube.js";

function start(): void {
  // Run once per page, even if the script is injected twice.
  if (!claimPage(window)) return;
  const win = window as unknown as PageWindow;

  const onYouTube = isYouTubeHost(location.hostname);
  let player: YouTubePlayerElement | null = null;
  let playerControl: MediaControl | null = null;
  let boundVideo: HTMLVideoElement | null = null;
  let adObserver: MutationObserver | null = null;
  let grow: MutationObserver | null = null;

  const pickVideo = (): HTMLVideoElement | null => chooseVideo([...document.querySelectorAll("video")]);
  const genericControl = videoControl(pickVideo);

  const control = (): MediaControl | null => {
    if (onYouTube) {
      bindPlayer();
      return playerControl;
    }
    return pickVideo() ? genericControl : null;
  };

  // Unchanged unsolicited reports are skipped: class changes on the player come often.
  const adapter = new Adapter(control, (report) => postReport(win, report), { dedupe: true });

  const onMediaEvent = (event: Event): void => {
    if (event.type === "loadedmetadata" || event.type === "emptied") adapter.elementReplaced();
    else adapter.changed();
  };
  const MEDIA_EVENTS = ["play", "playing", "pause", "ratechange", "loadedmetadata", "emptied", "ended"];

  function bindVideo(video: HTMLVideoElement | null): void {
    if (video === boundVideo) return;
    for (const type of MEDIA_EVENTS) boundVideo?.removeEventListener(type, onMediaEvent);
    boundVideo = video;
    for (const type of MEDIA_EVENTS) video?.addEventListener(type, onMediaEvent);
  }

  /** Watch the page grow until YouTube's player exists (home, search); stop once it is bound. */
  function watchForPlayer(on: boolean): void {
    if (on && grow === null) {
      grow = new MutationObserver(() => {
        if (findYouTubePlayer(document) !== player) {
          bindPlayer();
          adapter.changed();
        }
      });
      grow.observe(document.documentElement, { childList: true, subtree: true });
    } else if (!on && grow !== null) {
      grow.disconnect();
      grow = null;
    }
  }

  /** Bind YouTube's player when it exists, and re-bind when it was replaced (V-4). */
  function bindPlayer(): void {
    const found = findYouTubePlayer(document);
    if (found !== player) {
      player = found;
      playerControl = found ? youTubeControl(found, document) : null;
      adObserver?.disconnect();
      adObserver = null;
      if (found) {
        // Ad start and end show as class changes on the player (V-3).
        adObserver = new MutationObserver(() => adapter.changed());
        adObserver.observe(found as unknown as HTMLElement, { attributes: true, attributeFilter: ["class"] });
      }
    }
    watchForPlayer(player === null);
    // The real player element is a DOM element; youtube.ts only declares what it uses.
    bindVideo((player as unknown as HTMLElement | null)?.querySelector("video") ?? null);
  }

  listenToBridge(win, adapter);

  if (onYouTube) {
    // In-place navigation keeps the player but changes the video (V-4).
    document.addEventListener("yt-navigate-finish", () => {
      bindPlayer();
      adapter.navigated();
    });
    bindPlayer();
  } else {
    // Any page: follow whichever video is current; media events reach the document in the capture phase.
    for (const type of MEDIA_EVENTS) document.addEventListener(type, (e) => e.target instanceof HTMLVideoElement && onMediaEvent(e), true);
  }
  adapter.changed();
}

start();
