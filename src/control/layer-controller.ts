// SPDX-License-Identifier: GPL-2.0-or-later
import { EventEmitter } from "node:events";
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";

export const BLEND_MODES = [
  { id: "OBS_BLEND_NORMAL", label: "Normal" },
  { id: "OBS_BLEND_ADDITIVE", label: "Additive" },
  { id: "OBS_BLEND_SUBTRACT", label: "Subtract" },
  { id: "OBS_BLEND_SCREEN", label: "Screen" },
  { id: "OBS_BLEND_MULTIPLY", label: "Multiply" },
  { id: "OBS_BLEND_LIGHTEN", label: "Lighten" },
  { id: "OBS_BLEND_DARKEN", label: "Darken" }
] as const;

function normalizeBlendMode(value: unknown): typeof BLEND_MODES[number]["id"] {
  const mode = typeof value === "number" && Number.isInteger(value)
    ? BLEND_MODES[value]
    : BLEND_MODES.find((entry) => entry.id === value);
  return mode?.id ?? "OBS_BLEND_NORMAL";
}

export type LayerOperation = "select_next" | "select_previous" | "move_up" |
  "move_down" | "show_hide" | "blend_next" | "blend_previous" | "blend_normal";
export type LayerScope = "auto" | "program" | "fixed";
export interface LayerSettings {
  [key: string]: string | number | boolean | undefined;
  scope?: LayerScope;
  sceneName?: string;
  target?: "selected" | "fixed";
  sceneItemId?: number;
  /** Identity saved with a fixed source, so a reused scene-item ID cannot retarget it. */
  sourceUuid?: string;
  sourceName?: string;
  operation?: LayerOperation;
  dialMode?: "select_layer" | "blend" | "order";
  allowReorder?: boolean;
  labelOverride?: string;
}
export interface ObsLayer {
  sceneItemId: number;
  sceneItemIndex: number;
  sourceName: string;
  sourceUuid?: string;
  enabled: boolean;
  blendMode: string;
  isGroup: boolean;
}
export interface LayerSceneState {
  sceneName: string;
  layers: ObsLayer[];
  selectedId: number;
  error: string;
}

export function normalizeLayerSettings(raw: LayerSettings = {}): Required<LayerSettings> {
  const operations: LayerOperation[] = ["select_next", "select_previous", "move_up", "move_down",
    "show_hide", "blend_next", "blend_previous", "blend_normal"];
  return {
    scope: raw.scope === "fixed" || raw.scope === "program" ? raw.scope : "auto",
    sceneName: typeof raw.sceneName === "string" ? raw.sceneName.trim() : "",
    target: raw.target === "fixed" ? "fixed" : "selected",
    sceneItemId: Number.isInteger(raw.sceneItemId) ? Number(raw.sceneItemId) : -1,
    sourceUuid: typeof raw.sourceUuid === "string" ? raw.sourceUuid.trim() : "",
    sourceName: typeof raw.sourceName === "string" ? raw.sourceName : "",
    operation: operations.includes(raw.operation!) ? raw.operation! : "select_next",
    dialMode: raw.dialMode === "blend" || raw.dialMode === "order" ? raw.dialMode : "select_layer",
    allowReorder: raw.allowReorder === true,
    labelOverride: typeof raw.labelOverride === "string" ? raw.labelOverride.trim().slice(0, 20) : ""
  };
}

/** Older saved bindings only contain the item ID. New choices carry identity;
 * prefer UUID because OBS source renames preserve it. */
export function matchesLayerIdentity(layer: ObsLayer, identity: Pick<LayerSettings, "sourceUuid" | "sourceName">): boolean {
  return identity.sourceUuid ? layer.sourceUuid === identity.sourceUuid :
    !identity.sourceName || layer.sourceName === identity.sourceName;
}

/** Shared source selection belongs to this deck, without changing OBS's UI
 * selection. IDs are scoped to their scene and checked before every edit. */
export class LayerController extends EventEmitter {
  private readonly scenes = new Map<string, LayerSceneState>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly refreshing = new Map<string, Promise<LayerSceneState>>();
  private readonly watched = new Map<string, number>();
  private readonly selections = new Map<string, {
    sceneItemId: number; manual: boolean; sourceUuid?: string; sourceName?: string;
  }>();
  private poll: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private collectionChanging = false;
  private sceneSignature = "";

  public constructor(public readonly client: DirectObsClient) {
    super();
    this.setMaxListeners(0);
    client.on("directStateChanged", () => {
      const catalog = client.getCatalog();
      const signature = JSON.stringify([catalog.studioMode, catalog.currentProgramScene, catalog.currentPreviewScene]);
      if (signature !== this.sceneSignature) {
        this.sceneSignature = signature;
        void this.refreshWatched();
      }
    });
    client.on("statusChanged", () => {
      this.generation++;
      this.scenes.clear();
      this.refreshing.clear();
      // A disconnected switch may never deliver its Changed event. The next
      // established connection will re-read sources from OBS from scratch.
      if (client.isConnected() && this.collectionChanging) this.collectionChanging = false;
      this.emit("changed");
      if (client.isConnected()) void this.refreshWatched();
    });
    client.on("obsEvent", (type: string, data: Record<string, unknown>) => {
      if (type === "CurrentSceneCollectionChanging" || type === "CurrentSceneCollectionChanged") {
        this.collectionChanging = type === "CurrentSceneCollectionChanging";
        this.generation++;
        this.scenes.clear();
        this.selections.clear();
        this.refreshing.clear();
        this.emit("changed");
        if (!this.collectionChanging) void this.refreshWatched();
        return;
      }
      if (["SceneItemCreated", "SceneItemRemoved", "SceneItemListReindexed",
        "SceneItemEnableStateChanged"].includes(type)) {
        const name = typeof data.sceneName === "string" ? data.sceneName : "";
        if (name && this.scenes.has(name)) void this.refreshScene(name).catch(() => {});
        else if (!name) { this.generation++; this.scenes.clear(); this.selections.clear(); this.refreshing.clear(); void this.refreshWatched(); }
      }
    });
  }

  public resolveScene(raw: LayerSettings): string {
    const settings = normalizeLayerSettings(raw);
    const catalog = this.client.getCatalog();
    return settings.scope === "fixed" ? settings.sceneName :
      settings.scope === "program" || !catalog.studioMode ? catalog.currentProgramScene : catalog.currentPreviewScene;
  }

  public getScene(raw: LayerSettings): LayerSceneState {
    const sceneName = this.resolveScene(raw);
    const value = this.scenes.get(sceneName);
    return value ? { ...value, layers: value.layers.map((layer) => ({ ...layer })) } :
      { sceneName, layers: [], selectedId: -1, error: "" };
  }

  public getCatalog(): Record<string, LayerSceneState> {
    return Object.fromEntries([...this.scenes].map(([name, value]) =>
      [name, { ...value, layers: value.layers.map((layer) => ({ ...layer })) }]));
  }

  public watch(raw: LayerSettings): () => void {
    const key = JSON.stringify({ scope: raw.scope || "auto", sceneName: raw.sceneName || "" });
    this.watched.set(key, (this.watched.get(key) ?? 0) + 1);
    if (!this.poll) {
      this.poll = setInterval(() => { void this.refreshWatched(); }, 2000);
      this.poll.unref();
    }
    void this.refresh(raw).catch(() => {});
    return () => {
      const count = (this.watched.get(key) ?? 1) - 1;
      if (count > 0) this.watched.set(key, count); else this.watched.delete(key);
      if (this.watched.size === 0 && this.poll) { clearInterval(this.poll); this.poll = undefined; }
    };
  }

  public async refresh(raw: LayerSettings): Promise<LayerSceneState> {
    const sceneName = this.resolveScene(raw);
    if (!sceneName || !this.client.isConnected() || this.collectionChanging) return this.getScene(raw);
    return this.refreshScene(sceneName);
  }

  public async selectLayer(sceneName: string, sceneItemId: number): Promise<void> {
    if (!this.client.isConnected() || !Number.isInteger(sceneItemId)) {
      throw new DirectObsError("Connect OBS and choose a source.");
    }
    if (this.collectionChanging) throw new DirectObsError("OBS scene collection is changing. Try again.");
    const generation = this.generation;
    await this.enqueue(sceneName, async () => {
      if (generation !== this.generation) throw new DirectObsError("OBS connection changed. Choose the source again.");
      const scene = await this.refreshScene(sceneName);
      if (generation !== this.generation || this.collectionChanging) throw new DirectObsError("OBS connection or scene collection changed. Try again.");
      const selected = scene.layers.find((layer) => layer.sceneItemId === sceneItemId);
      if (!selected) {
        throw new DirectObsError("The selected source is no longer in this scene.");
      }
      scene.selectedId = sceneItemId;
      this.selections.set(sceneName, { sceneItemId, manual: true, sourceUuid: selected.sourceUuid, sourceName: selected.sourceName });
      this.scenes.set(sceneName, scene);
      this.emit("changed");
    });
  }

  public async perform(raw: LayerSettings, operation: LayerOperation, steps = 1): Promise<void> {
    const settings = normalizeLayerSettings(raw);
    const sceneName = this.resolveScene(settings);
    const generation = this.generation;
    if (!this.client.isConnected()) throw new DirectObsError("OBS is not connected.");
    if (this.collectionChanging) throw new DirectObsError("OBS scene collection is changing. Try again.");
    if (!sceneName) throw new DirectObsError("Choose an OBS scene first.");
    if (settings.target === "fixed" && settings.scope !== "fixed" &&
      operation !== "select_next" && operation !== "select_previous") {
      throw new DirectObsError("A fixed source must be bound to a specific scene. Choose the scene again.");
    }
    if ((operation === "move_up" || operation === "move_down") && !settings.allowReorder) {
      throw new DirectObsError("Enable layer reordering for this creative control first.");
    }
    await this.enqueue(sceneName, async () => {
      if (generation !== this.generation || this.collectionChanging) throw new DirectObsError("OBS connection or scene collection changed. Try again.");
      const scene = await this.refreshScene(sceneName);
      if (generation !== this.generation || this.collectionChanging) throw new DirectObsError("OBS connection or scene collection changed. Try again.");
      if (scene.layers.length === 0) throw new DirectObsError("This scene has no sources to control.");
      if (operation === "select_next" || operation === "select_previous") {
        const current = scene.layers.findIndex((layer) => layer.sceneItemId === scene.selectedId);
        const offset = (operation === "select_next" ? 1 : -1) * Math.max(1, Math.abs(Math.trunc(steps)));
        const position = current < 0 ? (offset > 0 ? offset - 1 : offset) : current + offset;
        scene.selectedId = scene.layers[((position % scene.layers.length) + scene.layers.length) % scene.layers.length].sceneItemId;
        const selected = scene.layers.find((layer) => layer.sceneItemId === scene.selectedId)!;
        this.selections.set(sceneName, { sceneItemId: scene.selectedId, manual: true, sourceUuid: selected.sourceUuid, sourceName: selected.sourceName });
        this.scenes.set(sceneName, scene);
        this.emit("changed");
        return;
      }
      const id = settings.target === "fixed" ? settings.sceneItemId : scene.selectedId;
      const layer = scene.layers.find((item) => item.sceneItemId === id &&
        (settings.target !== "fixed" || matchesLayerIdentity(item, settings)));
      if (!layer) throw new DirectObsError("The selected source is no longer in this scene. Choose it again.");
      const locator = { sceneName, sceneItemId: id };
      if (operation === "show_hide") {
        await this.client.sendObsRequest("SetSceneItemEnabled", { ...locator, sceneItemEnabled: !layer.enabled });
      } else if (operation === "move_up" || operation === "move_down") {
        const index = Math.max(0, Math.min(scene.layers.length - 1,
          layer.sceneItemIndex + (operation === "move_up" ? 1 : -1) * Math.max(1, Math.abs(Math.trunc(steps)))));
        if (index !== layer.sceneItemIndex) {
          await this.client.sendObsRequest("SetSceneItemIndex", { ...locator, sceneItemIndex: index });
        }
      } else {
        const current = Math.max(0, BLEND_MODES.findIndex((mode) => mode.id === layer.blendMode));
        const offset = (operation === "blend_previous" ? -1 : 1) * Math.max(1, Math.abs(Math.trunc(steps)));
        const mode = operation === "blend_normal" ? BLEND_MODES[0] :
          BLEND_MODES[((current + offset) % BLEND_MODES.length + BLEND_MODES.length) % BLEND_MODES.length];
        await this.client.sendObsRequest("SetSceneItemBlendMode", { ...locator, sceneItemBlendMode: mode.id });
      }
      await this.refreshScene(sceneName);
    });
  }

  private async refreshScene(sceneName: string): Promise<LayerSceneState> {
    const pending = this.refreshing.get(sceneName);
    if (pending) return pending;
    const generation = this.generation;
    const request = (async () => {
      try {
        const data = await this.client.sendObsRequest("GetSceneItemList", { sceneName });
        if (generation !== this.generation) throw new DirectObsError("OBS connection or scene collection changed. Try again.");
        const raw = Array.isArray(data.sceneItems) ? data.sceneItems : [];
        const layers: ObsLayer[] = raw.filter((item) => item && typeof item === "object").map((item) => {
          const entry = item as Record<string, unknown>;
          return {
            sceneItemId: Number(entry.sceneItemId), sceneItemIndex: Number(entry.sceneItemIndex),
            sourceName: String(entry.sourceName ?? "Source"), enabled: entry.sceneItemEnabled === true,
            sourceUuid: typeof entry.sourceUuid === "string" ? entry.sourceUuid : "",
            blendMode: normalizeBlendMode(entry.sceneItemBlendMode),
            isGroup: entry.isGroup === true
          };
        }).filter((layer) => Number.isInteger(layer.sceneItemId) && Number.isInteger(layer.sceneItemIndex))
          .sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);
        const previous = this.scenes.get(sceneName);
        const selection = this.selections.get(sceneName);
        const selected = selection && layers.find((layer) => layer.sceneItemId === selection.sceneItemId &&
          (!selection.manual || matchesLayerIdentity(layer, selection)));
        const selectedId = selected?.sceneItemId ?? (selection?.manual ? -1 : layers[0]?.sceneItemId ?? -1);
        if (!selection?.manual) this.selections.set(sceneName, { sceneItemId: selectedId, manual: false });
        const scene = { sceneName, layers, selectedId, error: "" };
        if (JSON.stringify(previous) !== JSON.stringify(scene)) {
          this.scenes.set(sceneName, scene);
          this.emit("changed");
        }
        return scene;
      } catch (error) {
        if (generation !== this.generation) throw error;
        const scene = { sceneName, layers: [], selectedId: -1,
          error: error instanceof Error ? error.message : "Could not load OBS sources." };
        this.scenes.set(sceneName, scene);
        this.emit("changed");
        throw error;
      }
    })();
    this.refreshing.set(sceneName, request);
    try { return await request; } finally {
      if (this.refreshing.get(sceneName) === request) this.refreshing.delete(sceneName);
    }
  }

  private async refreshWatched(): Promise<void> {
    if (!this.client.isConnected() || this.collectionChanging) return;
    await Promise.all([...this.watched.keys()].map((key) =>
      this.refresh(JSON.parse(key) as LayerSettings).catch(() => {})));
  }

  private async enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const request = previous.catch(() => {}).then(run);
    this.queues.set(key, request);
    try { return await request; } finally { if (this.queues.get(key) === request) this.queues.delete(key); }
  }
}
