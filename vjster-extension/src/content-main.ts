// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: the adapter, run in the page's own JavaScript world
// ("world": "MAIN") so it can call YouTube's player API
// (docs/vjster/REQUIREMENTS.md F-5; PLAN.md 3.7). It talks only to the bridge,
// by window.postMessage, and re-validates every intent it is given
// (page-wiring.ts).

import { Adapter, type MediaControl } from "./adapter-core.js";
import { chooseVideo, videoControl } from "./generic-video.js";
import { claimPage, listenToBridge, postReport, type PageWindow } from "./page-wiring.js";
import { AddedNodes, WholeScan, forEachShadowRoot } from "./shadow-scan.js";
import { findYouTubePlayer, isYouTubeHost, youTubeControl, type YouTubePlayerElement } from "./youtube.js";

/** The shortest gap between two searches of the page for shadow roots. */
const SHADOW_RESCAN_MS = 300;
/** A second whole-page search this long after load, for a player component whose script runs late (shadow-scan.ts). */
const LATE_UPGRADE_MS = 6000;
/** More added nodes than this between two searches: the rest wait for the whole-page search (WholeScan's spacing). */
const MAX_PENDING_NODES = 200;

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

  // Open shadow roots found on this page (web-component players keep their <video> there).
  const shadows = new Set<ShadowRoot>();
  const pickVideo = (): HTMLVideoElement | null => {
    const videos: HTMLVideoElement[] = [...document.querySelectorAll("video")];
    for (const shadow of shadows) if (shadow.host.isConnected) videos.push(...shadow.querySelectorAll("video"));
    return chooseVideo(videos);
  };
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
    const onAnyMedia = (e: Event): void => {
      if (e.target instanceof HTMLVideoElement) onMediaEvent(e);
    };
    for (const type of MEDIA_EVENTS) document.addEventListener(type, onAnyMedia, true);
    // Media events do not leave a shadow root, so each open one gets the same listeners, and is watched for
    // players added later. Busy pages change all the time, so a rescan runs at most once per SHADOW_RESCAN_MS.
    // Only what was added is searched (a busy page changes all the time, and a search of the whole document on each
    // change costs every tab, video or not): the nodes a change brought in wait at most SHADOW_RESCAN_MS, then each is
    // searched once. Past MAX_PENDING_NODES the rest is left to the whole search below, with its spacing. A shadow root
    // attached to an element that was already there (a player component upgraded after its markup) adds no node, so
    // every change also asks for one whole search, which WholeScan runs seldom (shadow-scan.ts).
    const whole = new WholeScan(() => rescan([document]));
    const added = new AddedNodes<Element>(
      (nodes) => rescan(nodes.filter((node) => node.isConnected)), whole, SHADOW_RESCAN_MS, MAX_PENDING_NODES);
    const grown = new MutationObserver((records) => {
      whole.request();
      for (const record of records) {
        added.add([...record.addedNodes].filter((node): node is Element => node instanceof Element));
      }
    });
    const adopt = (shadow: ShadowRoot): boolean => {
      if (shadows.has(shadow)) return false;
      shadows.add(shadow);
      for (const type of MEDIA_EVENTS) shadow.addEventListener(type, onAnyMedia, true);
      grown.observe(shadow, { childList: true, subtree: true });
      return true;
    };
    const rescan = (roots: ReadonlyArray<Document | Element>): void => {
      for (const shadow of shadows) if (!shadow.host.isConnected) shadows.delete(shadow);
      let added = false;
      for (const root of roots) {
        // An added element may itself be the web component that holds the player.
        const own = root instanceof Element ? root.shadowRoot : null;
        if (own && adopt(own)) {
          added = true;
          forEachShadowRoot(own, (found) => { adopt(found as unknown as ShadowRoot); });
        }
        forEachShadowRoot(root, (found) => {
          if (adopt(found as unknown as ShadowRoot)) added = true;
        });
      }
      if (added) adapter.changed();
    };
    grown.observe(document.documentElement, { childList: true, subtree: true });
    rescan([document]);
    // Scripts that define components often run at or after load, with no change to the page's own nodes: one search
    // when the page has loaded and one more a little later, for a component defined after that on a page that then
    // stays still.
    const afterLoad = (): void => {
      whole.request();
      setTimeout(() => whole.request(), LATE_UPGRADE_MS);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
  }
  adapter.changed();
}

start();
