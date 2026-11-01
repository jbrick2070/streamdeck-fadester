// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Playlister transport keys (PLAN.md 9.3, R-PLT-1, R-PLT-6): Previous, Next,
 * Play / pause, Stop, Restart and Status for one Playlister source, driven
 * through the direct client's media queue and drawn from what it observed.
 */
import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent
} from "@elgato/streamdeck";
import { DirectObsClient, MEDIA_QUEUE_LIMIT, MediaStateWord, MediaTargetState } from "../obs/direct-obs-client.js";
import { customCaption } from "../obs/preset-captions.js";
import {
  DEFAULT_PLAYLISTER_TRANSPORT_SETTINGS,
  PlaylisterOperation,
  PlaylisterTransportSettings,
  normalizeLabelOverride,
  normalizePlaylisterOperation
} from "../types/settings.js";
import { CellRateLimiter } from "../gfx/cell-rate-limiter.js";
import { DirectKeyIcon, renderDirectKeySvg, toSvgDataUri } from "../gfx/direct-obs-renderer.js";
import { statusCellReason } from "../../packages/streamdeck-fadester-shared/src/status-text.js";
import { LocalText, errorLocalText, ownText, wordText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { StringKey, t, translate } from "../i18n/strings.js";

interface KeyImageSink {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

const OPERATION_WORDS: Readonly<Record<PlaylisterOperation, StringKey>> = {
  previous: "plOpPrevious",
  next: "plOpNext",
  playpause: "plOpPlayPause",
  stop: "plOpStop",
  restart: "plOpRestart",
  status: "plOpStatus"
};

const OPERATION_ICONS: Readonly<Record<PlaylisterOperation, DirectKeyIcon>> = {
  previous: "media-previous",
  next: "media-next",
  playpause: "play-pause",
  stop: "stop",
  restart: "restart",
  status: "status"
};

const STATE_WORDS: Readonly<Record<MediaStateWord, StringKey>> = {
  none: "mediaStateNone",
  playing: "mediaStatePlaying",
  opening: "mediaStateOpening",
  buffering: "mediaStateBuffering",
  paused: "mediaStatePaused",
  stopped: "mediaStateStopped",
  ended: "mediaStateEnded",
  error: "mediaStateError",
  unknown: "mediaStateUnknown"
};

/** m:ss up to 99:59, h:mm:ss beyond (a two-hour item fits the subtitle). */
export function formatMediaClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60);
  const pad = (value: number): string => String(value).padStart(2, "0");
  if (minutes < 100) return `${minutes}:${pad(seconds)}`;
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds)}`;
}

/** The subtitle: busy, the pending word, or the observed state with its time when known. */
export function describeMediaState(state: MediaTargetState): string {
  if (state.queued >= MEDIA_QUEUE_LIMIT) return t("mediaBusy");
  if (state.pending === "play") return t("mediaPendingPlay");
  if (state.pending === "pause") return t("mediaPendingPause");
  if (state.pending === "unconfirmed") return t("mediaUnconfirmed");
  const word = t(STATE_WORDS[state.mediaState]);
  if (state.mediaCursor !== null && state.mediaDuration !== null) {
    return t("mediaTime", { state: word, cursor: formatMediaClock(state.mediaCursor), duration: formatMediaClock(state.mediaDuration) });
  }
  return word;
}

export class PlaylisterTransportInstanceController {
  private settings: Required<PlaylisterTransportSettings>;
  private visible = false;
  private readonly rateLimiter: CellRateLimiter<string>;
  private releaseWatch: () => void = () => {};
  /** This key's last failed press, cleared on the next press, a retarget or an observed state change. */
  private lastError: LocalText | null = null;
  private lastObservedState: MediaStateWord = "unknown";
  /** Bumped on a retarget and on disappear: a rejection from an older target is dropped. */
  private settingsGeneration = 0;
  /** The cursor moves every poll but the drawn clock once a second: an unchanged picture is not re-sent. */
  private lastSvg = "";
  private readonly onStatusChanged = (): void => this.renderNow();
  private readonly onMediaStateChanged = (inputUuid: string, state: MediaTargetState): void => {
    if (inputUuid !== this.settings.inputUuid) return;
    if (state.mediaState !== this.lastObservedState) {
      this.lastObservedState = state.mediaState;
      this.lastError = null;
    }
    this.renderNow();
  };

  public constructor(
    private readonly client: DirectObsClient,
    private readonly sink: KeyImageSink,
    initialSettings?: PlaylisterTransportSettings,
    rateLimitMs = 100
  ) {
    this.settings = this.mergeSettings(initialSettings);
    this.rateLimiter = new CellRateLimiter<string>(async (svg) => {
      await this.sink.setImage(toSvgDataUri(svg));
    }, rateLimitMs);
  }

  public appear(settings?: PlaylisterTransportSettings): void {
    // A second appear releases the first one's listeners and watch rather than doubling them.
    if (this.visible) this.disappear();
    if (settings) {
      this.settings = this.mergeSettings(settings);
    }
    this.visible = true;
    this.client.on("statusChanged", this.onStatusChanged);
    this.client.on("mediaStateChanged", this.onMediaStateChanged);
    this.acquireWatch();
    this.renderNow();
  }

  public disappear(): void {
    this.visible = false;
    this.settingsGeneration++;
    this.lastSvg = "";
    this.rateLimiter.dispose();
    this.client.off("statusChanged", this.onStatusChanged);
    this.client.off("mediaStateChanged", this.onMediaStateChanged);
    this.releaseWatch();
    this.releaseWatch = () => {};
  }

  public updateSettings(settings: PlaylisterTransportSettings): void {
    const previousUuid = this.settings.inputUuid;
    this.settings = this.mergeSettings(settings);
    if (this.settings.inputUuid !== previousUuid) {
      // Only a retarget invalidates a press in flight; a label or operation edit keeps its outcome.
      this.settingsGeneration++;
      this.lastError = null;
      this.lastObservedState = "unknown";
      this.releaseWatch();
      this.releaseWatch = () => {};
      // A watch belongs to a visible key only.
      if (this.visible) this.acquireWatch();
    }
    this.renderNow();
  }

  public async handleKeyDown(now = Date.now()): Promise<void> {
    if (this.settings.operation === "status") {
      this.renderNow();
      return;
    }
    if (!this.settings.inputUuid) {
      await this.sink.showAlert();
      return;
    }
    if (!this.client.isConnected()) {
      this.client.nudgeReconnect(2000, now);
      await this.sink.showAlert();
      return;
    }
    const generation = this.settingsGeneration;
    this.lastError = null;
    try {
      // A purged press settles quietly; only a refusal or a failed request is shown.
      await this.client.mediaCommand(this.settings.inputUuid, this.settings.operation);
    } catch (error) {
      if (generation !== this.settingsGeneration) return;
      this.lastError = errorLocalText(error, ownText("layerControlFailed"));
      this.renderNow();
      await this.sink.showAlert();
    }
  }

  private acquireWatch(): void {
    this.releaseWatch = this.client.watchMedia(this.settings.inputUuid);
  }

  private renderNow(): void {
    if (!this.visible) {
      return;
    }
    const uuid = this.settings.inputUuid;
    const operation = this.settings.operation;
    const title = customCaption("playlister", this.settings) || t(OPERATION_WORDS[operation]);
    const icon = OPERATION_ICONS[operation];
    const connected = this.client.isConnected();
    const reason = statusCellReason(this.client.getStatus(), translate);
    if (!uuid) {
      this.push(renderDirectKeySvg({
        connected, reason, title, icon, configured: false, unboundSubtitle: t("errorMediaChoose")
      }));
      return;
    }
    const state = this.client.getMediaState(uuid);
    let problem: string | undefined;
    switch (state.availability) {
      case "missing": problem = t("plMissing"); break;
      case "wrong_kind": problem = t("plWrongKind"); break;
      case "unsupported": problem = t("plUnsupported"); break;
      default: problem = this.lastError ? wordText(this.lastError, translate) : undefined;
    }
    this.push(renderDirectKeySvg({
      connected, reason, title, icon, configured: true,
      subtitle: describeMediaState(state),
      ...(problem ? { problem } : {})
    }));
  }

  private push(svg: string): void {
    if (svg === this.lastSvg) return;
    this.lastSvg = svg;
    this.rateLimiter.push(svg);
  }

  private mergeSettings(raw?: PlaylisterTransportSettings): Required<PlaylisterTransportSettings> {
    return {
      inputUuid: typeof raw?.inputUuid === "string" ? raw.inputUuid.trim() : DEFAULT_PLAYLISTER_TRANSPORT_SETTINGS.inputUuid,
      operation: normalizePlaylisterOperation(raw?.operation),
      inputName: typeof raw?.inputName === "string" ? raw.inputName.trim() : DEFAULT_PLAYLISTER_TRANSPORT_SETTINGS.inputName,
      labelOverride: normalizeLabelOverride(raw?.labelOverride)
    };
  }
}

@action({ UUID: "com.jbrick2070.fadester-for-obs.playlister-transport" })
export class PlaylisterTransportKeyAction extends SingletonAction<PlaylisterTransportSettings> {
  private readonly instances = new Map<string, PlaylisterTransportInstanceController>();

  public constructor(private readonly client: DirectObsClient) {
    super();
  }

  public override onWillAppear(ev: WillAppearEvent<PlaylisterTransportSettings>): void {
    if (!ev.action.isKey()) {
      return;
    }
    const key = ev.action;
    // Stream Deck can re-send willAppear for the same key: the old controller releases its watch first.
    this.instances.get(key.id)?.disappear();
    const controller = new PlaylisterTransportInstanceController(
      this.client,
      {
        setImage: (image) => key.setImage(image),
        showAlert: () => key.showAlert()
      },
      ev.payload.settings
    );
    this.instances.set(key.id, controller);
    controller.appear(ev.payload.settings);
  }

  public override onWillDisappear(ev: WillDisappearEvent<PlaylisterTransportSettings>): void {
    const controller = this.instances.get(ev.action.id);
    if (controller) {
      controller.disappear();
      this.instances.delete(ev.action.id);
    }
  }

  public override onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<PlaylisterTransportSettings>
  ): void {
    this.instances.get(ev.action.id)?.updateSettings(ev.payload.settings);
  }

  public override async onKeyDown(ev: KeyDownEvent<PlaylisterTransportSettings>): Promise<void> {
    await this.instances.get(ev.action.id)?.handleKeyDown();
  }
}
