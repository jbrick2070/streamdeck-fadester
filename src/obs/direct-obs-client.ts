// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Direct, stock-OBS controls. This deliberately uses only obs-websocket v5
 * requests so the Stream Deck plugin remains useful without Midi Fadester or
 * a connected MIDI controller.
 */
import { FadesterGlobalSettings } from "../types/settings.js";
import { ConnectionStatusInfo } from "../../packages/streamdeck-fadester-shared/src/types.js";
import { automaticInputRole, resolveAutomaticInputName } from "./automatic-targets.js";
import { WholeMixClient } from "./whole-mix.js";
import { LocalText, ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { t } from "../i18n/strings.js";
import {
  bundledNativeTbarPath,
  NATIVE_TBAR_MAX,
  NativeTbar,
  NativeTbarHelper,
  NativeTbarRefusal,
  NativeTbarTimeout,
  nativeTbarBlocker,
  nativeTbarEligible,
  nativeTick
} from "./native-tbar.js";
import {
  ObsVendorClient,
  ObsVendorClientOptions,
  ObsVendorError
} from "../../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";

export const DIRECT_SCENE_NEXT = "__next_scene__";
export const DIRECT_SCENE_PREVIOUS = "__previous_scene__";
export const DIRECT_SCENE_RANDOM = "__random_scene__";
export const DIRECT_SCENE_CURRENT_PREVIEW = "__current_preview__";
export const OBS_TRANSITION_CURRENT = "__current_transition__";
export const OBS_TRANSITION_CUT = "__cut__";
/** The T-bar dial takes in the last 3 % of a throw and cancels a throw turned back into its first 3 %, as Midi
 * Fadester's crossfader does with an APC40 (its rail zones, tbar-logic.h). */
const TBAR_RAIL = 0.03;
/** A take from rest starts OBS's blend one slider step short of the end (1022 of 1023), then finishes it. */
const NATIVE_NEAR_END = (NATIVE_TBAR_MAX - 1) / NATIVE_TBAR_MAX;
/** After a take, encoder ticks are the end of the old throw until the dial has rested this long. */
export const TBAR_SETTLE_MS = 300;
/** Two looks at OBS's transition cursor this far apart tell a fade nobody drives (still) from a timed one (moving). */
const PICKUP_SAMPLE_MS = 100;
/** A take's own Studio Mode events are expected within this time; older counts no longer mask. */
export const TBAR_STUDIO_EVENT_GRACE_MS = 1500;
/** The settle window after a take never grows past this, however long the dial keeps spinning. */
export const TBAR_SETTLE_MAX_MS = 1500;
/** A moving transition cursor counts as a timed transition only this long after OBS said one started. */
export const TBAR_TIMED_TRANSITION_MAX_MS = 10_000;
/** A Scene loop step still pending after this long is stale: it no longer holds the dial. */
const SCENE_CYCLE_HOLD_MAX_MS = 2000;

export type DirectSceneOperation = "preview" | "cut" | "transition";

export function sceneTargetIndex(target: string): number | undefined {
  const match = /^__scene_index_(\d+)__$/.exec(target);
  return match ? Number(match[1]) : undefined;
}

export function automaticSceneTargetLabel(target: string): string | undefined {
  const index = sceneTargetIndex(target);
  return index !== undefined ? t("sceneAutomatic", { n: index + 1 }) : undefined;
}

/** OBS exposes scenes bottom-first; users expect the order of the Scenes dock. */
export function sceneNamesInDisplayOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = [...value];
  if (entries.every((entry) => entry && typeof entry.sceneIndex === "number" && Number.isFinite(entry.sceneIndex))) {
    entries.sort((a, b) => b.sceneIndex - a.sceneIndex);
  }
  return stringArray(entries, "sceneName");
}

/** An OBS input as `GetInputList` reports it; the Playlister keys bind by `inputUuid`. */
export interface DirectObsInputInfo {
  inputUuid: string;
  inputName: string;
  inputKind: string;
  unversionedInputKind: string;
}

/** A scene as `GetSceneList` reports it; filters on a scene are addressed by `sceneUuid`. */
export interface DirectObsSceneInfo {
  sceneName: string;
  sceneUuid: string;
}

/** A group: `GetGroupList` gives names only, the UUID comes from a scene's group item. */
export interface DirectObsGroupInfo {
  groupName: string;
  groupUuid: string;
}

/** A filter as `GetSourceFilterList` and `GetSourceFilter` report it (obs-websocket 5.6.3). */
export interface DirectObsFilterInfo {
  filterName: string;
  /** The versioned kind (`color_filter_v2`, `visual_sidechain_shader_filter`). */
  filterKind: string;
  filterEnabled: boolean;
  filterIndex: number;
  /** Only the values set on this filter: OBS leaves its defaults out. */
  filterSettings: Record<string, unknown>;
}

function readSceneDetails(value: unknown): DirectObsSceneInfo[] {
  if (!Array.isArray(value)) return [];
  const entries = [...value].filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
  if (entries.every((entry) => typeof entry.sceneIndex === "number" && Number.isFinite(entry.sceneIndex))) {
    entries.sort((a, b) => (b.sceneIndex as number) - (a.sceneIndex as number));
  }
  return entries
    .filter((entry) => typeof entry.sceneName === "string" && typeof entry.sceneUuid === "string" && entry.sceneUuid)
    .map((entry) => ({ sceneName: entry.sceneName as string, sceneUuid: entry.sceneUuid as string }));
}

function readFilterInfo(value: unknown, filterName?: string): DirectObsFilterInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = filterName ?? record.filterName;
  if (typeof name !== "string" || !name || typeof record.filterKind !== "string") return null;
  const settings = record.filterSettings;
  return {
    filterName: name,
    filterKind: record.filterKind,
    filterEnabled: record.filterEnabled !== false,
    filterIndex: typeof record.filterIndex === "number" ? record.filterIndex : -1,
    filterSettings: settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) } : {}
  };
}

/*
 * Playlister transport (PLAN.md 9, R-PLT-1..7): stock obs-websocket 5.6.3
 * media requests by inputUuid, with the wire strings pinned here.
 */
export const PLAYLISTER_INPUT_KIND = "obs_playlister_source";
export const MEDIA_REQUIRED_REQUESTS = ["GetInputList", "GetMediaInputStatus", "TriggerMediaInputAction"] as const;
export const OBS_MEDIA_STATES = {
  none: "OBS_MEDIA_STATE_NONE",
  playing: "OBS_MEDIA_STATE_PLAYING",
  opening: "OBS_MEDIA_STATE_OPENING",
  buffering: "OBS_MEDIA_STATE_BUFFERING",
  paused: "OBS_MEDIA_STATE_PAUSED",
  stopped: "OBS_MEDIA_STATE_STOPPED",
  ended: "OBS_MEDIA_STATE_ENDED",
  error: "OBS_MEDIA_STATE_ERROR"
} as const;
export const OBS_MEDIA_ACTIONS = {
  play: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
  pause: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE",
  stop: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP",
  restart: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
  next: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
  previous: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS"
} as const;
export type MediaStateWord = keyof typeof OBS_MEDIA_STATES | "unknown";
export type MediaAction = keyof typeof OBS_MEDIA_ACTIONS;
export type MediaOperation = "previous" | "next" | "playpause" | "stop" | "restart";
export type MediaAvailability = "unbound" | "missing" | "wrong_kind" | "unsupported" | "disconnected" | "ok";
export type MediaPending = "none" | "play" | "pause" | "unconfirmed";
export type MediaCapability = "unknown" | "ok" | "unsupported";
/** A press that Stop purged before it was sent settles as `cancelled`, quietly. */
export type MediaCommandOutcome = "sent" | "cancelled";

/** What a Playlister key draws: observed, never inferred from an accepted request. */
export interface MediaTargetState {
  availability: MediaAvailability;
  mediaState: MediaStateWord;
  /** Milliseconds; null unless PLAYING or PAUSED with a finite, positive duration. */
  mediaCursor: number | null;
  mediaDuration: number | null;
  pending: MediaPending;
  /** Presses queued for this Playlister, the one in flight included. */
  queued: number;
}

export const MEDIA_POLL_MS = 500;
export const MEDIA_QUEUE_LIMIT = 4;
export const MEDIA_PAUSE_WAIT_MS = 20000;
/** The native held-pause window after a load (player.c STARTUP_WINDOW_URL_MS). */
export const MEDIA_LOAD_WINDOW_MS = 15000;

interface MediaStatusReply {
  state: MediaStateWord;
  cursor: number | null;
  duration: number | null;
}

interface MediaCommandEntry {
  op: MediaOperation;
  generation: number;
  resolve: (outcome: MediaCommandOutcome) => void;
  reject: (error: unknown) => void;
}

interface MediaTarget {
  uuid: string;
  watchers: number;
  polling: boolean;
  pollTimer: ReturnType<typeof setTimeout> | null;
  statusInFlight: boolean;
  statusChain: Promise<unknown>;
  /** A fresh read queued behind an in-flight one and not yet sent; later requests share it. */
  trailingRead: Promise<MediaStatusReply> | null;
  lastAppliedSequence: number;
  mediaState: MediaStateWord;
  cursor: number | null;
  duration: number | null;
  pending: MediaPending;
  pendingStamp: number;
  pauseTimer: ReturnType<typeof setTimeout> | null;
  commandStamp: number;
  /** A command with a stamp at or below this may not set a pending intent afterwards. */
  pendingBarrier: number;
  /** When PLAY, NEXT, PREVIOUS or RESTART was last sent; NONE within the held window keeps a pending PAUSE. */
  loadSentAt: number;
  queue: MediaCommandEntry[];
  running: boolean;
  signature: string;
}

function parseMediaStatus(data: Record<string, unknown>): MediaStatusReply {
  const raw = typeof data.mediaState === "string" ? data.mediaState : "";
  const state = (Object.keys(OBS_MEDIA_STATES) as Array<keyof typeof OBS_MEDIA_STATES>)
    .find((word) => OBS_MEDIA_STATES[word] === raw) ?? "unknown";
  const showsTime = state === "playing" || state === "paused";
  // null, non-finite or non-positive is unknown (a held still is PLAYING with duration 0).
  const duration = showsTime && typeof data.mediaDuration === "number" && Number.isFinite(data.mediaDuration) &&
    data.mediaDuration > 0 ? data.mediaDuration : null;
  const cursor = duration !== null && typeof data.mediaCursor === "number" && Number.isFinite(data.mediaCursor)
    ? Math.max(0, Math.min(duration, data.mediaCursor)) : null;
  return { state, cursor, duration };
}

function readInputDetails(value: unknown): DirectObsInputInfo[] {
  if (!Array.isArray(value)) return [];
  const details: DirectObsInputInfo[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.inputUuid !== "string" || typeof record.inputName !== "string" || !record.inputUuid) continue;
    const inputKind = typeof record.inputKind === "string" ? record.inputKind : "";
    details.push({
      inputUuid: record.inputUuid,
      inputName: record.inputName,
      inputKind,
      unversionedInputKind: typeof record.unversionedInputKind === "string" ? record.unversionedInputKind : inputKind.replace(/_v\d+$/, "")
    });
  }
  return details;
}

export interface DirectObsCatalog {
  scenes: string[];
  /** The scenes with their UUIDs, in `scenes`' order (filters on a scene are addressed by UUID). */
  sceneDetails: DirectObsSceneInfo[];
  /** Groups whose UUID OBS gave; read only when OBS has a group. */
  groupDetails: DirectObsGroupInfo[];
  inputs: string[];
  /** Every input with UUID and kind; `inputs` keeps the names for the audio paths. */
  inputDetails: DirectObsInputInfo[];
  transitions: string[];
  studioMode: boolean;
  currentProgramScene: string;
  currentPreviewScene: string;
  currentTransition: string;
  inputVolumes: Record<string, number>;
  /** The last position sent by this plugin. OBS does not expose a stable readback. */
  tbarPosition: number;
}

export type DirectObsClientOptions = Pick<
  ObsVendorClientOptions,
  "baseReconnectMs" | "maxReconnectMs" | "requestTimeoutMs" | "notReadyRetryMs" | "keepaliveMs"
> & {
  /** How long a sent PAUSE waits for an observed PAUSED before the key says "unconfirmed" (tests shorten it). */
  mediaPauseWaitMs?: number;
  /**
   * OBS's own T-bar slider (native-tbar.ts): the bundled helper by default, `false` for WebSocket only,
   * or a test double. `nativePlatform` stands in for `process.platform` in tests.
   */
  nativeTbar?: false | ((port: number) => NativeTbar | undefined);
  nativePlatform?: string;
};

/**
 * What the dial's settings page says about OBS's own slider: it follows the dial, or why not. "off" says nothing (not
 * connected, Studio Mode off, not found out yet, or the slider helper not in use); the page has its own banners.
 */
export type NativeTbarStatus =
  | "following" | "notWindows" | "remote" | "version" | "transition" | "unreachable" | "unavailable" | "off";

/** A throw that moves OBS's real slider: the scenes it started between and where the slider was last put. */
interface NativeThrow {
  live: string;
  next: string;
  at: number;
  started: boolean;
}

/**
 * The bundled helper that moves OBS's own slider (native-tbar.ts). Not used by default since 2026-11-12: a fade the
 * helper leaves part-way can only be closed by moving that same slider, and the operator chose a dial that never gets
 * stuck over one that moves OBS's slider. Pass it as `nativeTbar` to use it.
 */
export function defaultNativeTbar(port: number): NativeTbar | undefined {
  const exe = bundledNativeTbarPath();
  return exe ? new NativeTbarHelper(exe, port) : undefined;
}

/** A string is an OBS text (shown verbatim); our own messages pass a key (`ownText`). */
export class DirectObsError extends ObsVendorError {
  public constructor(comment: string | LocalText, code = -1) {
    super(comment, code);
    this.name = "DirectObsError";
  }
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (entry && typeof entry === "object") {
        const candidate = (entry as Record<string, unknown>)[key];
        return typeof candidate === "string" ? candidate : "";
      }
      return "";
    })
    .filter((entry) => entry.length > 0);
}

function readVolume(data: Record<string, unknown>): number | undefined {
  const value = data.inputVolumeMul;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** OBS's own top of an input's fader: +26 dB. */
const MAX_INPUT_VOLUME_MUL = 20;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * A thin direct-OBS backend. It overrides the vendor client's post-identify
 * step, so a stock OBS connection is healthy even when no vendor plugin is
 * installed.
 */
export class DirectObsClient extends ObsVendorClient {
  public readonly wholeMix = new WholeMixClient(
    () => this.isConnected() && !this.collectionChanging,
    (eventData) => this.sendObsRequest("BroadcastCustomEvent", { eventData }),
    () => this.emit("wholeMixChanged")
  );
  private catalog: DirectObsCatalog = {
    scenes: [],
    sceneDetails: [],
    groupDetails: [],
    inputs: [],
    inputDetails: [],
    transitions: [],
    studioMode: false,
    currentProgramScene: "",
    currentPreviewScene: "",
    currentTransition: "",
    inputVolumes: {},
    tbarPosition: 0
  };
  private readonly inputFadeTokens = new Map<string, number>();
  private readonly inputQueues = new Map<string, Promise<unknown>>();
  private sceneQueue: Promise<unknown> = Promise.resolve();
  private tbarQueue: Promise<unknown> = Promise.resolve();
  private cutTransitionName = "";
  private catalogRefreshGeneration = 0;
  private connectionGeneration = 0;
  private controlGeneration = 0;
  private collectionChanging = false;
  private readonly catalogEventRevisions = { scenes: 0, studio: 0, program: 0, preview: 0, transition: 0, volumes: 0, inputs: 0 };
  private readonly inputVolumeEventRevisions = new Map<string, number>();
  private sceneCycleGeneration = 0;
  private sceneCycle: {
    token: number; live: string; next: string; transition: string; started: boolean; ended: boolean; endedAt?: number;
  } | null = null;
  /** When OBS last said a transition started, 0 once it said it ended (or on a new connection). */
  private transitionStartedAt = 0;
  /** The last reason a T-bar turn was refused or ignored, and when, so a spin logs it once. */
  private lastTbarNote = { reason: "", at: 0 };
  private tbarSettleCap = 0;
  /** A scene mixer take leaves and re-enters Studio Mode: that many StudioModeStateChanged events are its own. */
  private tbarStudioEventsToIgnore = 0;
  private tbarStudioEventsIgnoreUntil = 0;
  /** Encoder ticks that arrive just after a take do not start the next throw before this time. */
  private tbarSettleUntil = 0;
  /**
   * The fade the dial has open: the scene it started from ("" when it was picked up and that is unknown) and the scene
   * it goes to. Kept while `catalog.tbarPosition` is above 0; a Preview picked meanwhile is for the next fade.
   */
  private tbarThrow: { live: string; next: string } | null = null;
  private mediaCapability: MediaCapability = "unknown";
  private mediaGeneration = 0;
  private mediaSequence = 0;
  private readonly mediaTargets = new Map<string, MediaTarget>();
  private readonly mediaPauseWaitMs: number;
  /** A filter kind's static defaults (`GetSourceFilterDefaultSettings`), per connection. */
  private readonly filterDefaults = new Map<string, Promise<Record<string, unknown>>>();
  /** OBS's version string from GetVersion, per connection: the native slider is used only on OBS 33. */
  private obsVersion = "";
  private readonly nativeOption: false | ((port: number) => NativeTbar | undefined);
  private readonly nativePlatform: string;
  /** The helper for this connection's OBS, made on the first throw and ended with the connection. */
  private native: NativeTbar | null = null;
  private nativeTried = false;
  private nativeThrow: NativeThrow | null = null;
  /** What the helper last found: OBS's slider read, refused (window closed or minimised, OBS as administrator), or no helper. */
  private nativeReach: "unknown" | "following" | "unreachable" | "unavailable" = "unknown";
  /** The selected transition's kind, as last read: OBS's slider mixes only with a Fade. */
  private transitionKind = "";

  public constructor(
    initialSettings?: FadesterGlobalSettings,
    options?: DirectObsClientOptions
  ) {
    super(initialSettings, {
      ...options,
      surfaceDisplayName: "Fadester for OBS"
    });
    this.mediaPauseWaitMs = options?.mediaPauseWaitMs ?? MEDIA_PAUSE_WAIT_MS;
    this.nativeOption = options?.nativeTbar ?? false;
    this.nativePlatform = options?.nativePlatform ?? process.platform;
    // Several controls on a full deck intentionally share this one client.
    this.setMaxListeners(0);
    this.on("connectionReset", () => this.wholeMix.reset());
    this.on("connectionReady", () => this.wholeMix.refresh());
    this.on("statusChanged", (status: ConnectionStatusInfo) => {
      if (status.kind !== "connected") {
        this.collectionChanging = false;
        this.connectionGeneration++;
        this.controlGeneration++;
        this.catalogRefreshGeneration++;
        this.cancelAllInputFades();
        this.cancelSceneCycle();
        this.transitionStartedAt = 0;
        this.tbarStudioEventsToIgnore = 0;
        this.tbarSettleUntil = 0;
        this.tbarSettleCap = 0;
        this.mediaCapability = "unknown";
        this.filterDefaults.clear();
        this.endNative();
        this.obsVersion = "";
        this.transitionKind = "";
        // OBS may have restarted or been moved by hand meanwhile: the next throw starts from rest.
        this.catalog.tbarPosition = 0;
        this.invalidateMediaTargets();
        this.emit("connectionReset");
      } else {
        // The first catalog is published before the status turns connected: polls start here.
        this.reconcileMediaTargets();
      }
    });
  }

  public override stop(): void {
    this.collectionChanging = false;
    this.connectionGeneration++;
    this.controlGeneration++;
    this.catalogRefreshGeneration++;
    this.cancelAllInputFades();
    this.cancelSceneCycle();
    this.mediaCapability = "unknown";
    this.filterDefaults.clear();
    this.endNative();
    super.stop();
    // After the socket is gone, so the targets read as disconnected.
    this.invalidateMediaTargets();
    this.emit("connectionReset");
  }

  public override reconnectNow(): void {
    this.collectionChanging = false;
    this.connectionGeneration++;
    this.controlGeneration++;
    this.catalogRefreshGeneration++;
    this.cancelAllInputFades();
    this.cancelSceneCycle();
    this.mediaCapability = "unknown";
    this.filterDefaults.clear();
    super.reconnectNow();
    this.invalidateMediaTargets();
    // A reconnect keeps the status "connected" (no statusChanged): the filter controls and the panic latch learn it here.
    this.emit("connectionReset");
  }

  public override getStatus(): ConnectionStatusInfo {
    return super.getStatus();
  }

  public getCatalog(): DirectObsCatalog {
    return {
      ...this.catalog,
      scenes: [...this.catalog.scenes],
      sceneDetails: this.catalog.sceneDetails.map((scene) => ({ ...scene })),
      groupDetails: this.catalog.groupDetails.map((group) => ({ ...group })),
      inputs: [...this.catalog.inputs],
      inputDetails: this.catalog.inputDetails.map((input) => ({ ...input })),
      transitions: [...this.catalog.transitions],
      inputVolumes: { ...this.catalog.inputVolumes }
    };
  }

  public async refreshCatalog(): Promise<DirectObsCatalog> {
    if (this.collectionChanging) return this.getCatalog();
    const generation = ++this.catalogRefreshGeneration;
    const revisions = { ...this.catalogEventRevisions };
    const volumeRevisions = new Map(this.inputVolumeEventRevisions);
    const [studio, scenes, inputs, transitions, currentTransition, program, preview] =
      await Promise.allSettled([
        this.sendObsRequest("GetStudioModeEnabled"),
        this.sendObsRequest("GetSceneList"),
        this.sendObsRequest("GetInputList"),
        this.sendObsRequest("GetSceneTransitionList"),
        this.sendObsRequest("GetCurrentSceneTransition"),
        this.sendObsRequest("GetCurrentProgramScene"),
        this.sendObsRequest("GetCurrentPreviewScene")
      ]);

    if (generation !== this.catalogRefreshGeneration) return this.getCatalog();

    const next = this.getCatalog();
    let cutTransitionName = this.cutTransitionName;
    if (studio.status === "fulfilled") {
      next.studioMode = studio.value.studioModeEnabled === true;
    }
    if (scenes.status === "fulfilled") {
      next.scenes = sceneNamesInDisplayOrder(scenes.value.scenes);
      next.sceneDetails = readSceneDetails(scenes.value.scenes);
    }
    if (inputs.status === "fulfilled") {
      next.inputs = stringArray(inputs.value.inputs, "inputName");
      next.inputDetails = readInputDetails(inputs.value.inputs);
    }
    if (transitions.status === "fulfilled") {
      next.transitions = stringArray(
        transitions.value.transitions,
        "transitionName"
      );
      const entries = transitions.value.transitions;
      cutTransitionName = Array.isArray(entries)
        ? String(entries.find((entry: Record<string, unknown>) =>
            entry.transitionKind === "cut_transition")?.transitionName ?? "")
        : "";
    }
    if (currentTransition.status === "fulfilled") {
      const name = currentTransition.value.transitionName;
      if (typeof name === "string") {
        next.currentTransition = name;
      }
    }
    if (program.status === "fulfilled") {
      const name = program.value.currentProgramSceneName ?? program.value.sceneName;
      if (typeof name === "string") {
        next.currentProgramScene = name;
      }
    }
    if (preview.status === "fulfilled") {
      const name = preview.value.currentPreviewSceneName ?? preview.value.sceneName;
      if (typeof name === "string") {
        next.currentPreviewScene = name;
      }
    }

    const groupsRead = this.readGroupDetails(next.scenes, generation);
    const volumeResponses = await Promise.all(
      next.inputs.map(async (inputName) => {
        try {
          return [
            inputName,
            readVolume(await this.sendObsRequest("GetInputVolume", { inputName }))
          ] as const;
        } catch {
          return [inputName, undefined] as const;
        }
      })
    );
    const groups = await groupsRead;
    if (groups) next.groupDetails = groups;
    next.inputVolumes = {};
    for (const [inputName, volume] of volumeResponses) {
      if (volume !== undefined) {
        next.inputVolumes[inputName] = volume;
      }
    }

    // OBS changes can trigger overlapping discovery requests. Only the latest
    // snapshot may replace the catalog, including after reconnect/collection changes.
    if (generation !== this.catalogRefreshGeneration) return this.getCatalog();
    // Events received while requests were in flight are newer than the
    // corresponding snapshot; keep their values instead of rolling UI back.
    if (revisions.scenes !== this.catalogEventRevisions.scenes) {
      next.scenes = [...this.catalog.scenes];
      next.sceneDetails = this.catalog.sceneDetails.map((scene) => ({ ...scene }));
    }
    if (revisions.studio !== this.catalogEventRevisions.studio) next.studioMode = this.catalog.studioMode;
    if (revisions.program !== this.catalogEventRevisions.program) next.currentProgramScene = this.catalog.currentProgramScene;
    if (revisions.preview !== this.catalogEventRevisions.preview) next.currentPreviewScene = this.catalog.currentPreviewScene;
    if (revisions.transition !== this.catalogEventRevisions.transition) next.currentTransition = this.catalog.currentTransition;
    // An InputRemoved or rename applied meanwhile is newer than this listing: never resurrect the input.
    // (Insurance: both events also start a refresh that supersedes this one, so no path reaches it today.)
    if (revisions.inputs !== this.catalogEventRevisions.inputs) {
      next.inputDetails = this.catalog.inputDetails.map((input) => ({ ...input }));
    }
    if (revisions.volumes !== this.catalogEventRevisions.volumes) {
      for (const name of Object.keys(next.inputVolumes)) {
        if (volumeRevisions.get(name) !== this.inputVolumeEventRevisions.get(name) && Object.hasOwn(this.catalog.inputVolumes, name)) {
          next.inputVolumes[name] = this.catalog.inputVolumes[name];
        }
      }
    }
    next.tbarPosition = this.catalog.tbarPosition;
    this.cutTransitionName = cutTransitionName;
    this.catalog = next;
    this.reconcileMediaTargets();
    this.emitDirectState();
    return this.getCatalog();
  }

  public async getInputVolume(inputName: string): Promise<number> {
    const generation = this.controlGeneration;
    this.requireControlGeneration(generation);
    const name = this.requireInputName(inputName);
    const data = await this.sendObsRequest("GetInputVolume", { inputName: name });
    this.requireControlGeneration(generation);
    const volume = readVolume(data);
    if (volume === undefined) {
      throw new DirectObsError(ownText("errorNoVolume", { input: name }), 500);
    }
    this.catalog.inputVolumes[name] = volume;
    this.emitDirectState();
    return volume;
  }

  public async setInputVolume(inputName: string, value: number): Promise<number> {
    this.requireControlGeneration(this.controlGeneration);
    const name = this.requireInputName(inputName);
    this.cancelInputFade(name);
    return this.queueInput(name, () => this.writeInputVolume(name, value));
  }

  public async nudgeInputVolume(inputName: string, delta: number): Promise<number> {
    this.requireControlGeneration(this.controlGeneration);
    const name = this.requireInputName(inputName);
    this.cancelInputFade(name);
    return this.queueInput(name, async (generation) => {
      const current = await this.getInputVolume(name);
      // A source boosted above 0 dB in OBS keeps its boost: a turn up leaves it, a turn down starts from it.
      return this.writeInputVolume(name, current + delta, generation, Math.max(1, current));
    });
  }

  /** Runs a local, cancellable input-volume fade without changing OBS's
   * global scene-transition duration. */
  public async fadeInputVolume(
    inputName: string,
    target: number,
    durationMs: number
  ): Promise<void> {
    this.requireControlGeneration(this.controlGeneration);
    const name = this.requireInputName(inputName);
    const token = (this.inputFadeTokens.get(name) ?? 0) + 1;
    this.inputFadeTokens.set(name, token);
    const from = await this.queueInput(name, () => this.getInputVolume(name));
    if (this.inputFadeTokens.get(name) !== token) {
      return;
    }
    const ms = Math.max(0, Math.round(durationMs));
    if (ms === 0) {
      await this.queueInput(name, async () => {
        if (this.inputFadeTokens.get(name) === token) {
          await this.writeInputVolume(name, target);
        }
      });
      return;
    }
    const startedAt = Date.now();
    while (this.inputFadeTokens.get(name) === token) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(75, ms)));
      if (this.inputFadeTokens.get(name) !== token) {
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / ms);
      await this.queueInput(name, async () => {
        if (this.inputFadeTokens.get(name) === token) {
          await this.writeInputVolume(name, from + (target - from) * progress, undefined, Math.max(1, from));
        }
      });
      if (progress >= 1) return;
    }
  }

  public cancelInputFade(inputName: string): void {
    const name = this.resolveInputName(inputName) || inputName.trim();
    if (name) {
      this.inputFadeTokens.set(name, (this.inputFadeTokens.get(name) ?? 0) + 1);
    }
  }

  public resolveInputName(target: string): string {
    return resolveAutomaticInputName(target.trim(), Object.keys(this.catalog.inputVolumes));
  }

  private requireInputName(target: string): string {
    const name = this.resolveInputName(target);
    if (name) return name;
    const role = automaticInputRole(target);
    throw new DirectObsError(role
      ? ownText("errorRoleUnavailable", { role: t(role.role, role.params) })
      : ownText("errorChooseInput"), 400);
  }

  /** An explicit setup step, requested from the layout picker. Never takes a scene live. */
  public async prepareStudioLayout(): Promise<DirectObsCatalog> {
    const generation = this.controlGeneration;
    const task = this.sceneQueue.catch(() => {}).then(async () => {
      this.requireControlGeneration(generation);
      if (!this.isConnected()) throw new DirectObsError(ownText("errorConnectBeforeStudio"), 400);
      await this.sendObsRequest("SetStudioModeEnabled", { studioModeEnabled: true });
      this.requireControlGeneration(generation);
      await this.refreshCatalog();
      this.requireControlGeneration(generation);
      if (!this.catalog.studioMode) throw new DirectObsError(ownText("errorStudioNotEnabled"), 400);
      // The refresh above can give way, without applying, to a newer one that OBS's StudioModeStateChanged started
      // after clearing Preview. Decide on what OBS reports now, so a distinct Preview is never replaced.
      // A read that fails falls back to the catalog, as before.
      const [programReply, previewReply] = await Promise.allSettled([
        this.sendObsRequest("GetCurrentProgramScene"),
        this.sendObsRequest("GetCurrentPreviewScene")
      ]);
      this.requireControlGeneration(generation);
      const sceneName = (reply: PromiseSettledResult<Record<string, unknown>>, key: string): string | undefined => {
        if (reply.status !== "fulfilled") return undefined;
        const value = reply.value[key] ?? reply.value.sceneName;
        return typeof value === "string" ? value : "";
      };
      const program = sceneName(programReply, "currentProgramSceneName") || this.catalog.currentProgramScene;
      const preview = sceneName(previewReply, "currentPreviewSceneName") ?? this.catalog.currentPreviewScene;
      if (preview && preview !== program) {
        this.catalog.currentPreviewScene = preview;
      } else {
        const scenes = this.catalog.scenes;
        const index = scenes.indexOf(program);
        const next = scenes[(index + 1) % scenes.length];
        if (next && next !== program) {
          await this.sendObsRequest("SetCurrentPreviewScene", { sceneName: next });
          this.requireControlGeneration(generation);
          this.catalog.currentPreviewScene = next;
        }
      }
      this.emitDirectState();
      return this.getCatalog();
    });
    this.sceneQueue = task;
    return task;
  }

  public async setTbarPosition(value: number, release = false, queueNextScene = false): Promise<number> {
    return this.queueTbar((generation) => this.writeTbarPosition(value, release, queueNextScene, generation));
  }

  private async writeTbarPosition(value: number, release: boolean, queueNextScene = false, generation = this.controlGeneration): Promise<number> {
    this.requireControlGeneration(generation);
    if (!this.catalog.studioMode) {
      throw new DirectObsError(ownText("errorTbarNeedsStudio"), 400);
    }
    const position = clampUnit(value);
    // The last 3 % of a throw is a take, as an APC40's crossfader does with Midi Fadester.
    const shouldRelease = release || position >= 1 - TBAR_RAIL;
    // After a take the rest of that spin does nothing: every tick in the window opens it again, so the next throw starts
    // only once the dial has rested a moment. OBS's transition settles and the next Preview is prepared meanwhile.
    if (Date.now() < this.tbarSettleUntil) {
      // Never past the cap: a dial that keeps spinning cannot hold the window open for good.
      this.tbarSettleUntil = Math.min(Date.now() + TBAR_SETTLE_MS, this.tbarSettleCap);
      this.noteTbarIgnored("settling after a take");
      return this.catalog.tbarPosition;
    }
    if (this.sceneCycle?.ended) {
      if (Date.now() - (this.sceneCycle.endedAt ?? 0) < SCENE_CYCLE_HOLD_MAX_MS) {
        this.noteTbarIgnored("Scene loop is preparing the next scene");
        return this.catalog.tbarPosition;
      }
      this.noteTbarIgnored("a stale Scene loop step was dropped");
      this.cancelSceneCycle();
    }
    // The end of a throw is a take: OBS 33.0.1 cancels a T-bar released over obs-websocket.
    if (shouldRelease) return this.performTbarTake(queueNextScene, generation);
    // A throw remembers where it goes: a Preview picked mid-throw is for the next fade, not this one.
    if (this.catalog.tbarPosition <= 0 && position > 0) {
      this.tbarThrow = { live: this.catalog.currentProgramScene, next: this.catalog.currentPreviewScene };
    }
    if (!queueNextScene || position === 0) this.cancelSceneCycle();
    else if (!this.sceneCycle && this.catalog.currentProgramScene !== this.catalog.currentPreviewScene) {
      this.sceneCycle = {
        token: ++this.sceneCycleGeneration,
        live: this.catalog.currentProgramScene,
        next: this.catalog.currentPreviewScene,
        transition: this.catalog.currentTransition,
        started: false,
        ended: false
      };
    }
    try {
      const native = this.nativeSlider();
      const moved = native ? await this.moveNativeTbar(native, position, generation) : false;
      this.requireControlGeneration(generation); // a reset meanwhile already put the dial back at rest
      if (!moved) {
        // Back at Live, a release ends OBS's manual transition. OBS's own slider never moved, so its release takes
        // the cancel branch, which is what 0 means; short of 0 the transition stays active and follows the next write.
        const releaseAtLive = position === 0 && this.catalog.tbarPosition > 0;
        await this.sendObsRequest("SetTBarPosition", { position, release: releaseAtLive });
        this.requireControlGeneration(generation);
        // A release cancels only while OBS's own slider is near its start. One a hand (or an earlier helper) left
        // part-way keeps the fade open, and OBS's transition buttons locked: then the fade is finished instead.
        if (releaseAtLive && !(await this.transitionAtRest(generation))) return this.performTbarTake(queueNextScene, generation);
      }
    } catch (error) {
      this.cancelSceneCycle();
      throw error;
    }
    this.catalog.tbarPosition = position;
    this.emitDirectState();
    return this.catalog.tbarPosition;
  }

  /** The helper for OBS's own slider when it can reach this OBS (Windows, OBS 33 on this computer). */
  private nativeSlider(): NativeTbar | null {
    if (this.nativeOption === false || !this.isConnected()) return null;
    if (!nativeTbarEligible(this.nativePlatform, this.settings.host, this.obsVersion)) return null;
    if (!this.native && !this.nativeTried) {
      this.nativeTried = true;
      this.native = this.nativeOption(this.settings.port) ?? null;
    }
    return this.native;
  }

  /** For the dial's settings page: whether OBS's own slider follows the dial, or why not. */
  public getNativeTbarStatus(): NativeTbarStatus {
    if (this.nativeOption === false || !this.isConnected() || !this.catalog.studioMode) return "off";
    const blocker = nativeTbarBlocker(this.nativePlatform, this.settings.host, this.obsVersion);
    if (blocker) return blocker;
    if (this.nativeReach === "unavailable") return "unavailable";
    if (this.transitionKind && this.transitionKind !== "fade_transition") return "transition";
    return this.nativeReach === "unknown" ? "off" : this.nativeReach;
  }

  /**
   * Finds out, without moving anything, whether OBS's own slider can follow the dial now: starts the helper and reads
   * the slider before the first turn (so a first start, or a virus scan of it, never holds up a fade), and reads the
   * selected transition. The settings page shows the result; anything out of reach now is tried again on the turn.
   */
  public async refreshNativeTbar(): Promise<void> {
    if (this.nativeOption === false || !this.isConnected() || !this.catalog.studioMode) return;
    const connection = this.connectionGeneration;
    const before = this.getNativeTbarStatus();
    try {
      const native = this.nativeSlider();
      if (native) {
        try {
          await native.read();
          if (connection === this.connectionGeneration) this.nativeReach = "following";
        } catch (error) {
          if (connection === this.connectionGeneration) this.noteNativeFailure(error);
        }
      } else if (nativeTbarEligible(this.nativePlatform, this.settings.host, this.obsVersion)) {
        this.nativeReach = "unavailable"; // the helper is not in the plugin
      }
      const kind = (await this.sendObsRequest("GetCurrentSceneTransition")).transitionKind;
      if (connection === this.connectionGeneration) this.transitionKind = typeof kind === "string" ? kind : "";
    } catch {
      // OBS went away or does not know the request: the status keeps what it had
    }
    if (connection === this.connectionGeneration && this.getNativeTbarStatus() !== before) this.emitDirectState();
  }

  /**
   * A refusal wrote nothing: the helper runs but cannot reach the slider. A helper that did not answer in time says
   * nothing yet (a slow first start); anything else means the helper itself would not run.
   */
  private noteNativeFailure(error: unknown): void {
    this.nativeReach = error instanceof NativeTbarRefusal ? "unreachable" : error instanceof NativeTbarTimeout ? "unknown" : "unavailable";
  }

  /** Ends the helper and any throw it was driving: the next connection finds OBS again. */
  private endNative(): void {
    this.nativeThrow = null;
    this.native?.close();
    this.native = null;
    this.nativeTried = false;
    this.nativeReach = "unknown";
  }

  private abandonNativeThrow(): void {
    this.nativeThrow = null;
    this.catalog.tbarPosition = 0;
  }

  /** Throws when the throw `own` was ended meanwhile (Studio Mode turned off, OBS's T-bar rebuilt). */
  private holdNativeThrow(own: NativeThrow): void {
    if (this.nativeThrow !== own) throw new DirectObsError(ownText("errorControlChanged"), 409);
  }

  /**
   * After a transition ended (ours, or one taken in OBS's own window), the dial's position may be stale. Behind any
   * T-bar step already queued, and only when OBS has no manual transition under way: an Ended can belong to an earlier
   * transition while a throw of the dial's carries on, and that throw must not jump back.
   */
  private forgetTbarIfIdle(): void {
    void this.queueTbar(async (generation) => {
      if (this.catalog.tbarPosition === 0 && !this.nativeThrow) return 0;
      const cursor = await this.readTransitionCursor(generation);
      if (!(cursor > 0 && cursor < 1)) {
        this.catalog.tbarPosition = 0;
        this.nativeThrow = null;
        this.emitDirectState();
      }
      return this.catalog.tbarPosition;
    }).catch(() => undefined);
  }

  /** Whether the scenes a native throw started between are still the ones OBS shows (OBS 33 names Next as Program once a throw starts). */
  private nativeThrowHolds(own: NativeThrow): boolean {
    const program = this.catalog.currentProgramScene;
    return this.catalog.studioMode && this.catalog.currentPreviewScene === own.next && (program === own.live || program === own.next);
  }

  /**
   * Starts a throw on OBS's real slider: only with a Fade selected (the slider mixes with it), no transition running,
   * and the slider at rest. Anything else returns false and the throw goes over obs-websocket as before.
   */
  private async beginNativeThrow(native: NativeTbar, generation: number): Promise<boolean> {
    const live = this.catalog.currentProgramScene;
    const next = this.catalog.currentPreviewScene;
    if (!live || !next || live === next) return false;
    let kind: unknown;
    let cursor: number;
    try {
      kind = (await this.sendObsRequest("GetCurrentSceneTransition")).transitionKind;
      this.requireControlGeneration(generation);
      cursor = Number((await this.sendObsRequest("GetCurrentSceneTransitionCursor")).transitionCursor);
    } catch {
      this.requireControlGeneration(generation);
      return false; // an OBS without these requests keeps the obs-websocket throw
    }
    this.requireControlGeneration(generation);
    this.transitionKind = typeof kind === "string" ? kind : this.transitionKind;
    if (kind !== "fade_transition" || (cursor !== 0 && cursor !== 1)) return false;
    try {
      const tick = nativeTick(await native.read());
      this.nativeReach = "following";
      if (tick !== 0) return false;
    } catch (error) {
      this.noteNativeFailure(error); // the helper cannot reach OBS's slider now (window closed or minimised, OBS as administrator)
      return false;
    }
    this.nativeThrow = { live, next, at: 0, started: false };
    return true;
  }

  /** One dial step on OBS's real slider; false when it wrote nothing and the step should go over obs-websocket. */
  private async moveNativeTbar(native: NativeTbar, position: number, generation: number): Promise<boolean> {
    if (!this.nativeThrow) {
      if (position <= 0) return false;
      if (!(await this.beginNativeThrow(native, generation))) return false;
    }
    const own = this.nativeThrow!;
    if (!this.nativeThrowHolds(own)) {
      this.abandonNativeThrow();
      throw new DirectObsError(ownText("errorControlChanged"), 409);
    }
    try {
      if (position <= 0) {
        await native.move(own.at, 0);
        own.at = 0;
        this.holdNativeThrow(own);
        // At 0 OBS's release cancels the manual transition: Program stays the scene the throw started from.
        await this.sendObsRequest("SetTBarPosition", { position: 0, release: true });
        this.requireControlGeneration(generation);
        await this.confirmNativeRelease(native, own.live, own.next, generation, "errorControlChanged");
        this.nativeThrow = null;
        return true;
      }
      await native.move(own.at, position);
      own.at = position;
      this.holdNativeThrow(own);
      if (!own.started) {
        // A slider write only queues OBS's TBarChanged: wait until OBS confirms the blend has started.
        await this.waitForManualTransition(generation);
        this.holdNativeThrow(own);
        own.started = true;
      }
      return true;
    } catch (error) {
      if (error instanceof NativeTbarRefusal && !own.started && own.at === 0) {
        this.nativeThrow = null; // nothing was written: OBS is as it was
        return false;
      }
      this.abandonNativeThrow();
      if (error instanceof DirectObsError) throw error;
      throw new DirectObsError(ownText("errorControlChanged"), 409);
    }
  }

  private async readTransitionCursor(generation: number): Promise<number> {
    const cursor = Number((await this.sendObsRequest("GetCurrentSceneTransitionCursor")).transitionCursor);
    this.requireControlGeneration(generation);
    return cursor;
  }

  private async waitForManualTransition(generation: number): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const cursor = await this.readTransitionCursor(generation);
      if (cursor > 0 && cursor < 1) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new DirectObsError(ownText("errorControlChanged"), 409);
  }

  /**
   * After a release on the real slider, as Fadester Companion confirms it on hardware: OBS parks its slider at 0 once it
   * has handled the release (OBS 33 names Next as Program from the start of a throw, so Program alone proves nothing),
   * then Program is `program`, no transition is running and Preview is `preview`. OBS may publish its Preview swap a
   * little after the rest; with its scene swap turned off it never does, so 600 ms at rest without it is enough.
   */
  private async confirmNativeRelease(native: NativeTbar, program: string, preview: string, generation: number, failure: string): Promise<void> {
    try {
      await native.move(0, 0);
    } catch {
      throw new DirectObsError(ownText(failure), 500);
    }
    this.requireControlGeneration(generation);
    const until = Date.now() + 2500;
    let restingSince = 0;
    do {
      const programReply = await this.sendObsRequest("GetCurrentProgramScene");
      this.requireControlGeneration(generation);
      const previewReply = await this.sendObsRequest("GetCurrentPreviewScene");
      this.requireControlGeneration(generation);
      const cursor = await this.readTransitionCursor(generation);
      const programName = programReply.currentProgramSceneName ?? programReply.sceneName;
      const previewName = previewReply.currentPreviewSceneName ?? previewReply.sceneName;
      if (programName === program && (cursor === 0 || cursor === 1)) {
        if (previewName === preview) return;
        restingSince ||= Date.now();
        if (Date.now() - restingSince >= 600) return; // the caller sets Preview
      } else {
        restingSince = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 35));
    } while (Date.now() < until);
    throw new DirectObsError(ownText(failure), 500);
  }

  /**
   * The take on OBS's real slider: put it at the end and release, which OBS 33 completes because its release reads that
   * slider. No Studio Mode round trip is needed. Undefined when the helper wrote nothing and the take should go the other way.
   */
  private async takeWithNativeTbar(native: NativeTbar, live: string, next: string, queueNextScene: boolean, generation: number): Promise<number | undefined> {
    // From rest a slider write only queues OBS's TBarChanged: start the blend one step short of the end, confirmed the
    // way a throw's first step is, before the last step and the release. False: the helper wrote nothing.
    if (!this.nativeThrow && !(await this.moveNativeTbar(native, NATIVE_NEAR_END, generation))) return undefined;
    const own = this.nativeThrow!;
    if (!this.nativeThrowHolds(own) || own.next !== next) {
      this.abandonNativeThrow();
      throw new DirectObsError(ownText("errorControlChanged"), 409);
    }
    try {
      await native.move(own.at, 1);
      own.at = 1;
      this.holdNativeThrow(own);
      await this.sendObsRequest("SetTBarPosition", { position: 1, release: true });
      this.requireControlGeneration(generation);
      await this.confirmNativeRelease(native, next, live, generation, "errorTakeUnconfirmed");
    } catch (error) {
      if (error instanceof NativeTbarRefusal && !own.started && own.at === 0) {
        this.nativeThrow = null;
        return undefined;
      }
      this.abandonNativeThrow();
      if (error instanceof DirectObsError) throw error;
      throw new DirectObsError(ownText("errorTakeUnconfirmed"), 500);
    }
    this.nativeThrow = null;
    this.catalog.tbarPosition = 0;
    await this.refreshCurrentSceneNames();
    this.requireControlGeneration(generation);
    const previewTarget = queueNextScene ? await this.sceneAfter(next, generation) : live;
    if (previewTarget && previewTarget !== this.catalog.currentPreviewScene) {
      await this.sendObsRequest("SetCurrentPreviewScene", { sceneName: previewTarget });
      this.requireControlGeneration(generation);
      this.catalog.currentPreviewScene = previewTarget;
    }
    this.tbarSettleUntil = Date.now() + TBAR_SETTLE_MS;
    this.tbarSettleCap = Date.now() + TBAR_SETTLE_MAX_MS;
    this.emitDirectState();
    return 0;
  }

  /**
   * One dial step on the T-bar. Every throw is a turn to the right: the last 3 % takes Next live, and after a pause the
   * next turn right is the next throw, toward the scene then in Preview (with OBS's scene swap on, the one just left;
   * with Scene loop, the next in the list). A turn left fades back, and a throw turned back into its first 3 % cancels.
   */
  public async nudgeTbar(delta: number, queueNextScene = false): Promise<number> {
    return this.queueTbar(async (generation) => {
      if (!this.catalog.studioMode && !(await this.recheckStudioMode(generation))) {
        this.noteTbarIgnored("Studio Mode is off");
        throw new DirectObsError(ownText("errorTbarNeedsStudio"), 400);
      }
      if (Date.now() < this.tbarSettleUntil) {
        this.tbarSettleUntil = Math.min(Date.now() + TBAR_SETTLE_MS, this.tbarSettleCap);
        this.noteTbarIgnored("settling after a take");
        return this.catalog.tbarPosition;
      }
      if (!(await this.pickUpOpenFadeOrRetry(generation))) return this.catalog.tbarPosition; // a timed transition runs: wait
      const position = this.catalog.tbarPosition;
      let next = position + delta;
      if (delta < 0 && next <= TBAR_RAIL) {
        if (position <= 0) {
          this.noteTbarIgnored("turned left at rest");
          return position; // turning left at rest does nothing
        }
        next = 0;
      }
      // From rest a throw needs a Next: not the live scene, and not a Preview still being read after Studio Mode came on.
      const noNext = (): boolean =>
        !this.catalog.currentPreviewScene || this.catalog.currentProgramScene === this.catalog.currentPreviewScene;
      if (position <= 0 && noNext()) {
        // What was last heard may be stale (an event missed across a restart): ask OBS once before refusing.
        await this.refreshCurrentSceneNames();
        this.requireControlGeneration(generation);
        this.emitDirectState();
        if (noNext()) {
          this.noteTbarIgnored("Live and Next are the same scene");
          throw new DirectObsError(ownText("mixerChooseDifferent"), 409);
        }
      }
      return this.writeTbarPosition(next, false, queueNextScene, generation);
    });
  }

  /** Re-reads Studio Mode (and, when on, Program and Preview) after the dial found it off: true when OBS says it is on. */
  private async recheckStudioMode(generation: number): Promise<boolean> {
    const enabled = (await this.sendObsRequest("GetStudioModeEnabled")).studioModeEnabled === true;
    this.requireControlGeneration(generation);
    if (!enabled) {
      this.noteTbarIgnored("Studio Mode is off");
      return false;
    }
    this.catalog.studioMode = true;
    await this.refreshCurrentSceneNames();
    this.requireControlGeneration(generation);
    this.emitDirectState();
    return true;
  }

  /** For the dial's own check: Studio Mode as OBS reports it now, not as last heard. */
  public async confirmStudioMode(): Promise<boolean> {
    if (this.catalog.studioMode) return true;
    try {
      return await this.recheckStudioMode(this.controlGeneration);
    } catch {
      return false;
    }
  }

  /** One concise log line per refused or ignored turn (a spin with the same reason logs it once a second). */
  private noteTbarIgnored(reason: string): void {
    const now = Date.now();
    if (reason === this.lastTbarNote.reason && now - this.lastTbarNote.at < 1000) return;
    this.lastTbarNote = { reason, at: now };
    this.emit("tbarTurnIgnored", reason);
  }

  /** `pickUpOpenFade`, and once more after re-reading Program and Preview when it says to wait. */
  private async pickUpOpenFadeOrRetry(generation: number): Promise<boolean> {
    if (await this.pickUpOpenFade(generation)) return true;
    await this.refreshCurrentSceneNames();
    this.requireControlGeneration(generation);
    if (await this.pickUpOpenFade(generation)) return true;
    this.noteTbarIgnored("a timed transition is running");
    return false;
  }

  /**
   * Before a gesture from rest: a fade OBS has open that the dial does not hold (the plugin or the connection restarted
   * mid-fade, a throw was given up, a hand moved OBS's own T-bar) is taken up from where it is, so the dial finishes or
   * cancels it rather than starting another, and OBS's transition buttons never stay locked. OBS 33 names an open
   * fade's target as Program. False: a timed transition is running, and this gesture waits for it.
   */
  private async pickUpOpenFade(generation: number): Promise<boolean> {
    const studio = this.catalogEventRevisions.studio;
    // Studio Mode turned off or on meanwhile (OBS rebuilt its T-bar, the dial went back to rest): nothing to take up.
    const unchanged = (): boolean =>
      this.catalog.studioMode && this.catalog.tbarPosition <= 0 && this.catalogEventRevisions.studio === studio;
    if (!unchanged()) return true;
    const first = await this.readTransitionCursor(generation);
    if (!(first > 0 && first < 1)) return true;
    await new Promise((resolve) => setTimeout(resolve, PICKUP_SAMPLE_MS));
    this.requireControlGeneration(generation);
    if (!unchanged()) return true;
    const second = await this.readTransitionCursor(generation);
    if (!(second > 0 && second < 1)) return true; // it ended meanwhile
    if (Math.abs(second - first) > 0.001) {
      // A moving cursor is a timed transition only while OBS has said one started and not yet ended. Without that
      // (a restart lost the Started, or OBS left its cursor drifting after a take), it does not hold the dial.
      if (this.transitionStartedAt > 0 && Date.now() - this.transitionStartedAt < TBAR_TIMED_TRANSITION_MAX_MS) return false;
      this.noteTbarIgnored("OBS's transition cursor moves with no transition running: not waiting, the turn goes ahead");
      return true;
    }
    const reply = await this.sendObsRequest("GetCurrentProgramScene");
    this.requireControlGeneration(generation);
    const target = String(reply.currentProgramSceneName ?? reply.sceneName ?? "");
    if (!target || !unchanged()) return true;
    this.tbarThrow = { live: this.catalog.currentProgramScene === target ? "" : this.catalog.currentProgramScene, next: target };
    this.catalog.tbarPosition = second;
    this.emitDirectState();
    return true;
  }

  /** After a release: true once OBS's transition rests (its cursor at an end), false when it stays open. */
  private async transitionAtRest(generation: number): Promise<boolean> {
    for (let attempt = 0; attempt < 15; attempt++) {
      const cursor = await this.readTransitionCursor(generation);
      if (!(cursor > 0 && cursor < 1)) return true;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return false;
  }

  /** The scenes the T-bar dial shows: an open fade's own (its start "" when unknown), else OBS's Program and Preview. */
  public getTbarScenes(): { live: string; next: string } {
    const open = this.catalog.tbarPosition > 0 ? this.tbarThrow : null;
    return open ?? { live: this.catalog.currentProgramScene, next: this.catalog.currentPreviewScene };
  }

  /** Takes Next live: the scene mixer's dial press, and the end of a throw. */
  public async takeTbar(queueNextScene = false): Promise<number> {
    return this.queueTbar(async (generation) => {
      if (!this.catalog.studioMode && !(await this.recheckStudioMode(generation))) {
        this.noteTbarIgnored("Studio Mode is off");
        throw new DirectObsError(ownText("errorTbarNeedsStudio"), 400);
      }
      // A press in the settle window is the end of the last take, as the trailing ticks are.
      if (Date.now() < this.tbarSettleUntil) {
        this.noteTbarIgnored("settling after a take");
        return this.catalog.tbarPosition;
      }
      if (!(await this.pickUpOpenFadeOrRetry(generation))) return this.catalog.tbarPosition; // a timed transition runs: wait
      return this.performTbarTake(queueNextScene, generation);
    });
  }

  /**
   * OBS 33.0.1 cannot finish a T-bar throw over obs-websocket: `SetTBarPosition` with
   * `release` calls `OBSBasic::TBarReleased`, which reads the T-bar widget's value, and
   * `obs_frontend_set_tbar_position` only invokes `TBarChanged` without moving the widget
   * (frontend/OBSStudioAPI.cpp:115-118), so the release always takes the cancel branch
   * (frontend/widgets/OBSBasic_Transitions.cpp:767-777, "Manual transition cancelled") and
   * Program snaps back. `TriggerStudioModeTransition`, `SetCurrentProgramScene` and
   * `SetCurrentSceneTransition` are refused while the manual transition is active. The one
   * request that sets Program to the throw's target in a single UI step is leaving Studio Mode
   * (OBSBasic_StudioMode.cpp:251-257: `TransitionToScene(programScene, force)`), so the take
   * is: make sure a manual transition toward Next is active (Program keeps showing the throw),
   * leave Studio Mode (Program becomes Next at once, no frame of Live), re-enter it, then set
   * Preview: the scene after Next when queue-next is on, otherwise the previous Live, as OBS's
   * own swap after a transition does. Measured on OBS 33.0.1: 14 of 14 recorded takes showed no
   * frame of the old scene; a cancel followed by a Cut showed one in 14.
   */
  private async performTbarTake(queueNextScene: boolean, generation: number): Promise<number> {
    const open = this.catalog.tbarPosition > 0 ? this.tbarThrow : null;
    const live = open ? open.live : this.catalog.currentProgramScene;
    const next = open ? open.next : this.catalog.currentPreviewScene;
    // The operator's Preview now: picked mid-throw, it is the scene the next fade goes to, so it stays in Preview.
    const cue = this.catalog.currentPreviewScene;
    this.cancelSceneCycle();
    if (!next || next === live) {
      this.catalog.tbarPosition = 0;
      this.emitDirectState();
      throw new DirectObsError(ownText("mixerChooseDifferent"), 409);
    }
    const native = this.nativeSlider();
    if (native) {
      const taken = await this.takeWithNativeTbar(native, live, next, queueNextScene, generation);
      if (taken !== undefined) return taken;
    }
    // The take's own two StudioModeStateChanged events (off, then on), whenever they arrive:
    // OBS broadcasts them before it answers; the fake after.
    this.tbarStudioEventsToIgnore = 2;
    this.tbarStudioEventsIgnoreUntil = Date.now() + TBAR_STUDIO_EVENT_GRACE_MS;
    let left = false;
    let restoreTried = false;
    let restored = false;
    let target = next;
    try {
      // Never `release: true`: that is the cancel. At the end of a throw this only re-aims the
      // manual transition (its eased value moves by about one percent before the next request);
      // from rest it starts one, and Program keeps showing Live until the step below.
      await this.sendObsRequest("SetTBarPosition", { position: 1, release: false });
      this.requireControlGeneration(generation);
      // Leaving Studio Mode finishes OBS's open fade at its own target, which OBS 33 names as Program while the fade
      // is open: that, not the dial's memory, is the scene the take is confirmed against.
      const reported = await this.sendObsRequest("GetCurrentProgramScene");
      this.requireControlGeneration(generation);
      target = String(reported.currentProgramSceneName ?? reported.sceneName ?? "") || next;
      left = true;
      // Nothing may sit between leaving and re-entering: once OBS was asked to leave Studio
      // Mode it is always asked back, whatever the answer, the connection or the collection does.
      await this.sendObsRequest("SetStudioModeEnabled", { studioModeEnabled: false });
      restoreTried = true;
      restored = await this.restoreStudioMode();
    } finally {
      if (left && !restoreTried) restored = await this.restoreStudioMode();
      if (left && !restored) {
        this.tbarStudioEventsToIgnore = 0;
        this.catalog.tbarPosition = 0;
        await this.reconcileStudioMode();
      }
    }
    if (!restored) throw new DirectObsError(ownText("errorStudioNotEnabled"), 500);
    this.requireControlGeneration(generation);
    this.catalog.tbarPosition = 0;
    await this.refreshCurrentSceneNames();
    this.requireControlGeneration(generation);
    if (this.catalog.currentProgramScene !== target) {
      // Whatever OBS took, Live and Next must not end up on the same scene, or the next turn would be refused.
      if (this.catalog.currentProgramScene === this.catalog.currentPreviewScene) {
        try {
          const repair = cue && cue !== this.catalog.currentProgramScene ? cue
            : live && live !== this.catalog.currentProgramScene ? live
              : await this.sceneAfter(this.catalog.currentProgramScene, generation);
          if (repair) {
            await this.sendObsRequest("SetCurrentPreviewScene", { sceneName: repair });
            this.catalog.currentPreviewScene = repair;
          }
        } catch {
          // the take's own error is the one to report
        }
      }
      this.emitDirectState();
      throw new DirectObsError(ownText("errorTakeUnconfirmed"), 500);
    }
    // Next in Preview, never the scene now live: the operator's pick, else the scene that was live, else the next one.
    const previewTarget = queueNextScene ? await this.sceneAfter(target, generation)
      : cue && cue !== target ? cue
        : live && live !== target ? live
          : await this.sceneAfter(target, generation);
    if (previewTarget && previewTarget !== this.catalog.currentPreviewScene) {
      await this.sendObsRequest("SetCurrentPreviewScene", { sceneName: previewTarget });
      this.requireControlGeneration(generation);
      this.catalog.currentPreviewScene = previewTarget;
    }
    this.tbarSettleUntil = Date.now() + TBAR_SETTLE_MS;
    this.tbarSettleCap = Date.now() + TBAR_SETTLE_MAX_MS;
    this.emitDirectState();
    return 0;
  }

  /** Re-enters Studio Mode after a take, once more on a failure; true when OBS confirmed it. */
  private async restoreStudioMode(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.sendObsRequest("SetStudioModeEnabled", { studioModeEnabled: true });
        return true;
      } catch {
        // once more
      }
    }
    return false;
  }

  /** After a take that could not confirm Studio Mode is back: ask OBS, and let every cell know. */
  private async reconcileStudioMode(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await this.sendObsRequest("GetStudioModeEnabled")).studioModeEnabled === true;
    } catch {
      enabled = false;
    }
    this.catalog.studioMode = enabled;
    if (!enabled) this.cancelSceneCycle();
    this.emitDirectState();
  }

  /** The scene after `sceneName` in OBS's current order (wrapping), read fresh: OBS does not
   * reliably announce a reordering. Empty when the list is too short or the scene is gone. */
  private async sceneAfter(sceneName: string, generation: number): Promise<string> {
    const sceneList = await this.sendObsRequest("GetSceneList");
    this.requireControlGeneration(generation);
    this.applySceneList(sceneList.scenes);
    const scenes = this.catalog.scenes;
    const index = scenes.indexOf(sceneName);
    if (index < 0 || scenes.length < 2) return "";
    return scenes[(index + 1) % scenes.length] ?? "";
  }

  public cancelSceneCycle(): void {
    this.sceneCycleGeneration++;
    this.sceneCycle = null;
  }

  private finishSceneCycle(transitionName: unknown): void {
    const cycle = this.sceneCycle;
    if (!cycle || cycle.ended || transitionName !== cycle.transition) return;
    cycle.ended = true;
    cycle.endedAt = Date.now();
    void this.tbarQueue.catch(() => {}).then(async () => {
      const task = this.sceneQueue.catch(() => {}).then(async () => {
        if (cycle.token !== this.sceneCycleGeneration || !this.isConnected() || !this.catalog.studioMode) return;
        // A late Ended from an earlier transition while a fade is still open: leave that fade alone.
        const cursor = Number((await this.sendObsRequest("GetCurrentSceneTransitionCursor")).transitionCursor);
        if (cursor > 0 && cursor < 1) return;
        await this.refreshCurrentSceneNames();
        // Aborts, unrelated transitions and an operator's new Preview choice
        // must never cause an automatic scene change.
        if (cycle.token !== this.sceneCycleGeneration || this.catalog.currentProgramScene !== cycle.next ||
          ![cycle.live, cycle.next].includes(this.catalog.currentPreviewScene)) return;
        const sceneList = await this.sendObsRequest("GetSceneList");
        if (cycle.token !== this.sceneCycleGeneration || !this.catalog.studioMode) return;
        this.applySceneList(sceneList.scenes);
        const scenes = this.catalog.scenes;
        const index = scenes.indexOf(cycle.next);
        if (index < 0 || scenes.length < 2) return;
        const nextScene = scenes[(index + 1) % scenes.length];
        if (nextScene !== this.catalog.currentPreviewScene) {
          await this.sendObsRequest("SetCurrentPreviewScene", { sceneName: nextScene });
          this.catalog.currentPreviewScene = nextScene;
        }
        this.catalog.tbarPosition = 0;
        this.emitDirectState();
      });
      this.sceneQueue = task;
      await task;
    }).catch((error: unknown) => {
      this.emit("directControlError", error instanceof Error ? error.message : "Could not queue the next scene.");
    }).finally(() => {
      if (this.sceneCycle === cycle) this.sceneCycle = null;
    });
  }

  public async runSceneAction(
    target: string,
    operation: DirectSceneOperation,
    transitionName = OBS_TRANSITION_CURRENT
  ): Promise<string> {
    const generation = this.controlGeneration;
    const task = this.sceneQueue.catch(() => {}).then(() =>
      this.performSceneAction(target, operation, transitionName, generation));
    this.sceneQueue = task;
    return task;
  }

  private async performSceneAction(
    target: string,
    operation: DirectSceneOperation,
    transitionName: string,
    generation: number
  ): Promise<string> {
    this.requireControlGeneration(generation);
    // Read current scene names inside the queue: repeated Next/Previous keys
    // must each advance from the result of the preceding press.
    await this.refreshCurrentSceneNames();
    this.requireControlGeneration(generation);
    // Resolve automatic bindings against OBS at press time, including a scene
    // reorder that does not emit a scene-created/renamed event.
    const sceneList = await this.sendObsRequest("GetSceneList");
    this.requireControlGeneration(generation);
    this.applySceneList(sceneList.scenes);
    const sceneName = this.resolveSceneTarget(target, operation === "preview");
    if (!sceneName) {
      const index = sceneTargetIndex(target);
      const count = this.catalog.scenes.length;
      throw new DirectObsError(index !== undefined
        ? ownText(count === 1 ? "errorSceneIndexUnavailableOne" : "errorSceneIndexUnavailableMany", { n: index + 1, count })
        : ownText("errorChooseScene"), 400);
    }

    if (operation === "preview") {
      if (!this.catalog.studioMode) {
        throw new DirectObsError(ownText("errorPreviewNeedsStudio"), 400);
      }
      await this.sendObsRequest("SetCurrentPreviewScene", { sceneName });
      this.requireControlGeneration(generation);
      this.catalog.currentPreviewScene = sceneName;
    } else {
      const isCut = operation === "cut" || transitionName === OBS_TRANSITION_CUT;
      const chosenTransition = isCut ? this.cutTransitionName : transitionName;
      if (isCut && !chosenTransition) {
        throw new DirectObsError(ownText("errorNoCutTransition"), 400);
      }
      const switchScene = async (): Promise<void> => {
        // This native request performs a transition in both normal and Studio
        // mode. TriggerStudioModeTransition is only necessary for the OBS UI's
        // separate Preview-to-Program button, whose target is resolved above.
        this.requireControlGeneration(generation);
        await this.sendObsRequest("SetCurrentProgramScene", { sceneName });
        this.requireControlGeneration(generation);
        this.catalog.currentProgramScene = sceneName;
      };
      if (chosenTransition && chosenTransition !== OBS_TRANSITION_CURRENT) {
        await this.withSceneTransition(sceneName, chosenTransition, switchScene, generation);
      } else {
        await switchScene();
      }
      await this.refreshCurrentSceneNames();
      this.requireControlGeneration(generation);
    }
    this.emitDirectState();
    return sceneName;
  }

  private async withSceneTransition(
    sceneName: string,
    transitionName: string,
    switchScene: () => Promise<void>,
    generation: number
  ): Promise<void> {
    const previous = await this.sendObsRequest("GetSceneSceneTransitionOverride", { sceneName });
    this.requireControlGeneration(generation);
    try {
      // A scene can override the global transition; temporarily select the requested transition on this destination
      // to guarantee Cut/Fade/etc. Inside the try, so a write OBS applied but answered late is still put back.
      await this.sendObsRequest("SetSceneSceneTransitionOverride", {
        sceneName,
        transitionName,
        transitionDuration: null
      });
      this.requireControlGeneration(generation);
      await switchScene();
    } finally {
      if (generation === this.controlGeneration) {
        await this.sendObsRequest("SetSceneSceneTransitionOverride", {
          sceneName,
          transitionName: previous.transitionName ?? null,
          transitionDuration: previous.transitionDuration ?? null
        });
      }
    }
  }

  private async refreshCurrentSceneNames(): Promise<void> {
    const generation = this.controlGeneration;
    const programRevision = this.catalogEventRevisions.program;
    const program = await this.sendObsRequest("GetCurrentProgramScene");
    this.requireControlGeneration(generation);
    const name = program.currentProgramSceneName ?? program.sceneName;
    if (typeof name === "string" && programRevision === this.catalogEventRevisions.program) this.catalog.currentProgramScene = name;
    if (this.catalog.studioMode) {
      // A Preview event received during the Program query is older than this
      // request. Only an event arriving after this request can supersede it.
      const previewRevision = this.catalogEventRevisions.preview;
      const preview = await this.sendObsRequest("GetCurrentPreviewScene");
      this.requireControlGeneration(generation);
      const previewName = preview.currentPreviewSceneName ?? preview.sceneName;
      if (typeof previewName === "string" && previewRevision === this.catalogEventRevisions.preview) this.catalog.currentPreviewScene = previewName;
    }
  }

  protected override createVendorError(comment: string | LocalText, code = -1): ObsVendorError {
    return new DirectObsError(comment, code);
  }

  protected override async initializeAfterIdentify(): Promise<void> {
    const connection = this.connectionGeneration;
    let ready = false;
    try {
      const versionData = await this.sendObsRequest("GetVersion");
      if (connection !== this.connectionGeneration) return;
      const obsVersion =
        typeof versionData.obsVersion === "string"
          ? versionData.obsVersion
          : typeof versionData.obsStudioVersion === "string"
            ? versionData.obsStudioVersion
            : "OBS";
      this.obsVersion = obsVersion;
      // Captured before the first catalog publication (R-PLT-2): absent or malformed is unsupported.
      const available = versionData.availableRequests;
      this.mediaCapability = Array.isArray(available) &&
        MEDIA_REQUIRED_REQUESTS.every((request) => available.includes(request)) ? "ok" : "unsupported";
      await this.refreshCatalog();
      if (connection !== this.connectionGeneration) return;
      this.reconnectAttempt = 0;
      this.haltedReason = "none";
      this.setStatus({
        kind: "connected",
        obsVersion
      });
      ready = true;
      this.emitDirectState();
      void this.refreshNativeTbar();
      // A fade OBS already has open (the plugin restarted mid-fade): the dial shows it and the next turn carries it on.
      void this.queueTbar((generation) => this.pickUpOpenFade(generation).then(() => this.catalog.tbarPosition))
        .catch(() => undefined);
      // Every completed (re)connection, also one whose status did not change.
      this.emit("connectionReady");
    } catch (err) {
      // Before the connection is declared ready, every failure goes back to the base client (NotReady: try again on
      // this socket; anything else: drop the socket). After that, a listener's error must not drop a working connection.
      if (!ready) throw err;
    }
  }

  protected override handleObsEvent(d: Record<string, unknown>): void {
    const eventType = typeof d.eventType === "string" ? d.eventType : "";
    const eventData = (d.eventData ?? {}) as Record<string, unknown>;
    if (eventType === "StudioModeStateChanged") {
      // A take leaves and re-enters Studio Mode on purpose: Studio Mode stays on for every cell.
      if (this.tbarStudioEventsToIgnore > 0 && Date.now() < this.tbarStudioEventsIgnoreUntil) {
        this.tbarStudioEventsToIgnore--;
        return;
      }
      // A late copy of a take's "on" (or any repeat of the known state) changes nothing: Preview
      // is not cleared and nothing is re-read.
      if ((eventData.studioModeEnabled === true) === this.catalog.studioMode) return;
    }
    super.handleObsEvent(d);
    if (eventType === "CustomEvent") {
      this.wholeMix.receive(eventData);
      return;
    }

    if (eventType === "SceneTransitionStarted") {
      this.transitionStartedAt = Date.now();
      const cycle = this.sceneCycle;
      if (cycle && !cycle.ended && typeof eventData.transitionName === "string") {
        if (cycle.started) this.cancelSceneCycle();
        else {
          // OBS may use a scene override or fall back to Fade for manual
          // transitions. Capture the transition it actually started.
          cycle.transition = eventData.transitionName;
          cycle.started = true;
        }
      }
      return;
    }
    if (eventType === "SceneTransitionEnded") {
      this.transitionStartedAt = 0;
      this.finishSceneCycle(eventData.transitionName);
      this.forgetTbarIfIdle();
      return;
    }
    if (eventType === "CurrentSceneCollectionChanging" || eventType === "CurrentSceneCollectionChanged") {
      this.collectionChanging = eventType === "CurrentSceneCollectionChanging";
      if (this.collectionChanging) this.wholeMix.reset();
      else this.wholeMix.refresh();
      this.controlGeneration++;
      this.catalogRefreshGeneration++;
      this.cancelAllInputFades();
      this.cancelSceneCycle();
      this.transitionStartedAt = 0;
      this.catalog = {
        ...this.catalog, scenes: [], sceneDetails: [], groupDetails: [], inputs: [], inputDetails: [], inputVolumes: {},
        currentProgramScene: "", currentPreviewScene: "", tbarPosition: 0
      };
      // Stale UUIDs never pass the presence gate; polls resume with the next catalog after Changed.
      if (this.collectionChanging) this.invalidateMediaTargets();
      else this.reconcileMediaTargets();
      this.emitDirectState();
    }

    if (eventType === "InputRemoved") {
      if (typeof eventData.inputName === "string") this.cancelInputFade(eventData.inputName);
      // Identity is the UUID (a rename keeps it): the input leaves the catalog at once, and the
      // refresh below cannot bring it back (inputs revision).
      const removedUuid = typeof eventData.inputUuid === "string" ? eventData.inputUuid : "";
      if (removedUuid && this.catalog.inputDetails.some((input) => input.inputUuid === removedUuid)) {
        this.catalogEventRevisions.inputs++;
        this.catalog.inputDetails = this.catalog.inputDetails.filter((input) => input.inputUuid !== removedUuid);
        this.reconcileMediaTargets();
        this.emitDirectState();
      }
    }

    if (eventType === "InputNameChanged" && typeof eventData.inputUuid === "string" && typeof eventData.inputName === "string") {
      const renamed = this.catalog.inputDetails.find((input) => input.inputUuid === eventData.inputUuid);
      if (renamed) {
        this.catalogEventRevisions.inputs++;
        renamed.inputName = eventData.inputName;
        this.emitDirectState();
      }
    }

    if (eventType === "SceneListChanged") {
      this.catalogEventRevisions.scenes++;
      this.applySceneList(eventData.scenes);
      this.emitDirectState();
      return;
    }

    if (eventType === "InputVolumeChanged") {
      const inputName = eventData.inputName;
      const volume = readVolume(eventData);
      if (typeof inputName === "string" && volume !== undefined) {
        this.catalogEventRevisions.volumes++;
        this.inputVolumeEventRevisions.set(inputName, this.catalogEventRevisions.volumes);
        this.catalog.inputVolumes[inputName] = volume;
        this.emitDirectState();
      }
      return;
    }

    if (eventType === "CurrentProgramSceneChanged") {
      const name = eventData.sceneName;
      if (typeof name === "string") {
        this.catalogEventRevisions.program++;
        if (this.sceneCycle && name !== this.sceneCycle.live && name !== this.sceneCycle.next) this.cancelSceneCycle();
        this.catalog.currentProgramScene = name;
        this.emitDirectState();
      }
      return;
    }

    if (eventType === "CurrentPreviewSceneChanged") {
      const name = eventData.sceneName;
      if (typeof name === "string") {
        this.catalogEventRevisions.preview++;
        if (this.sceneCycle && name !== this.sceneCycle.live && name !== this.sceneCycle.next) this.cancelSceneCycle();
        this.catalog.currentPreviewScene = name;
        this.emitDirectState();
      }
      return;
    }

    if (eventType === "StudioModeStateChanged") {
      this.catalogEventRevisions.studio++;
      this.catalog.studioMode = eventData.studioModeEnabled === true;
      // OBS rebuilds its T-bar when Studio Mode turns off and on: a throw in progress is gone.
      this.catalog.tbarPosition = 0;
      this.nativeThrow = null;
      if (!this.catalog.studioMode) {
        this.cancelSceneCycle();
        this.transitionStartedAt = 0;
      } else {
        void this.refreshNativeTbar();
        // A previous Preview value may be stale after Studio Mode was off.
        // Clear it until OBS supplies the current value again.
        this.catalogEventRevisions.preview++;
        this.catalog.currentPreviewScene = "";
      }
      this.emitDirectState();
      if (this.catalog.studioMode) void this.refreshCatalog();
      return;
    }

    if (eventType === "CurrentSceneTransitionChanged") {
      if (typeof eventData.transitionName === "string") {
        this.catalogEventRevisions.transition++;
        if (this.sceneCycle && eventData.transitionName !== this.sceneCycle.transition) this.cancelSceneCycle();
        this.catalog.currentTransition = eventData.transitionName;
        this.emitDirectState();
        void this.refreshNativeTbar(); // the settings page says whether OBS's slider can follow this transition
      }
      return;
    }

    if (
      eventType === "SceneCreated" ||
      eventType === "SceneRemoved" ||
      eventType === "SceneNameChanged" ||
      eventType === "InputCreated" ||
      eventType === "InputRemoved" ||
      eventType === "InputNameChanged" ||
      eventType === "CurrentSceneCollectionChanged" ||
      eventType === "SceneTransitionListChanged"
    ) {
      void this.refreshCatalog();
    }
  }

  public resolveSceneTarget(target: string, preferPreview: boolean): string {
    const scenes = this.catalog.scenes;
    if (!target || scenes.length === 0) {
      return "";
    }
    if (target === DIRECT_SCENE_CURRENT_PREVIEW) {
      if (!this.catalog.studioMode) {
        throw new DirectObsError(ownText("errorCurrentPreviewNeedsStudio"), 400);
      }
      return this.catalog.currentPreviewScene;
    }
    const sceneIndex = sceneTargetIndex(target);
    if (sceneIndex !== undefined) return scenes[sceneIndex] ?? "";
    if (target === DIRECT_SCENE_RANDOM) {
      const nonLive = scenes.filter((name) => name !== this.catalog.currentProgramScene);
      const differentPreview = preferPreview && this.catalog.studioMode
        ? nonLive.filter((name) => name !== this.catalog.currentPreviewScene) : nonLive;
      const candidates = differentPreview.length > 0 ? differentPreview : nonLive.length > 0 ? nonLive : scenes;
      return candidates[Math.floor(Math.random() * candidates.length)] ?? "";
    }
    if (target !== DIRECT_SCENE_NEXT && target !== DIRECT_SCENE_PREVIOUS) {
      return scenes.includes(target) ? target : "";
    }
    const current =
      preferPreview && this.catalog.studioMode
        ? this.catalog.currentPreviewScene
        : this.catalog.currentProgramScene;
    const currentIndex = Math.max(0, scenes.indexOf(current));
    const offset = target === DIRECT_SCENE_NEXT ? 1 : -1;
    return scenes[(currentIndex + offset + scenes.length) % scenes.length] ?? "";
  }

  /**
   * Takes a scene list (GetSceneList or SceneListChanged): the names in display order and their UUIDs in the
   * same order; a scene the list gives without a UUID keeps the one already known.
   */
  private applySceneList(value: unknown): void {
    const previous = this.catalog.sceneDetails;
    this.catalog.scenes = sceneNamesInDisplayOrder(value);
    const details = new Map(readSceneDetails(value).map((scene) => [scene.sceneName, scene.sceneUuid]));
    this.catalog.sceneDetails = this.catalog.scenes.flatMap((sceneName) => {
      const sceneUuid = details.get(sceneName) ?? previous.find((scene) => scene.sceneName === sceneName)?.sceneUuid;
      return sceneUuid ? [{ sceneName, sceneUuid }] : [];
    });
  }

  private emitDirectState(): void {
    this.emit("directStateChanged", this.getCatalog());
  }

  /** `ceiling` is 1 (0 dB) unless the source already stood higher: Fadester never adds boost of its own. */
  private async writeInputVolume(inputName: string, value: number, generation = this.controlGeneration, ceiling = 1): Promise<number> {
    this.requireControlGeneration(generation);
    const volume = Math.max(0, Math.min(Math.max(1, Math.min(ceiling, MAX_INPUT_VOLUME_MUL)), value));
    await this.sendObsRequest("SetInputVolume", {
      inputName,
      inputVolumeMul: volume
    });
    this.requireControlGeneration(generation);
    this.catalog.inputVolumes[inputName] = volume;
    this.emitDirectState();
    return volume;
  }

  private requireControlGeneration(generation: number): void {
    if (this.collectionChanging || generation !== this.controlGeneration) {
      throw new DirectObsError(ownText("errorControlChanged"), 400);
    }
  }

  private queueInput<T>(inputName: string, operation: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.controlGeneration;
    const task = (this.inputQueues.get(inputName) ?? Promise.resolve())
      .catch(() => {}).then(() => {
        this.requireControlGeneration(generation);
        return operation(generation);
      });
    this.inputQueues.set(inputName, task);
    void task.finally(() => {
      if (this.inputQueues.get(inputName) === task) this.inputQueues.delete(inputName);
    }).catch(() => {});
    return task;
  }

  private queueTbar(operation: (generation: number) => Promise<number>): Promise<number> {
    const generation = this.controlGeneration;
    const task = this.tbarQueue.catch(() => {}).then(() => {
      this.requireControlGeneration(generation);
      return operation(generation);
    });
    this.tbarQueue = task;
    return task;
  }

  private cancelAllInputFades(): void {
    for (const inputName of this.inputFadeTokens.keys()) this.cancelInputFade(inputName);
  }

  /**
   * Groups with their UUIDs: `GetGroupList` names them, and a group's UUID is
   * read from a scene's group item, so the scenes are read only when OBS has a
   * group (and only until every group is found). Null when OBS did not answer.
   */
  private async readGroupDetails(sceneNames: readonly string[], generation: number): Promise<DirectObsGroupInfo[] | null> {
    let names: string[];
    try {
      names = stringArray((await this.sendObsRequest("GetGroupList")).groups, "groupName");
    } catch {
      return null;
    }
    // A newer refresh (or a disconnect, or a collection change) supersedes this one.
    if (names.length === 0 || generation !== this.catalogRefreshGeneration) return [];
    const found = new Map<string, string>();
    await Promise.all(sceneNames.map(async (sceneName) => {
      try {
        const data = await this.sendObsRequest("GetSceneItemList", { sceneName });
        for (const item of Array.isArray(data.sceneItems) ? data.sceneItems as Array<Record<string, unknown>> : []) {
          if (item.isGroup === true && typeof item.sourceName === "string" && typeof item.sourceUuid === "string" &&
            item.sourceUuid && names.includes(item.sourceName)) {
            found.set(item.sourceName, item.sourceUuid);
          }
        }
      } catch {
        // A scene removed meanwhile; the next refresh reads it again.
      }
    }));
    return names.filter((name) => found.has(name)).map((groupName) => ({ groupName, groupUuid: found.get(groupName)! }));
  }

  // ---- Filters and hotkeys (PLAN.md 10.1, R-RIG-2) -----------------------------------------------
  // Every filter request addresses its source by UUID; the controller (src/control/filter-controller.ts)
  // owns reading, ownership, pacing and the panic latch.

  private requireFilterSource(sourceUuid: string, filterName?: string): void {
    if (!sourceUuid || filterName === "") throw new DirectObsError(ownText("errorFilterChoose"), 400);
    if (this.collectionChanging) throw new DirectObsError(ownText("errorControlChanged"), 400);
  }

  /** The filters on a scene, group or input, in OBS's order, each with the values set on it. */
  public async getSourceFilterList(sourceUuid: string): Promise<DirectObsFilterInfo[]> {
    this.requireFilterSource(sourceUuid);
    const data = await this.sendObsRequest("GetSourceFilterList", { sourceUuid });
    return (Array.isArray(data.filters) ? data.filters : [])
      .map((entry) => readFilterInfo(entry))
      .filter((entry): entry is DirectObsFilterInfo => entry !== null);
  }

  /** One filter; OBS answers 600 for a missing source or filter (renamed counts as missing). */
  public async getSourceFilter(sourceUuid: string, filterName: string): Promise<DirectObsFilterInfo> {
    this.requireFilterSource(sourceUuid, filterName);
    const data = await this.sendObsRequest("GetSourceFilter", { sourceUuid, filterName });
    const info = readFilterInfo(data, filterName);
    if (!info) throw new DirectObsError(ownText("errorRequestFailed", { code: 500 }), 500);
    return info;
  }

  /** A filter kind's static defaults, read once per connection (values OBS leaves out of a filter's settings). */
  public getSourceFilterDefaultSettings(filterKind: string): Promise<Record<string, unknown>> {
    if (!filterKind) return Promise.reject(new DirectObsError(ownText("errorFilterChoose"), 400));
    let cached = this.filterDefaults.get(filterKind);
    if (!cached) {
      cached = this.sendObsRequest("GetSourceFilterDefaultSettings", { filterKind }).then((data) => {
        const defaults = data.defaultFilterSettings;
        return defaults && typeof defaults === "object" && !Array.isArray(defaults) ? { ...(defaults as Record<string, unknown>) } : {};
      });
      this.filterDefaults.set(filterKind, cached);
      const entry = cached;
      // A failed read is not kept.
      void entry.catch(() => { if (this.filterDefaults.get(filterKind) === entry) this.filterDefaults.delete(filterKind); });
    }
    return cached.then((defaults) => ({ ...defaults }));
  }

  /** Writes values into a filter's settings; always `overlay: true`, so other settings keep their values. */
  public async setSourceFilterSettings(sourceUuid: string, filterName: string,
    filterSettings: Readonly<Record<string, number | boolean | string>>): Promise<void> {
    this.requireFilterSource(sourceUuid, filterName);
    await this.sendObsRequest("SetSourceFilterSettings", { sourceUuid, filterName, filterSettings: { ...filterSettings }, overlay: true });
  }

  public async setSourceFilterEnabled(sourceUuid: string, filterName: string, filterEnabled: boolean): Promise<void> {
    this.requireFilterSource(sourceUuid, filterName);
    await this.sendObsRequest("SetSourceFilterEnabled", { sourceUuid, filterName, filterEnabled });
  }

  /**
   * Fires an OBS hotkey by its name, as a press (obs-websocket routes it through
   * OBS's own callback, so OBS's focus does not matter). 600 means no hotkey of
   * that name is registered: the plugin that owns it is not loaded.
   */
  public async triggerHotkeyByName(hotkeyName: string): Promise<void> {
    if (!hotkeyName) throw new DirectObsError(ownText("errorRequestFailed", { code: 400 }), 400);
    await this.sendObsRequest("TriggerHotkeyByName", { hotkeyName });
  }

  // ---- Playlister transport (PLAN.md 9.2) -------------------------------------------------------

  /** Whether this OBS offers the three media requests; known once GetVersion answered. */
  public getMediaCapability(): MediaCapability {
    return this.mediaCapability;
  }

  /** Why a bound Playlister cannot be driven now, or `ok`. Names never resolve a target. */
  public mediaAvailability(inputUuid: string): MediaAvailability {
    if (!inputUuid) return "unbound";
    if (!this.isConnected()) return "disconnected";
    if (this.mediaCapability !== "ok") return "unsupported";
    const info = this.catalog.inputDetails.find((input) => input.inputUuid === inputUuid);
    if (!info) return "missing";
    const kind = info.unversionedInputKind || info.inputKind.replace(/_v\d+$/, "");
    return kind === PLAYLISTER_INPUT_KIND ? "ok" : "wrong_kind";
  }

  /** The display name of a bound input, for messages only. */
  public mediaInputName(inputUuid: string): string {
    return this.catalog.inputDetails.find((input) => input.inputUuid === inputUuid)?.inputName ?? "";
  }

  public getMediaState(inputUuid: string): MediaTargetState {
    const target = this.mediaTargets.get(inputUuid);
    return target ? this.mediaStateOf(target) : {
      availability: this.mediaAvailability(inputUuid), mediaState: "unknown",
      mediaCursor: null, mediaDuration: null, pending: "none", queued: 0
    };
  }

  /**
   * Observes a Playlister: one 500 ms poll per UUID shared by every watcher,
   * running only while the target is present, a Playlister, supported and
   * connected. Returns an idempotent release.
   */
  public watchMedia(inputUuid: string): () => void {
    if (!inputUuid) return () => {};
    const target = this.mediaTargetFor(inputUuid);
    target.watchers++;
    this.reconcileMediaTarget(target);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      target.watchers--;
      if (target.watchers <= 0) {
        target.watchers = 0;
        this.stopMediaPoll(target);
        this.releaseMediaTarget(target);
      }
    };
  }

  /**
   * Queues one press for a Playlister: at most four per UUID including the one
   * in flight, Stop purging the unsent ones first, nothing retried or merged.
   * Everything that cannot be sent throws before any request.
   */
  public async mediaCommand(inputUuid: string, op: MediaOperation): Promise<MediaCommandOutcome> {
    if (this.collectionChanging) throw new DirectObsError(ownText("errorControlChanged"), 400);
    const availability = this.mediaAvailability(inputUuid);
    if (availability !== "ok") throw this.mediaAvailabilityError(availability, inputUuid);
    const target = this.mediaTargetFor(inputUuid);
    if (op === "stop") this.purgeMediaQueue(target);
    // A toggle's intent is taken at the press: a second one is pending, never a reverse toggle.
    if (op === "playpause" && (target.queue.some((entry) => entry.op === "playpause") ||
      target.pending === "play" || target.pending === "pause")) {
      throw new DirectObsError(ownText("errorMediaPending"), 400);
    }
    if (target.queue.length >= MEDIA_QUEUE_LIMIT) throw new DirectObsError(ownText("errorMediaBusy"), 400);
    const outcome = new Promise<MediaCommandOutcome>((resolve, reject) => {
      target.queue.push({ op, generation: this.mediaGeneration, resolve, reject });
    });
    this.emitMediaState(target);
    void this.runMediaQueue(target);
    return outcome;
  }

  private mediaAvailabilityError(availability: MediaAvailability, inputUuid: string): DirectObsError {
    switch (availability) {
      case "unbound": return new DirectObsError(ownText("errorMediaChoose"), 400);
      case "disconnected": return new DirectObsError(ownText("layerErrorNotConnected"), 500);
      case "unsupported": return new DirectObsError(ownText("errorMediaUnsupported"), 400);
      case "wrong_kind": return new DirectObsError(ownText("errorMediaWrongKind", { input: this.mediaInputName(inputUuid) }), 400);
      default: return new DirectObsError(ownText("errorMediaMissing"), 404);
    }
  }

  private mediaTargetFor(inputUuid: string): MediaTarget {
    let target = this.mediaTargets.get(inputUuid);
    if (!target) {
      target = {
        uuid: inputUuid, watchers: 0, polling: false, pollTimer: null, statusInFlight: false,
        statusChain: Promise.resolve(), trailingRead: null, lastAppliedSequence: 0,
        mediaState: "unknown", cursor: null, duration: null, pending: "none", pendingStamp: 0, pauseTimer: null,
        commandStamp: 0, pendingBarrier: 0, loadSentAt: 0, queue: [], running: false, signature: ""
      };
      this.mediaTargets.set(inputUuid, target);
    }
    return target;
  }

  private releaseMediaTarget(target: MediaTarget): void {
    if (target.watchers > 0 || target.queue.length > 0 || target.running) return;
    this.clearMediaPending(target);
    if (this.mediaTargets.get(target.uuid) === target) this.mediaTargets.delete(target.uuid);
  }

  private mediaStateOf(target: MediaTarget): MediaTargetState {
    return {
      availability: this.mediaAvailability(target.uuid),
      mediaState: target.mediaState,
      mediaCursor: target.cursor,
      mediaDuration: target.duration,
      pending: target.pending,
      queued: target.queue.length
    };
  }

  /** `mediaStateChanged(uuid, state)` when the state's signature changed; never through the catalog event. */
  private emitMediaState(target: MediaTarget): void {
    if (this.mediaTargets.get(target.uuid) !== target) return;
    const state = this.mediaStateOf(target);
    const signature = JSON.stringify(state);
    if (signature === target.signature) return;
    target.signature = signature;
    this.emit("mediaStateChanged", target.uuid, state);
  }

  private resetMediaObservation(target: MediaTarget): void {
    target.mediaState = "unknown";
    target.cursor = null;
    target.duration = null;
  }

  /** After connect, every catalog publication, a removal or a collection change: polls and validity follow. */
  private reconcileMediaTargets(): void {
    for (const target of this.mediaTargets.values()) this.reconcileMediaTarget(target);
  }

  private reconcileMediaTarget(target: MediaTarget): void {
    if (this.mediaAvailability(target.uuid) !== "ok") {
      this.stopMediaPoll(target);
      this.purgeMediaQueue(target);
      this.clearMediaPending(target);
      this.resetMediaObservation(target);
    } else if (target.watchers > 0) {
      this.startMediaPoll(target);
    }
    this.emitMediaState(target);
  }

  /** Disconnect, stop, reconnect or a collection change: every poll off, every queue purged, every wait void. */
  private invalidateMediaTargets(): void {
    this.mediaGeneration++;
    for (const target of this.mediaTargets.values()) {
      this.stopMediaPoll(target);
      // A read queued under the old generation is not shared with the next one.
      target.trailingRead = null;
      this.purgeMediaQueue(target);
      this.clearMediaPending(target);
      this.resetMediaObservation(target);
      this.emitMediaState(target);
    }
  }

  /** Polls are started only for watched targets and stopped by the last release; this gates each tick. */
  private mediaPollAllowed(target: MediaTarget): boolean {
    return this.mediaAvailability(target.uuid) === "ok";
  }

  private startMediaPoll(target: MediaTarget): void {
    if (target.polling) return;
    target.polling = true;
    this.scheduleMediaPoll(target, 0);
  }

  private stopMediaPoll(target: MediaTarget): void {
    target.polling = false;
    if (target.pollTimer) {
      clearTimeout(target.pollTimer);
      target.pollTimer = null;
    }
  }

  private scheduleMediaPoll(target: MediaTarget, delayMs: number): void {
    if (target.pollTimer) return;
    target.pollTimer = setTimeout(() => {
      target.pollTimer = null;
      void this.pollMedia(target);
    }, delayMs);
    target.pollTimer.unref?.();
  }

  private async pollMedia(target: MediaTarget): Promise<void> {
    if (!target.polling) return;
    if (!this.mediaPollAllowed(target)) {
      target.polling = false;
      return;
    }
    // One status request in flight per UUID: a tick that finds one skips.
    if (!target.statusInFlight) await this.freshMediaRead(target).catch(() => {});
    if (!target.polling) return;
    if (this.mediaPollAllowed(target)) this.scheduleMediaPoll(target, MEDIA_POLL_MS);
    else target.polling = false;
  }

  /**
   * A status read sent after any read in flight has settled (never adopted
   * from one sent earlier); reads queued before it is sent share it.
   */
  private freshMediaRead(target: MediaTarget): Promise<MediaStatusReply> {
    if (target.trailingRead) return target.trailingRead;
    const generation = this.mediaGeneration;
    const read = target.statusChain.then(() => {
      if (target.trailingRead === read) target.trailingRead = null;
      return this.readMediaStatus(target, generation);
    });
    target.statusChain = read.catch(() => {});
    target.trailingRead = read;
    return read;
  }

  private async readMediaStatus(target: MediaTarget, generation: number): Promise<MediaStatusReply> {
    if (generation !== this.mediaGeneration) throw new DirectObsError(ownText("errorControlChanged"), 400);
    // InputRemoved bumps no generation: a target that left OBS (or cannot be driven now) is never read.
    const availability = this.mediaAvailability(target.uuid);
    if (availability !== "ok") throw this.mediaAvailabilityError(availability, target.uuid);
    const sequence = ++this.mediaSequence;
    target.statusInFlight = true;
    try {
      const data = await this.sendObsRequest("GetMediaInputStatus", { inputUuid: target.uuid });
      const reply = parseMediaStatus(data);
      // A reply that lands after the target left OBS is dropped.
      if (this.mediaAvailability(target.uuid) !== "ok") return reply;
      // A late reply of an old generation, or one older than what was applied, never touches state.
      // (Reads of one target are serialized, so the sequence half is insurance no path reaches.)
      if (generation === this.mediaGeneration && sequence > target.lastAppliedSequence) {
        target.lastAppliedSequence = sequence;
        this.applyMediaStatus(target, reply);
      }
      return reply;
    } finally {
      target.statusInFlight = false;
    }
  }

  private applyMediaStatus(target: MediaTarget, reply: MediaStatusReply): void {
    const previous = target.mediaState;
    target.mediaState = reply.state;
    target.cursor = reply.cursor;
    target.duration = reply.duration;
    if (target.pending === "pause") {
      // A load of ours unloads the child (NONE) before the native held pause lands: NONE inside that
      // window is not the pause's outcome.
      const settled = reply.state === "paused" || reply.state === "stopped" || reply.state === "ended" ||
        reply.state === "error" || (reply.state === "none" && Date.now() - target.loadSentAt > MEDIA_LOAD_WINDOW_MS);
      if (settled) this.clearMediaPending(target);
    } else if (target.pending === "unconfirmed" && reply.state !== previous) {
      this.clearMediaPending(target);
    }
    this.emitMediaState(target);
  }

  private setMediaPending(target: MediaTarget, pending: "play" | "pause", stamp: number): void {
    if (stamp <= target.pendingBarrier) return;
    this.clearMediaPending(target);
    target.pending = pending;
    target.pendingStamp = stamp;
    if (pending === "pause") {
      const generation = this.mediaGeneration;
      target.pauseTimer = setTimeout(() => {
        target.pauseTimer = null;
        if (generation !== this.mediaGeneration || target.pending !== "pause" || target.pendingStamp !== stamp) return;
        target.pending = "unconfirmed";
        this.emitMediaState(target);
      }, this.mediaPauseWaitMs);
      target.pauseTimer.unref?.();
    }
    this.emitMediaState(target);
  }

  private clearMediaPending(target: MediaTarget): void {
    if (target.pauseTimer) {
      clearTimeout(target.pauseTimer);
      target.pauseTimer = null;
    }
    target.pending = "none";
  }

  /** Settles every unsent press as cancelled; the one in flight cannot be undone. */
  private purgeMediaQueue(target: MediaTarget): void {
    const keep = target.running ? 1 : 0;
    const purged = target.queue.splice(keep);
    for (const entry of purged) entry.resolve("cancelled");
    if (purged.length > 0) this.emitMediaState(target);
  }

  private async runMediaQueue(target: MediaTarget): Promise<void> {
    if (target.running) return;
    target.running = true;
    try {
      while (target.queue.length > 0) {
        const entry = target.queue[0]!;
        try {
          entry.resolve(await this.executeMediaCommand(target, entry));
        } catch (error) {
          entry.reject(error);
        }
        if (target.queue[0] === entry) target.queue.shift();
        this.emitMediaState(target);
      }
    } finally {
      target.running = false;
      this.releaseMediaTarget(target);
    }
  }

  private async executeMediaCommand(target: MediaTarget, entry: MediaCommandEntry): Promise<MediaCommandOutcome> {
    const stamp = ++target.commandStamp;
    const generation = entry.generation;
    // Invalidated before anything was sent: a quiet cancellation, never an error.
    if (generation !== this.mediaGeneration || this.mediaAvailability(target.uuid) !== "ok") return "cancelled";
    let action: MediaAction;
    if (entry.op === "playpause") {
      // The direction comes from a fresh read inside the queue, never from the key's last picture.
      let reply: MediaStatusReply;
      try {
        reply = await this.freshMediaRead(target);
      } catch (error) {
        // Invalidated, or the input left before its read went out: nothing was sent.
        if (generation !== this.mediaGeneration || this.mediaAvailability(target.uuid) !== "ok") return "cancelled";
        throw error;
      }
      // The read took time: the input may have left meanwhile (InputRemoved bumps no generation).
      if (generation !== this.mediaGeneration || this.mediaAvailability(target.uuid) !== "ok") return "cancelled";
      switch (reply.state) {
        case "playing": action = "pause"; break;
        case "paused": case "stopped": case "ended": case "none": action = "play"; break;
        case "opening": case "buffering":
          throw new DirectObsError(ownText("errorMediaChanging"), 400);
        default:
          throw new DirectObsError(ownText("errorMediaAmbiguous"), 400);
      }
      this.setMediaPending(target, action, stamp);
    } else {
      action = entry.op;
      // An explicit transport command drops any pending intent and bars an older toggle from setting one.
      this.clearMediaPending(target);
      target.pendingBarrier = stamp;
      this.emitMediaState(target);
    }
    try {
      await this.sendObsRequest("TriggerMediaInputAction", { inputUuid: target.uuid, mediaAction: OBS_MEDIA_ACTIONS[action] });
    } catch (error) {
      if (target.pendingStamp === stamp) this.clearMediaPending(target);
      this.emitMediaState(target);
      throw error;
    }
    if (generation !== this.mediaGeneration) return "sent";
    if (action !== "pause" && action !== "stop") target.loadSentAt = Date.now();
    // Exactly one trailing fresh read; only its attempt releases PLAY's mark (PAUSE waits for an observation).
    const trailing = this.freshMediaRead(target).catch(() => undefined);
    if (action === "play") {
      void trailing.then(() => {
        if (generation !== this.mediaGeneration || target.pending !== "play" || target.pendingStamp !== stamp) return;
        this.clearMediaPending(target);
        this.emitMediaState(target);
      });
    }
    return "sent";
  }
}
