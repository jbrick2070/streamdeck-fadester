// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: the page's logic without the DOM (docs/vjster/
// REQUIREMENTS.md R-OBS-1..3, R-INT-4, R-LNK-3), so it is tested in Node
// against the real link server. player-page.ts feeds it the YouTube player
// and its events.

import { PROTOCOL_VERSION, errorReply, type Intent, type StateReport } from "../../src/vjster/shared/protocol.js";
import { Adapter, type Report } from "../../vjster-extension/src/adapter-core.js";
import { LinkClient, type SocketLike } from "../../vjster-extension/src/link-client.js";
import { embedControl, type AskedRate, type EmbedPlayer } from "./embed-control.js";
import { linkUrl, type PageParams } from "./page-params.js";
import { SETTLE_MS, SettledAnswers, type SettleTimers } from "./settle.js";

export interface ObsPageDeps {
  readonly params: PageParams;
  openSocket(url: string): SocketLike;
  readonly timers: SettleTimers;
  newId(): string;
  /** Jitter for the link's backoff; tests pass a constant. */
  random?: () => number;
}

/** YouTube's "unstarted" state: a new video of a playlist is loading. */
const UNSTARTED = -1;
const PLAYING = 1;

export class ObsPage {
  readonly link: LinkClient;
  readonly adapter: Adapter;
  private readonly settled: SettledAnswers;
  private player: EmbedPlayer | null = null;
  /** A new video started loading; its first play re-applies a held rate once more. */
  private rolledOver = false;
  /** The rate last asked of the embed, until its getter shows it or SETTLE_MS passes (embed-control.ts: the getter lags). */
  private askedRate: number | null = null;
  private askedTimer: unknown = null;
  private readonly asked: AskedRate = {
    get: () => this.askedRate,
    set: (rate) => {
      this.forgetAskedRate();
      this.askedRate = rate;
      // An embed that ignores the change never reports it: stop counting from it after the settle wait.
      this.askedTimer = this.deps.timers.setTimeout(() => {
        this.askedTimer = null;
        this.askedRate = null;
      }, SETTLE_MS);
    }
  };

  constructor(private readonly deps: ObsPageDeps) {
    this.settled = new SettledAnswers((id) => this.adapter.answer(id), deps.timers);
    this.adapter = new Adapter(
      () => (this.player ? embedControl(this.player, this.asked) : null),
      (report) => {
        if (this.settled.passes(report)) this.toLink(report);
      },
      { dedupe: true }
    );
    this.link = new LinkClient({
      url: () => linkUrl(deps.params),
      open: deps.openSocket,
      onIntent: (intent) => this.handle(intent),
      onOpen: () => this.adapter.refresh(),
      newId: deps.newId,
      random: deps.random,
      target: "obs"
    });
  }

  start(): void {
    this.link.start();
  }

  stop(): void {
    this.link.stop();
    this.settled.dispose();
    this.adapter.dispose();
    this.forgetAskedRate();
  }

  /** YouTube's player is ready: from now on intents reach it. */
  playerReady(player: EmbedPlayer): void {
    this.player = player;
    this.adapter.refresh();
  }

  /** onStateChange: play, pause, buffering, a new video of a playlist. */
  stateChanged(state: number): void {
    // Answer a waiting play/pause first, so the adapter counts that state as sent and sends no second copy.
    this.settled.playerEvent("state");
    // A new video of a playlist: a held rate goes back on (R-SPD-4), and again when it starts
    // playing, in case the embed resets the rate in between (not seen live yet).
    if (state === UNSTARTED) {
      this.rolledOver = true;
      this.forgetAskedRate();
      this.adapter.elementReplaced();
    } else if (state === PLAYING && this.rolledOver) {
      this.rolledOver = false;
      this.adapter.elementReplaced();
    } else this.adapter.changed();
  }

  /** onPlaybackRateChange. */
  rateChanged(): void {
    // The getter now shows the rate last asked for: relative steps count from it again.
    if (this.askedRate !== null && this.player?.getPlaybackRate() === this.askedRate) this.forgetAskedRate();
    // Answer first, so the adapter counts the new state as sent and sends no second copy of it.
    this.settled.playerEvent("rate");
    this.adapter.changed();
  }

  /** onError: the video cannot play; the next report says what is left. */
  playerError(): void {
    this.adapter.changed();
  }

  private handle(intent: Intent): void {
    // parse does not check that a message names its receiver; each receiver does (docs/vjster/PLAN.md 3.3).
    if (intent.target !== "obs") {
      this.link.send(errorReply("bad-message", "this page is the obs target", intent.id, { id: this.deps.newId(), target: "obs" }));
      return;
    }
    this.settled.begin(intent);
    this.adapter.handle(intent);
  }

  private forgetAskedRate(): void {
    if (this.askedTimer !== null) this.deps.timers.clearTimeout(this.askedTimer);
    this.askedTimer = null;
    this.askedRate = null;
  }

  private toLink(report: Report): void {
    if (report.kind === "error") {
      this.link.send(errorReply(report.code, report.message, report.inReplyTo, { id: this.deps.newId(), target: "obs" }));
      return;
    }
    const message: StateReport = {
      v: PROTOCOL_VERSION,
      id: this.deps.newId(),
      target: "obs",
      type: "state",
      inReplyTo: report.inReplyTo,
      ...report.state,
      // The page's own host is this computer; the deck has nothing to show for it.
      host: null,
      pinned: false
    };
    this.link.send(message);
  }
}

/** The embed's player parameters for this address (R-OBS-2). */
export function playerVars(params: PageParams, origin: string): Record<string, string | number> {
  const vars: Record<string, string | number> = {
    autoplay: 1,
    playsinline: 1,
    controls: 0,
    disablekb: 1,
    rel: 0,
    iv_load_policy: 3,
    fs: 0,
    origin
  };
  if (params.mute) vars.mute = 1;
  if (params.start > 0) vars.start = params.start;
  if (params.playlistId) {
    vars.listType = "playlist";
    vars.list = params.playlistId;
  }
  if (params.loop) {
    vars.loop = 1;
    // A single video loops only as a one-video playlist.
    if (!params.playlistId && params.videoId) vars.playlist = params.videoId;
  }
  return vars;
}
