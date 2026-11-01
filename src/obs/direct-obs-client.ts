// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Direct, stock-OBS controls. This deliberately uses only obs-websocket v5
 * requests so the Stream Deck plugin remains useful without Midi Fadester or
 * a connected MIDI controller.
 */
import { FadesterGlobalSettings } from "../types/settings.js";
import { ConnectionStatusInfo } from "../../packages/streamdeck-fadester-shared/src/types.js";
import { automaticInputRole, resolveAutomaticInputName } from "./automatic-targets.js";
import { LocalText, ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";
import { t } from "../i18n/strings.js";
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
  "baseReconnectMs" | "maxReconnectMs" | "requestTimeoutMs"
> & {
  /** How long a sent PAUSE waits for an observed PAUSED before the key says "unconfirmed" (tests shorten it). */
  mediaPauseWaitMs?: number;
};

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

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * A thin direct-OBS backend. It overrides the vendor client's post-identify
 * step, so a stock OBS connection is healthy even when no vendor plugin is
 * installed.
 */
export class DirectObsClient extends ObsVendorClient {
  private catalog: DirectObsCatalog = {
    scenes: [],
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
    token: number; live: string; next: string; transition: string; started: boolean; ended: boolean;
  } | null = null;
  private mediaCapability: MediaCapability = "unknown";
  private mediaGeneration = 0;
  private mediaSequence = 0;
  private readonly mediaTargets = new Map<string, MediaTarget>();
  private readonly mediaPauseWaitMs: number;

  public constructor(
    initialSettings?: FadesterGlobalSettings,
    options?: DirectObsClientOptions
  ) {
    super(initialSettings, {
      ...options,
      surfaceDisplayName: "Fadester for OBS"
    });
    this.mediaPauseWaitMs = options?.mediaPauseWaitMs ?? MEDIA_PAUSE_WAIT_MS;
    // Several controls on a full deck intentionally share this one client.
    this.setMaxListeners(0);
    this.on("statusChanged", (status: ConnectionStatusInfo) => {
      if (status.kind !== "connected") {
        this.collectionChanging = false;
        this.connectionGeneration++;
        this.controlGeneration++;
        this.catalogRefreshGeneration++;
        this.cancelAllInputFades();
        this.cancelSceneCycle();
        this.mediaCapability = "unknown";
        this.invalidateMediaTargets();
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
    super.stop();
    // After the socket is gone, so the targets read as disconnected.
    this.invalidateMediaTargets();
  }

  public override reconnectNow(): void {
    this.collectionChanging = false;
    this.connectionGeneration++;
    this.controlGeneration++;
    this.catalogRefreshGeneration++;
    this.cancelAllInputFades();
    this.cancelSceneCycle();
    this.mediaCapability = "unknown";
    super.reconnectNow();
    this.invalidateMediaTargets();
  }

  public override getStatus(): ConnectionStatusInfo {
    return super.getStatus();
  }

  public getCatalog(): DirectObsCatalog {
    return {
      ...this.catalog,
      scenes: [...this.catalog.scenes],
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
    if (revisions.scenes !== this.catalogEventRevisions.scenes) next.scenes = [...this.catalog.scenes];
    if (revisions.studio !== this.catalogEventRevisions.studio) next.studioMode = this.catalog.studioMode;
    if (revisions.program !== this.catalogEventRevisions.program) next.currentProgramScene = this.catalog.currentProgramScene;
    if (revisions.preview !== this.catalogEventRevisions.preview) next.currentPreviewScene = this.catalog.currentPreviewScene;
    if (revisions.transition !== this.catalogEventRevisions.transition) next.currentTransition = this.catalog.currentTransition;
    // An InputRemoved or rename applied meanwhile is newer than this listing: never resurrect the input.
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
      return this.writeInputVolume(name, current + delta, generation);
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
          await this.writeInputVolume(name, from + (target - from) * progress);
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
      if (!this.catalog.currentPreviewScene || this.catalog.currentPreviewScene === this.catalog.currentProgramScene) {
        const scenes = this.catalog.scenes;
        const index = scenes.indexOf(this.catalog.currentProgramScene);
        const next = scenes[(index + 1) % scenes.length];
        if (next && next !== this.catalog.currentProgramScene) {
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
    const shouldRelease = release || (queueNextScene && position >= 1);
    // Ignore extra encoder ticks while OBS's completed transition is settling
    // and the next Preview is being prepared.
    if (this.sceneCycle?.ended) return this.catalog.tbarPosition;
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
      await this.sendObsRequest("SetTBarPosition", { position, release: shouldRelease });
      this.requireControlGeneration(generation);
    } catch (error) {
      this.cancelSceneCycle();
      throw error;
    }
    this.catalog.tbarPosition = shouldRelease ? 0 : position;
    this.emitDirectState();
    return this.catalog.tbarPosition;
  }

  public async nudgeTbar(delta: number, queueNextScene = false): Promise<number> {
    return this.queueTbar((generation) =>
      this.writeTbarPosition(this.catalog.tbarPosition + delta, false, queueNextScene, generation));
  }

  public cancelSceneCycle(): void {
    this.sceneCycleGeneration++;
    this.sceneCycle = null;
  }

  private finishSceneCycle(transitionName: unknown): void {
    const cycle = this.sceneCycle;
    if (!cycle || cycle.ended || transitionName !== cycle.transition) return;
    cycle.ended = true;
    void this.tbarQueue.catch(() => {}).then(async () => {
      const task = this.sceneQueue.catch(() => {}).then(async () => {
        if (cycle.token !== this.sceneCycleGeneration || !this.isConnected() || !this.catalog.studioMode) return;
        await this.refreshCurrentSceneNames();
        // Aborts, unrelated transitions and an operator's new Preview choice
        // must never cause an automatic scene change.
        if (cycle.token !== this.sceneCycleGeneration || this.catalog.currentProgramScene !== cycle.next ||
          ![cycle.live, cycle.next].includes(this.catalog.currentPreviewScene)) return;
        const sceneList = await this.sendObsRequest("GetSceneList");
        if (cycle.token !== this.sceneCycleGeneration || !this.catalog.studioMode) return;
        const scenes = sceneNamesInDisplayOrder(sceneList.scenes);
        this.catalog.scenes = scenes;
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
    this.catalog.scenes = sceneNamesInDisplayOrder(sceneList.scenes);
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
    // A scene can override the global transition; temporarily select the
    // requested transition on this destination to guarantee Cut/Fade/etc.
    await this.sendObsRequest("SetSceneSceneTransitionOverride", {
      sceneName,
      transitionName,
      transitionDuration: null
    });
    try {
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
    const revisions = { ...this.catalogEventRevisions };
    const program = await this.sendObsRequest("GetCurrentProgramScene");
    this.requireControlGeneration(generation);
    const name = program.currentProgramSceneName ?? program.sceneName;
    if (typeof name === "string" && revisions.program === this.catalogEventRevisions.program) this.catalog.currentProgramScene = name;
    if (this.catalog.studioMode) {
      const preview = await this.sendObsRequest("GetCurrentPreviewScene");
      this.requireControlGeneration(generation);
      const previewName = preview.currentPreviewSceneName ?? preview.sceneName;
      if (typeof previewName === "string" && revisions.preview === this.catalogEventRevisions.preview) this.catalog.currentPreviewScene = previewName;
    }
  }

  protected override createVendorError(comment: string | LocalText, code = -1): ObsVendorError {
    return new DirectObsError(comment, code);
  }

  protected override async initializeAfterIdentify(): Promise<void> {
    const connection = this.connectionGeneration;
    try {
      const versionData = await this.sendObsRequest("GetVersion");
      if (connection !== this.connectionGeneration) return;
      const obsVersion =
        typeof versionData.obsVersion === "string"
          ? versionData.obsVersion
          : typeof versionData.obsStudioVersion === "string"
            ? versionData.obsStudioVersion
            : "OBS";
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
      this.emitDirectState();
    } catch {
      // The close handler owns reconnect and connection-error status.
    }
  }

  protected override handleObsEvent(d: Record<string, unknown>): void {
    super.handleObsEvent(d);
    const eventType = typeof d.eventType === "string" ? d.eventType : "";
    const eventData = (d.eventData ?? {}) as Record<string, unknown>;

    if (eventType === "SceneTransitionStarted") {
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
      this.finishSceneCycle(eventData.transitionName);
      return;
    }
    if (eventType === "CurrentSceneCollectionChanging" || eventType === "CurrentSceneCollectionChanged") {
      this.collectionChanging = eventType === "CurrentSceneCollectionChanging";
      this.controlGeneration++;
      this.catalogRefreshGeneration++;
      this.cancelAllInputFades();
      this.cancelSceneCycle();
      this.catalog = {
        ...this.catalog, scenes: [], inputs: [], inputDetails: [], inputVolumes: {},
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
      this.catalog.scenes = sceneNamesInDisplayOrder(eventData.scenes);
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
      if (!this.catalog.studioMode) this.cancelSceneCycle();
      else {
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

  private emitDirectState(): void {
    this.emit("directStateChanged", this.getCatalog());
  }

  private async writeInputVolume(inputName: string, value: number, generation = this.controlGeneration): Promise<number> {
    this.requireControlGeneration(generation);
    const volume = clampUnit(value);
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
    const sequence = ++this.mediaSequence;
    target.statusInFlight = true;
    try {
      const data = await this.sendObsRequest("GetMediaInputStatus", { inputUuid: target.uuid });
      const reply = parseMediaStatus(data);
      // A late reply of an old generation, or one older than what was applied, never touches state.
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
        if (generation !== this.mediaGeneration) return "cancelled";
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
