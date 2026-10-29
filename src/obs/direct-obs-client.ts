// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Direct, stock-OBS controls. This deliberately uses only obs-websocket v5
 * requests so the Stream Deck plugin remains useful without Midi Fadester or
 * a connected MIDI controller.
 */
import { FadesterGlobalSettings } from "../types/settings.js";
import { ConnectionStatusInfo } from "../../packages/streamdeck-fadester-shared/src/types.js";
import { automaticInputLabel, resolveAutomaticInputName } from "./automatic-targets.js";
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
  return index !== undefined ? `Scene ${index + 1} (automatic)` : undefined;
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

export interface DirectObsCatalog {
  scenes: string[];
  inputs: string[];
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
>;

export class DirectObsError extends ObsVendorError {
  public constructor(comment: string, code = -1) {
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
  private readonly catalogEventRevisions = { scenes: 0, studio: 0, program: 0, preview: 0, transition: 0, volumes: 0 };
  private readonly inputVolumeEventRevisions = new Map<string, number>();
  private sceneCycleGeneration = 0;
  private sceneCycle: {
    token: number; live: string; next: string; transition: string; started: boolean; ended: boolean;
  } | null = null;

  public constructor(
    initialSettings?: FadesterGlobalSettings,
    options?: DirectObsClientOptions
  ) {
    super(initialSettings, {
      ...options,
      surfaceDisplayName: "Fadester for OBS"
    });
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
    super.stop();
  }

  public override reconnectNow(): void {
    this.collectionChanging = false;
    this.connectionGeneration++;
    this.controlGeneration++;
    this.catalogRefreshGeneration++;
    this.cancelAllInputFades();
    this.cancelSceneCycle();
    super.reconnectNow();
  }

  public override getStatus(): ConnectionStatusInfo {
    return super.getStatus();
  }

  public getCatalog(): DirectObsCatalog {
    return {
      ...this.catalog,
      scenes: [...this.catalog.scenes],
      inputs: [...this.catalog.inputs],
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
      throw new DirectObsError(`OBS did not return a volume for '${name}'.`, 500);
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
    const role = automaticInputLabel(target);
    throw new DirectObsError(role
      ? `${role.replace(" (automatic)", "")} is unavailable. Choose an OBS mixer input in the inspector.`
      : "Choose an existing OBS mixer input first.", 400);
  }

  /** An explicit setup step, requested from the layout picker. Never takes a scene live. */
  public async prepareStudioLayout(): Promise<DirectObsCatalog> {
    const generation = this.controlGeneration;
    const task = this.sceneQueue.catch(() => {}).then(async () => {
      this.requireControlGeneration(generation);
      if (!this.isConnected()) throw new DirectObsError("Connect to OBS before preparing a Studio layout.", 400);
      await this.sendObsRequest("SetStudioModeEnabled", { studioModeEnabled: true });
      this.requireControlGeneration(generation);
      await this.refreshCatalog();
      this.requireControlGeneration(generation);
      if (!this.catalog.studioMode) throw new DirectObsError("OBS Studio Mode could not be enabled.", 400);
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
      throw new DirectObsError("Scene T-bar needs OBS Studio Mode.", 400);
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
      throw new DirectObsError(index !== undefined
        ? `Scene ${index + 1} is unavailable; OBS has ${this.catalog.scenes.length} scenes.`
        : "Choose an existing OBS scene first.", 400);
    }

    if (operation === "preview") {
      if (!this.catalog.studioMode) {
        throw new DirectObsError("Preview selection needs OBS Studio Mode.", 400);
      }
      await this.sendObsRequest("SetCurrentPreviewScene", { sceneName });
      this.requireControlGeneration(generation);
      this.catalog.currentPreviewScene = sceneName;
    } else {
      const isCut = operation === "cut" || transitionName === OBS_TRANSITION_CUT;
      const chosenTransition = isCut ? this.cutTransitionName : transitionName;
      if (isCut && !chosenTransition) {
        throw new DirectObsError("OBS did not provide its Cut transition. Refresh the OBS lists.", 400);
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

  protected override createVendorError(comment: string, code = -1): ObsVendorError {
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
      await this.refreshCatalog();
      if (connection !== this.connectionGeneration) return;
      this.reconnectAttempt = 0;
      this.haltedReason = "none";
      this.setStatus({
        kind: "connected",
        sentence: `Connected: OBS ${obsVersion}`,
        cellReason: "",
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
        ...this.catalog, scenes: [], inputs: [], inputVolumes: {},
        currentProgramScene: "", currentPreviewScene: "", tbarPosition: 0
      };
      this.emitDirectState();
    }

    if (eventType === "InputRemoved" && typeof eventData.inputName === "string") {
      this.cancelInputFade(eventData.inputName);
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
      this.emitDirectState();
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
        throw new DirectObsError("Current Preview needs OBS Studio Mode. Choose a fixed scene, Next scene, or Previous scene in regular mode.", 400);
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
      throw new DirectObsError("OBS connection or scene collection changed. Try the control again.", 400);
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
}
