// SPDX-License-Identifier: GPL-2.0-or-later
import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "node:net";
import {
  computeObsWebSocketAuth,
  FADESTER_VENDOR_NAME
} from "../../src/obs/fadester-client.js";
import {
  FadesterSlot,
  GetStateResponse,
  CatalogSourceFiltersResponse
} from "../../src/types/contract.js";
import { isResetFxEligible } from "../../packages/streamdeck-fadester-shared/src/fx-policy.js";

export interface FakeObsServerOptions {
  password?: string;
  obsVersion?: string;
  fadesterVersion?: string;
  buildCommit?: string;
  apiVersion?: number;
  profile?: string;
  missingPlugin?: boolean;
  studioMode?: boolean;
  screenshotDelayMs?: number;
  /** `GetVersion.availableRequests`; every request the fake handles when omitted. */
  availableRequests?: string[];
  /** Delays applied to `TriggerMediaInputAction` and `GetMediaInputStatus` for in-flight tests. */
  mediaActionDelayMs?: number;
  mediaStatusDelayMs?: number;
}

/** An OBS input as `GetInputList` reports it (obs-websocket 5.6.3). */
export interface FakeObsInput {
  inputName: string;
  inputUuid: string;
  inputKind: string;
  unversionedInputKind: string;
}

export const FAKE_OBS_WEBSOCKET_VERSION = "5.6.3";
export const PLAYLISTER_KIND = "obs_playlister_source";

/** The eight `OBS_MEDIA_STATE_*` values and the seven `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_*` values (protocol.md 5.6.3). */
export const FAKE_MEDIA_STATES = [
  "OBS_MEDIA_STATE_NONE", "OBS_MEDIA_STATE_PLAYING", "OBS_MEDIA_STATE_OPENING", "OBS_MEDIA_STATE_BUFFERING",
  "OBS_MEDIA_STATE_PAUSED", "OBS_MEDIA_STATE_STOPPED", "OBS_MEDIA_STATE_ENDED", "OBS_MEDIA_STATE_ERROR"
] as const;
export type FakeMediaState = (typeof FAKE_MEDIA_STATES)[number];
export const FAKE_MEDIA_ACTIONS = [
  "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NONE", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
  "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP",
  "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART", "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
  "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS"
] as const;

/**
 * A Playlister's playback model, as `playlister-source.c` behaves: `items`
 * rows, `index` the current one, `loop` (native default true) and `shuffle`
 * with the unplayed items left in this round and the history behind.
 */
export interface FakeMediaInput {
  state: FakeMediaState;
  durationMs: number;
  cursorMs: number;
  items: number;
  index: number;
  loop: boolean;
  shuffle: boolean;
  shuffleRemaining: number;
  shuffleHistory: number;
}

/** Every request type `handleObsRequest` answers; `GetVersion.availableRequests` by default. */
const FAKE_REQUEST_TYPES = [
  "GetVersion", "GetStudioModeEnabled", "SetStudioModeEnabled", "GetSceneList", "GetInputList",
  "GetSceneTransitionList", "GetCurrentSceneTransition", "GetSceneSceneTransitionOverride",
  "SetSceneSceneTransitionOverride", "GetCurrentProgramScene", "GetCurrentPreviewScene", "GetInputVolume",
  "SetInputVolume", "SetTBarPosition", "SetCurrentPreviewScene", "SetCurrentProgramScene",
  "SetCurrentSceneTransition", "TriggerStudioModeTransition", "GetSourceScreenshot", "CallVendorRequest",
  "GetMediaInputStatus", "TriggerMediaInputAction"
];

interface FakeProfileMeta {
  slug: string;
  displayName: string;
  tier: "verified" | "beta" | "custom";
  hasCrossfader: boolean;
  hasMaster: boolean;
}

const FAKE_PROFILES: Record<string, FakeProfileMeta> = {
  apc40mk2: {
    slug: "apc40mk2",
    displayName: "Akai APC40 mkII",
    tier: "verified",
    hasCrossfader: true,
    hasMaster: true
  },
  apcminimk2: {
    slug: "apcminimk2",
    displayName: "Akai APC mini mk2",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: true
  },
  midimix: {
    slug: "midimix",
    displayName: "Akai MIDImix",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: true
  },
  nanokontrol2: {
    slug: "nanokontrol2",
    displayName: "Korg nanoKONTROL2",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: false
  },
  launchcontrolxl: {
    slug: "launchcontrolxl",
    displayName: "Novation Launch Control XL",
    tier: "beta",
    hasCrossfader: false,
    hasMaster: false
  },
  generic: {
    slug: "generic",
    displayName: "Generic MIDI (Custom)",
    tier: "custom",
    hasCrossfader: true,
    hasMaster: true
  }
};

const LEGACY_VALID_SLOTS =
  "crossfader, fader_1 .. fader_8, master";
const CURRENT_VALID_SLOTS = `${LEGACY_VALID_SLOTS}, fx_1 .. fx_8`;

function formatDisplayValue(slot: Pick<FadesterSlot, "id" | "value">): string {
  const value = Math.max(0, Math.min(1, slot.value));
  switch (slot.id) {
    case "fx_1":
      return `${(value * 32).toFixed(1)} px`;
    case "fx_2":
      return `${Math.round(-100 + value * 200)}%`;
    case "fx_3":
      return `${(-60 + value * 60).toFixed(1)} dB`;
    case "fx_4":
      return value === 0 ? "0 (Off)" : `${Math.round(value * 100)}%`;
    default:
      return `${Math.round(value * 100)}%`;
  }
}

function withDisplayValue(slot: FadesterSlot): FadesterSlot {
  return {
    ...slot,
    display_value: formatDisplayValue(slot)
  };
}

function supportsFxApi(version: string): boolean {
  const [majorText = "0", minorText = "0"] = version.split(/[.-]/, 3);
  const major = Number(majorText);
  const minor = Number(minorText);
  return Number.isFinite(major) && Number.isFinite(minor) &&
    (major > 0 || (major === 0 && minor >= 4));
}

export function createDefaultSlots(
  studioMode = true,
  includeFx = true
): FadesterSlot[] {
  const baseSlots: FadesterSlot[] = [
    {
      id: "crossfader",
      name: "Crossfader",
      kind: "crossfader",
      enabled: true,
      target_mode: "tbar",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "Studio Mode T-bar",
      available: studioMode,
      reason: studioMode ? "" : "Studio Mode is off"
    },
    {
      id: "fader_1",
      name: "Fader 1",
      kind: "fader",
      enabled: true,
      target_mode: "crossfade_ab",
      source_a: "Cam 1",
      source_b: "Loop 3",
      curve: "dip_free",
      afv: false,
      value: 0.42,
      takeover_pending: "none",
      label: "Cam 1 -> Loop 3",
      available: true,
      reason: ""
    },
    {
      id: "fader_2",
      name: "Fader 2",
      kind: "fader",
      enabled: true,
      target_mode: "layer_opacity",
      source_a: "Logo Overlay",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.75,
      takeover_pending: "none",
      label: "Logo Overlay",
      available: true,
      reason: ""
    },
    {
      id: "fader_3",
      name: "Fader 3",
      kind: "fader",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "dip_free",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    },
    ...Array.from({ length: 5 }, (_, index): FadesterSlot => ({
      id: `fader_${index + 4}`,
      name: `Fader ${index + 4}`,
      kind: "fader",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    })),
    {
      id: "master",
      name: "Master",
      kind: "master",
      enabled: true,
      target_mode: "audio_volume",
      source_a: "Desktop Audio",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 1.0,
      takeover_pending: "none",
      label: "Desktop Audio",
      available: true,
      reason: ""
    }
  ];

  const fxSlots: FadesterSlot[] = [
    {
      id: "fx_1",
      name: "FX 1",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Cam 1",
      source_b: "",
      filter_name: "Blur",
      filter_prop: "radius",
      from_val: 0,
      to_val: 32,
      bypass_at_zero: true,
      curve: "linear",
      afv: false,
      value: 0.44,
      takeover_pending: "none",
      label: "Cam 1 • Blur • Radius",
      available: true,
      reason: ""
    },
    {
      id: "fx_2",
      name: "FX 2",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Logo Overlay",
      source_b: "",
      filter_name: "Color Correction",
      filter_prop: "saturation",
      from_val: -100,
      to_val: 100,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.3,
      takeover_pending: "none",
      label: "Logo Overlay • Color Correction • Saturation",
      available: true,
      reason: ""
    },
    {
      id: "fx_3",
      name: "FX 3",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Mic/Aux",
      source_b: "",
      filter_name: "Compressor",
      filter_prop: "threshold",
      from_val: -60,
      to_val: 0,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.9,
      takeover_pending: "none",
      label: "Mic/Aux • Compressor • Threshold",
      available: true,
      reason: ""
    },
    {
      id: "fx_4",
      name: "FX 4",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Cam 1",
      source_b: "",
      filter_name: "Crop/Pad",
      filter_prop: "left",
      from_val: 0,
      to_val: 960,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "Cam 1 • Crop/Pad • Left",
      available: true,
      reason: ""
    },
    {
      id: "fx_5",
      name: "FX 5",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Loop 3",
      source_b: "",
      filter_name: "Sharpen",
      filter_prop: "sharpness",
      from_val: 0,
      to_val: 1,
      bypass_at_zero: true,
      curve: "linear",
      afv: false,
      value: 0.55,
      takeover_pending: "none",
      label: "Loop 3 • Sharpen • Sharpness",
      available: true,
      reason: ""
    },
    {
      id: "fx_6",
      name: "FX 6",
      kind: "fx",
      enabled: true,
      target_mode: "filter_param",
      source_a: "Desktop Audio",
      source_b: "",
      filter_name: "Limiter",
      filter_prop: "threshold",
      from_val: -30,
      to_val: 0,
      bypass_at_zero: false,
      curve: "linear",
      afv: false,
      value: 0.7,
      takeover_pending: "none",
      label: "Desktop Audio • Limiter • Threshold",
      available: true,
      reason: ""
    },
    {
      id: "fx_7",
      name: "FX 7",
      kind: "fx",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    },
    {
      id: "fx_8",
      name: "FX 8",
      kind: "fx",
      enabled: true,
      target_mode: "unassigned",
      source_a: "",
      source_b: "",
      curve: "linear",
      afv: false,
      value: 0.0,
      takeover_pending: "none",
      label: "",
      available: true,
      reason: ""
    }
  ];

  return [...baseSlots, ...(includeFx ? fxSlots : [])].map(withDisplayValue);
}

export class FakeObsServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly salt = "fadester_salt_1234";
  private readonly challenge = "fadester_challenge_5678";

  public password: string;
  public obsVersion: string;
  public fadesterVersion: string;
  public buildCommit: string;
  public apiVersion: number;
  public profile: string;
  public missingPlugin: boolean;
  public studioMode: boolean;
  public screenshotDelayMs: number;
  public availableRequests: string[] | undefined;
  public mediaActionDelayMs: number;
  public mediaStatusDelayMs: number;
  /** Fails the next `TriggerMediaInputAction` with this OBS comment, then clears itself. */
  public mediaFailNext = "";
  public previewSceneName = "Scene Preview";
  public programSceneName = "Scene Live";
  public sceneNames = ["Scene Live", "Scene Preview", "Scene 3"];
  /** The audio inputs by name (tests assign this list); `GetInputList` adds their UUID and kind. */
  public inputNames = ["Desktop Audio", "Mic/Aux"];
  /** Inputs of other kinds (Playlister sources among them), added with `addInput`. */
  public readonly extraInputs: FakeObsInput[] = [];
  /** The media model of every media-kind input, by UUID. */
  public readonly mediaInputs = new Map<string, FakeMediaInput>();
  private readonly audioInputUuids = new Map<string, string>();
  private nextInputUuid = 1;
  public transitionNames = ["Cut", "Fade", "Fade to Black"];
  public currentTransitionName = "Fade";
  public readonly sceneTransitionOverrides = new Map<string, {
    transitionName: string | null;
    transitionDuration: number | null;
  }>();
  public lastSceneTransition = "";
  public failNextProgramSwitch = false;
  public readonly inputVolumes = new Map<string, number>([
    ["Desktop Audio", 0.8],
    ["Mic/Aux", 0.6]
  ]);
  public directTbarPosition = 0;
  public slots: FadesterSlot[];
  public validSources = new Set<string>([
    "Cam 1",
    "Loop 3",
    "Logo Overlay",
    "Desktop Audio",
    "Mic/Aux"
  ]);

  public vendorCallLog: Array<{
    requestType: string;
    requestData?: Record<string, unknown>;
  }> = [];
  public directCallLog: Array<{
    requestType: string;
    requestData?: Record<string, unknown>;
  }> = [];
  /**
   * Every `GetMediaInputStatus` answered for a known input, kept apart from `directCallLog` (tests compare
   * that log whole); the payloads as received, refused ones included, are in `mediaStatusRequests`.
   */
  public mediaStatusLog: Array<{ inputUuid: string; mediaState: string }> = [];
  /** The `requestData` of every `GetMediaInputStatus` as received, reads by name and of unknown inputs included. */
  public mediaStatusRequests: Array<Record<string, unknown>> = [];
  /** Every `TriggerMediaInputAction` received, the ones `mediaFailNext` refused included. */
  public mediaActionAttempts = 0;
  public screenshotCallCount = 0;
  public activeScreenshotRequests = 0;
  public maxConcurrentScreenshots = 0;
  public connectionCount = 0;
  public tbarCompletionCount = 0;
  public tbarAbortCount = 0;
  public faderChangedCount = 0;
  public readonly pendingCleanSlots = new Set<string>();
  public readonly outputWriteCounts = new Map<string, number>();
  private readonly reversedTbarDials = new Set<string>();

  public constructor(opts?: FakeObsServerOptions) {
    this.password = opts?.password ?? "";
    this.obsVersion = opts?.obsVersion ?? "33.0.0";
    this.fadesterVersion = opts?.fadesterVersion ?? "0.4.0";
    this.buildCommit = opts?.buildCommit ?? "";
    this.apiVersion = opts?.apiVersion ?? 1;
    this.profile = opts?.profile ?? "apc40mk2";
    this.missingPlugin = opts?.missingPlugin ?? false;
    this.studioMode = opts?.studioMode ?? true;
    this.screenshotDelayMs = opts?.screenshotDelayMs ?? 5;
    this.availableRequests = opts?.availableRequests;
    this.mediaActionDelayMs = opts?.mediaActionDelayMs ?? 0;
    this.mediaStatusDelayMs = opts?.mediaStatusDelayMs ?? 0;
    this.slots = createDefaultSlots(
      this.studioMode,
      supportsFxApi(this.fadesterVersion)
    );
    this.applyProfileTopology(this.profile);
  }

  public async start(port = 0): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = new WebSocketServer({ host: "127.0.0.1", port });
      this.wss = server;

      server.on("connection", (ws: WebSocket) => {
        this.connectionCount++;
        this.clients.add(ws);
        ws.on("close", () => {
          this.clients.delete(ws);
        });
        ws.on("message", (raw: WebSocket.RawData) => {
          this.handleClientMessage(ws, raw.toString("utf8"));
        });

        const helloData: Record<string, unknown> = {
          obsWebSocketVersion: FAKE_OBS_WEBSOCKET_VERSION,
          rpcVersion: 1
        };
        if (this.password) {
          helloData.authentication = {
            challenge: this.challenge,
            salt: this.salt
          };
        }
        ws.send(JSON.stringify({ op: 0, d: helloData }));
      });

      server.once("listening", () => {
        const addr = server.address() as AddressInfo;
        resolve(addr.port);
      });
      server.once("error", reject);
    });
  }

  public async stop(): Promise<void> {
    for (const c of this.clients) {
      try {
        c.terminate();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
    if (!this.wss) {
      return;
    }
    const server = this.wss;
    this.wss = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /** Every input as `GetInputList` lists it: the audio inputs (stable UUIDs by name) and the extra ones. */
  public inputList(): FakeObsInput[] {
    const audio = this.inputNames.map((inputName): FakeObsInput => {
      let inputUuid = this.audioInputUuids.get(inputName);
      if (!inputUuid) {
        inputUuid = this.newInputUuid();
        this.audioInputUuids.set(inputName, inputUuid);
      }
      const inputKind = /mic|aux/i.test(inputName) ? "wasapi_input_capture" : "wasapi_output_capture";
      return { inputName, inputUuid, inputKind, unversionedInputKind: inputKind };
    });
    return [...audio, ...this.extraInputs.map((input) => ({ ...input }))];
  }

  public findInput(inputUuid: string): FakeObsInput | undefined {
    return this.inputList().find((input) => input.inputUuid === inputUuid);
  }

  private newInputUuid(): string {
    const n = String(this.nextInputUuid++).padStart(12, "0");
    return `0f0f0f0f-0000-4000-8000-${n}`;
  }

  /**
   * Adds an input of any kind and emits `InputCreated`. A Playlister
   * gets a media model, STOPPED with three items (NONE with none).
   */
  public addInput(input: { inputName: string; inputKind: string; inputUuid?: string; unversionedInputKind?: string },
    media?: Partial<FakeMediaInput>): FakeObsInput {
    const created: FakeObsInput = {
      inputName: input.inputName,
      inputUuid: input.inputUuid ?? this.newInputUuid(),
      inputKind: input.inputKind,
      unversionedInputKind: input.unversionedInputKind ?? input.inputKind.replace(/_v\d+$/, "")
    };
    this.extraInputs.push(created);
    if (created.unversionedInputKind === PLAYLISTER_KIND) {
      const items = media?.items ?? 3;
      this.mediaInputs.set(created.inputUuid, {
        state: items > 0 ? "OBS_MEDIA_STATE_STOPPED" : "OBS_MEDIA_STATE_NONE",
        durationMs: 0, cursorMs: 0, items, index: 0, loop: true, shuffle: false,
        shuffleRemaining: Math.max(0, items - 1), shuffleHistory: 0,
        ...media
      });
    }
    this.emitObsEvent("InputCreated", {
      ...created, inputSettings: {}, defaultInputSettings: {}
    });
    return { ...created };
  }

  /** A Playlister source (`obs_playlister_source`) with the given media model. */
  public addPlaylister(inputName: string, media?: Partial<FakeMediaInput>): FakeObsInput {
    return this.addInput({ inputName, inputKind: PLAYLISTER_KIND }, media);
  }

  public removeInput(inputUuid: string): void {
    const audio = [...this.audioInputUuids].find(([, uuid]) => uuid === inputUuid);
    let inputName = "";
    if (audio) {
      inputName = audio[0];
      this.inputNames = this.inputNames.filter((name) => name !== inputName);
      this.inputVolumes.delete(inputName);
      this.audioInputUuids.delete(inputName);
    } else {
      const index = this.extraInputs.findIndex((input) => input.inputUuid === inputUuid);
      if (index < 0) throw new Error(`No fake input '${inputUuid}'.`);
      inputName = this.extraInputs[index]!.inputName;
      this.extraInputs.splice(index, 1);
      this.mediaInputs.delete(inputUuid);
    }
    this.emitObsEvent("InputRemoved", { inputName, inputUuid });
  }

  public renameInput(inputUuid: string, inputName: string): void {
    const audio = [...this.audioInputUuids].find(([, uuid]) => uuid === inputUuid);
    let oldInputName = "";
    if (audio) {
      oldInputName = audio[0];
      this.inputNames = this.inputNames.map((name) => name === oldInputName ? inputName : name);
      this.audioInputUuids.delete(oldInputName);
      this.audioInputUuids.set(inputName, inputUuid);
      const volume = this.inputVolumes.get(oldInputName);
      this.inputVolumes.delete(oldInputName);
      if (volume !== undefined) this.inputVolumes.set(inputName, volume);
    } else {
      const input = this.extraInputs.find((candidate) => candidate.inputUuid === inputUuid);
      if (!input) throw new Error(`No fake input '${inputUuid}'.`);
      oldInputName = input.inputName;
      input.inputName = inputName;
    }
    this.emitObsEvent("InputNameChanged", { inputUuid, oldInputName, inputName });
  }

  /**
   * Applies a media action as the native source does (playlister-source.c):
   * PLAY resumes or reloads (nothing to load keeps the state); PAUSE acts only
   * while PLAYING; STOP stops; RESTART and a NEXT or PREVIOUS that loads an
   * item end in PLAYING; NEXT at the end with loop off, at the shuffle boundary,
   * and PREVIOUS at the start of the shuffle history keep the state.
   */
  private applyMediaAction(media: FakeMediaInput, action: string): void {
    const empty = media.items <= 0;
    const load = (index: number): void => {
      media.index = index;
      media.cursorMs = 0;
      media.state = "OBS_MEDIA_STATE_PLAYING";
    };
    switch (action) {
      case "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY":
        if (media.state === "OBS_MEDIA_STATE_PLAYING" || media.state === "OBS_MEDIA_STATE_PAUSED") {
          media.state = "OBS_MEDIA_STATE_PLAYING";
        } else if (!empty) {
          load(media.index);
        }
        return;
      case "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE":
        if (media.state === "OBS_MEDIA_STATE_PLAYING") media.state = "OBS_MEDIA_STATE_PAUSED";
        return;
      case "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP":
        if (!empty) media.state = "OBS_MEDIA_STATE_STOPPED";
        return;
      case "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART":
        // The current item, as restart_behavior "current file"; "first file" (index 0) is not modelled.
        if (!empty) load(media.index);
        return;
      case "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT":
        if (empty) return;
        if (media.shuffle) {
          if (media.shuffleRemaining <= 0) {
            // A new round (shuffler.c reshuffles and starts at 0): every item is unplayed again.
            if (!media.loop) return;
            media.shuffleRemaining = media.items;
          }
          media.shuffleRemaining--;
          media.shuffleHistory++;
          load((media.index + 1) % media.items);
        } else if (media.index < media.items - 1) {
          load(media.index + 1);
        } else if (media.loop) {
          load(0);
        }
        return;
      case "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS":
        if (empty) return;
        if (media.shuffle) {
          if (media.shuffleHistory <= 0) return;
          media.shuffleHistory--;
          // shuffler_prev steps back, so the item it leaves is unplayed again.
          media.shuffleRemaining++;
          load((media.index + media.items - 1) % media.items);
        } else if (media.index > 0) {
          load(media.index - 1);
        } else if (media.loop) {
          load(media.items - 1);
        }
        return;
      default:
        return;
    }
  }

  public applyProfileTopology(profileSlug: string): void {
    const meta = FAKE_PROFILES[profileSlug] ?? FAKE_PROFILES.apc40mk2;
    this.profile = meta.slug;

    const cross = this.slots.find((s) => s.id === "crossfader");
    if (cross) {
      if (!meta.hasCrossfader) {
        cross.enabled = false;
        cross.target_mode = "unassigned";
        cross.label = "Disabled";
        cross.available = false;
        cross.reason = "Not used. Click to set up.";
        cross.value = 0.0;
      } else if (meta.slug === "apc40mk2") {
        cross.enabled = true;
        cross.target_mode = "tbar";
        cross.label = "Studio Mode T-bar";
        cross.available = this.studioMode;
        cross.reason = this.studioMode ? "" : "Studio Mode is off";
      } else {
        cross.enabled = false;
        cross.target_mode = "unassigned";
        cross.label = "Unassigned";
        cross.available = false;
        cross.reason = "Not used. Click to set up.";
      }
    }

    const master = this.slots.find((s) => s.id === "master");
    if (master) {
      if (!meta.hasMaster) {
        master.enabled = false;
        master.target_mode = "unassigned";
        master.source_a = "";
        master.label = "Disabled";
        master.available = false;
        master.reason = "Not used. Click to set up.";
        master.value = 0.0;
      } else if (meta.slug === "generic") {
        master.enabled = false;
        master.target_mode = "unassigned";
        master.source_a = "";
        master.label = "Unassigned";
        master.available = false;
        master.reason = "Not used. Click to set up.";
      } else if (master.target_mode === "unassigned") {
        master.enabled = true;
        master.target_mode = "audio_volume";
        master.source_a = "Desktop Audio";
        master.label = "Desktop Audio";
        master.available = true;
        master.reason = "";
        master.value = 1.0;
      }
    }

    for (const slot of this.slots) {
      slot.display_value = formatDisplayValue(slot);
    }
  }

  private loadProfileDefaults(meta: FakeProfileMeta): void {
    this.profile = meta.slug;
    this.pendingCleanSlots.clear();
    this.reversedTbarDials.clear();
    // The initial fixture is a configured demo desk. Loading a profile replaces
    // every assignment, as mfd_engine_load_profile_defaults does in real OBS.
    this.slots = this.slots.map((slot): FadesterSlot => {
      const enabled = slot.kind === "fx" || meta.slug === "generic" ||
        (slot.id === "crossfader" ? meta.hasCrossfader :
          slot.id === "master" ? meta.hasMaster : true);
      const isTbar = meta.slug === "apc40mk2" && slot.id === "crossfader";
      return withDisplayValue({
        id: slot.id,
        name: slot.name,
        kind: slot.kind,
        enabled,
        target_mode: isTbar ? "tbar" : "unassigned",
        source_a: "",
        source_b: "",
        scene: "",
        curve: slot.kind === "fx" ? "linear" : "dip_free",
        afv: false,
        value: 0,
        takeover_pending: "none",
        parked: false,
        label: !enabled ? "Disabled" : isTbar ? "Studio Mode T-Bar" : "Unassigned",
        available: isTbar && this.studioMode,
        reason: isTbar ? (this.studioMode ? "" : "Studio Mode is off.") :
          "Not used. Click to set up."
      });
    });
  }

  public setSlotAvailability(slotId: string, available: boolean, reason = ""): void {
    const slot = this.slots.find((candidate) => candidate.id === slotId);
    if (!slot) throw new Error(`Slot '${slotId}' does not exist.`);
    slot.available = available;
    slot.reason = reason;
    if (available && this.pendingCleanSlots.delete(slotId) && isResetFxEligible(slot)) {
      slot.value = 0;
      this.recordOutputWrite(slot);
      this.emitFaderChanged(slot.id);
    }
    this.emitVendorEvent("state_changed", this.getStatePayload() as unknown as Record<string, unknown>);
  }

  private recordOutputWrite(slot: FadesterSlot): void {
    this.outputWriteCounts.set(slot.id, (this.outputWriteCounts.get(slot.id) ?? 0) + 1);
  }

  private isSlotWritable(slot: FadesterSlot): boolean {
    // The provider retains values on enabled unassigned slots without driving OBS.
    return slot.enabled !== false && (slot.target_mode === "unassigned" || slot.available);
  }

  private applyValue(slot: FadesterSlot, value: number, release: boolean, origin = "api"): void {
    if (!this.isSlotWritable(slot)) return;
    this.pendingCleanSlots.delete(slot.id);
    const wasParked = slot.parked === true;
    if (slot.target_mode === "unassigned") {
      // Unassigned slots have neither two-rail takeover nor an output binding.
      slot.value = value;
      slot.parked = false;
      this.emitFaderChanged(slot.id, origin);
      return;
    }
    if (slot.target_mode === "tbar") {
      if (release || value === 1) {
        if (wasParked) return;
        this.tbarCompletionCount++;
        slot.value = 0; // OBS completion resets the logical throw while parking it.
        slot.parked = true;
      } else if (value === 0) {
        if (slot.value === 0 && !wasParked) return;
        if (!wasParked) this.tbarAbortCount++;
        slot.value = 0;
        slot.parked = false;
      } else {
        slot.value = value;
        slot.parked = false;
      }
    } else {
      slot.value = release ? (value >= 0.5 ? 1 : 0) : value;
      slot.parked = slot.value === 0 || slot.value === 1;
    }
    this.recordOutputWrite(slot);
    this.emitFaderChanged(slot.id, origin);
    if (wasParked !== slot.parked || slot.target_mode === "tbar" && value === 0) {
      this.emitVendorEvent("state_changed", this.getStatePayload() as unknown as Record<string, unknown>);
    }
  }

  public emitFaderChanged(slotId: string, origin = "api"): void {
    const slot = this.slots.find((candidate) => candidate.id === slotId);
    if (!slot) {
      return;
    }
    this.faderChangedCount++;
    slot.display_value = formatDisplayValue(slot);
    this.emitVendorEvent("fader_changed", {
      slot: slot.id,
      value: slot.value,
      ...(supportsFxApi(this.fadesterVersion)
        ? { display_value: slot.display_value }
        : {}),
      origin
    });
  }

  private stateSlot(slot: FadesterSlot): FadesterSlot {
    const copy = { ...slot };
    if (!supportsFxApi(this.fadesterVersion)) {
      delete copy.display_value;
    }
    return copy;
  }

  public getStatePayload(): GetStateResponse {
    const meta = FAKE_PROFILES[this.profile] ?? FAKE_PROFILES.apc40mk2;
    return {
      version: this.fadesterVersion,
      ...(this.buildCommit
        ? {
            build: {
              commit: this.buildCommit,
              built_at: "2026-10-28T07:00:00Z"
            }
          }
        : {}),
      api_version: this.apiVersion,
      studio_mode: this.studioMode,
      profile: meta.slug,
      profile_display_name: meta.displayName,
      profile_tier: meta.tier,
      device: {
        name: "APC40 mkII",
        connected: true,
        error: ""
      },
      slots: this.slots.map((slot) => this.stateSlot(slot))
    };
  }

  public emitVendorEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): void {
    const payload = JSON.stringify({
      op: 5,
      d: {
        eventType: "VendorEvent",
        eventIntent: 1 << 9,
        eventData: {
          vendorName: FADESTER_VENDOR_NAME,
          eventType,
          eventData
        }
      }
    });
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(payload);
      }
    }
  }

  public emitObsEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): void {
    const payload = JSON.stringify({
      op: 5,
      d: {
        eventType,
        eventIntent: 1 << 2,
        eventData
      }
    });
    for (const c of this.clients) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(payload);
      }
    }
  }

  private handleClientMessage(ws: WebSocket, text: string): void {
    const msg = JSON.parse(text) as { op: number; d: Record<string, unknown> };
    if (msg.op === 1) {
      if (this.password) {
        const expected = computeObsWebSocketAuth(
          this.password,
          this.salt,
          this.challenge
        );
        if (msg.d.authentication !== expected) {
          ws.close(4009, "Authentication failed.");
          return;
        }
      }
      ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      return;
    }

    if (msg.op === 6) {
      const requestId = String(msg.d.requestId ?? "");
      const requestType = String(msg.d.requestType ?? "");
      const requestData = (msg.d.requestData ?? {}) as Record<string, unknown>;
      void this.handleObsRequest(ws, requestId, requestType, requestData);
    }
  }

  private async handleObsRequest(
    ws: WebSocket,
    requestId: string,
    requestType: string,
    requestData: Record<string, unknown>
  ): Promise<void> {
    if (requestType === "GetVersion") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        obsVersion: this.obsVersion,
        obsStudioVersion: this.obsVersion,
        obsWebSocketVersion: FAKE_OBS_WEBSOCKET_VERSION,
        rpcVersion: 1,
        availableRequests: [...(this.availableRequests ?? FAKE_REQUEST_TYPES)]
      });
      return;
    }

    if (requestType === "GetMediaInputStatus" || requestType === "TriggerMediaInputAction") {
      // The payload before any lookup: OBS would also accept a read by name, the client must not send one.
      if (requestType === "GetMediaInputStatus") this.mediaStatusRequests.push({ ...requestData });
      const inputUuid = typeof requestData.inputUuid === "string" ? requestData.inputUuid : "";
      const input = inputUuid ? this.findInput(inputUuid)
        : this.inputList().find((candidate) => candidate.inputName === String(requestData.inputName ?? ""));
      if (!input) {
        this.sendResponse(ws, requestId, requestType, false, 600,
          inputUuid ? `No input was found by the UUID of \`${inputUuid}\`.`
            : `No input was found by the name of \`${String(requestData.inputName ?? "")}\`.`);
        return;
      }
      const media = this.mediaInputs.get(input.inputUuid);
      if (requestType === "GetMediaInputStatus") {
        // The state is read now and sent after the delay, so a delayed reply is a stale one.
        // A non-media kind answers NONE (obs_source_media_get_state has no callback to call); an
        // empty list is NONE whatever the model holds (mps_get_state).
        const mediaState = media && media.items > 0 ? media.state : "OBS_MEDIA_STATE_NONE";
        const showsTime = mediaState === "OBS_MEDIA_STATE_PLAYING" || mediaState === "OBS_MEDIA_STATE_PAUSED";
        const status = {
          mediaState,
          mediaDuration: showsTime && media ? media.durationMs : null,
          mediaCursor: showsTime && media ? media.cursorMs : null
        };
        this.mediaStatusLog.push({ inputUuid: input.inputUuid, mediaState });
        if (this.mediaStatusDelayMs > 0) await new Promise((r) => setTimeout(r, this.mediaStatusDelayMs));
        this.sendResponse(ws, requestId, requestType, true, 100, "", status);
        return;
      }
      const mediaAction = String(requestData.mediaAction ?? "");
      if (!(FAKE_MEDIA_ACTIONS as readonly string[]).includes(mediaAction)) {
        this.sendResponse(ws, requestId, requestType, false, 400, "The request field `mediaAction` has an invalid value.");
        return;
      }
      this.mediaActionAttempts++;
      if (this.mediaActionDelayMs > 0) await new Promise((r) => setTimeout(r, this.mediaActionDelayMs));
      if (this.mediaFailNext) {
        const comment = this.mediaFailNext;
        this.mediaFailNext = "";
        this.sendResponse(ws, requestId, requestType, false, 500, comment);
        return;
      }
      this.directCallLog.push({ requestType, requestData });
      if (media) this.applyMediaAction(media, mediaAction);
      this.sendResponse(ws, requestId, requestType, true, 100, "", {});
      return;
    }

    if (requestType === "GetStudioModeEnabled") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        studioModeEnabled: this.studioMode
      });
      return;
    }

    if (requestType === "SetStudioModeEnabled") {
      this.directCallLog.push({ requestType, requestData });
      this.studioMode = requestData.studioModeEnabled === true;
      this.sendResponse(ws, requestId, requestType, true, 100, "", {});
      this.emitObsEvent("StudioModeStateChanged", { studioModeEnabled: this.studioMode });
      return;
    }

    if (requestType === "GetSceneList") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        currentProgramSceneName: this.programSceneName,
        currentPreviewSceneName: this.previewSceneName,
        scenes: this.sceneNames.map((sceneName, index) => ({
          sceneName,
          sceneIndex: this.sceneNames.length - index - 1
        })).reverse()
      });
      return;
    }

    if (requestType === "GetInputList") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        inputs: this.inputList()
      });
      return;
    }

    if (requestType === "GetSceneTransitionList") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        currentSceneTransitionName: this.currentTransitionName,
        transitions: this.transitionNames.map((transitionName) => ({
          transitionName,
          transitionKind: transitionName === "Cut" ? "cut_transition" : "fade_transition"
        }))
      });
      return;
    }

    if (requestType === "GetCurrentSceneTransition") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        transitionName: this.currentTransitionName
      });
      return;
    }

    if (requestType === "GetSceneSceneTransitionOverride") {
      const sceneName = String(requestData.sceneName ?? "");
      this.sendResponse(ws, requestId, requestType, true, 100, "",
        this.sceneTransitionOverrides.get(sceneName) ?? {
          transitionName: null,
          transitionDuration: null
        });
      return;
    }

    if (requestType === "SetSceneSceneTransitionOverride") {
      const sceneName = String(requestData.sceneName ?? "");
      this.directCallLog.push({ requestType, requestData });
      this.sceneTransitionOverrides.set(sceneName, {
        transitionName: typeof requestData.transitionName === "string" ? requestData.transitionName : null,
        transitionDuration: typeof requestData.transitionDuration === "number" ? requestData.transitionDuration : null
      });
      this.sendResponse(ws, requestId, requestType, true, 100, "", {});
      return;
    }

    if (requestType === "GetCurrentProgramScene") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        currentProgramSceneName: this.programSceneName,
        sceneName: this.programSceneName
      });
      return;
    }

    if (requestType === "GetCurrentPreviewScene") {
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        currentPreviewSceneName: this.previewSceneName,
        sceneName: this.previewSceneName
      });
      return;
    }

    if (requestType === "GetInputVolume") {
      const inputName = String(requestData.inputName ?? "");
      const inputVolumeMul = this.inputVolumes.get(inputName);
      if (inputVolumeMul === undefined) {
        this.sendResponse(ws, requestId, requestType, false, 404, `Input '${inputName}' was not found.`);
      } else {
        this.sendResponse(ws, requestId, requestType, true, 100, "", { inputVolumeMul });
      }
      return;
    }

    if (requestType === "SetInputVolume") {
      const inputName = String(requestData.inputName ?? "");
      const inputVolumeMul = Number(requestData.inputVolumeMul);
      if (!this.inputVolumes.has(inputName) || !Number.isFinite(inputVolumeMul)) {
        this.sendResponse(ws, requestId, requestType, false, 400, "Choose a valid input and volume.");
      } else {
        this.directCallLog.push({ requestType, requestData });
        this.inputVolumes.set(inputName, inputVolumeMul);
        this.sendResponse(ws, requestId, requestType, true, 100, "", {});
        this.emitObsEvent("InputVolumeChanged", { inputName, inputVolumeMul });
      }
      return;
    }

    if (requestType === "SetTBarPosition") {
      if (!this.studioMode) {
        this.sendResponse(ws, requestId, requestType, false, 400, "Studio Mode is off.");
      } else {
        this.directCallLog.push({ requestType, requestData });
        this.directTbarPosition = Number(requestData.position ?? 0);
        this.sendResponse(ws, requestId, requestType, true, 100, "", {});
      }
      return;
    }

    if (requestType === "SetCurrentPreviewScene") {
      const sceneName = String(requestData.sceneName ?? "");
      if (!this.studioMode || !this.sceneNames.includes(sceneName)) {
        this.sendResponse(ws, requestId, requestType, false, 400, "Choose an existing scene with Studio Mode on.");
      } else {
        this.directCallLog.push({ requestType, requestData });
        this.previewSceneName = sceneName;
        this.sendResponse(ws, requestId, requestType, true, 100, "", {});
        this.emitObsEvent("CurrentPreviewSceneChanged", { sceneName });
      }
      return;
    }

    if (requestType === "SetCurrentProgramScene") {
      const sceneName = String(requestData.sceneName ?? "");
      if (this.failNextProgramSwitch) {
        this.failNextProgramSwitch = false;
        this.sendResponse(ws, requestId, requestType, false, 500, "Switch failed.");
      } else if (!this.sceneNames.includes(sceneName)) {
        this.sendResponse(ws, requestId, requestType, false, 400, "Choose an existing scene.");
      } else {
        this.directCallLog.push({ requestType, requestData });
        this.lastSceneTransition = this.sceneTransitionOverrides.get(sceneName)?.transitionName || this.currentTransitionName;
        const oldProgram = this.programSceneName;
        this.programSceneName = sceneName;
        this.sendResponse(ws, requestId, requestType, true, 100, "", {});
        this.emitObsEvent("CurrentProgramSceneChanged", { sceneName });
        if (this.studioMode) {
          this.previewSceneName = oldProgram;
          this.emitObsEvent("CurrentPreviewSceneChanged", { sceneName: oldProgram });
        }
      }
      return;
    }

    if (requestType === "SetCurrentSceneTransition") {
      const transitionName = String(requestData.transitionName ?? "");
      if (!this.transitionNames.includes(transitionName)) {
        this.sendResponse(ws, requestId, requestType, false, 400, "Choose an existing transition.");
      } else {
        this.directCallLog.push({ requestType, requestData });
        this.currentTransitionName = transitionName;
        this.sendResponse(ws, requestId, requestType, true, 100, "", {});
      }
      return;
    }

    if (requestType === "TriggerStudioModeTransition") {
      if (!this.studioMode) {
        this.sendResponse(ws, requestId, requestType, false, 400, "Studio Mode is off.");
      } else {
        this.directCallLog.push({ requestType, requestData });
        this.programSceneName = this.previewSceneName;
        this.sendResponse(ws, requestId, requestType, true, 100, "", {});
        this.emitObsEvent("CurrentProgramSceneChanged", { sceneName: this.programSceneName });
      }
      return;
    }

    if (requestType === "GetSourceScreenshot") {
      this.screenshotCallCount++;
      this.activeScreenshotRequests++;
      if (this.activeScreenshotRequests > this.maxConcurrentScreenshots) {
        this.maxConcurrentScreenshots = this.activeScreenshotRequests;
      }
      await new Promise((r) => setTimeout(r, this.screenshotDelayMs));
      this.activeScreenshotRequests--;
      const sourceName = String(requestData.sourceName ?? "");
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        imageData: `data:image/jpeg;base64,FAKE_THUMB_${Buffer.from(sourceName).toString("base64")}`
      });
      return;
    }

    if (requestType === "CallVendorRequest") {
      const vendorName = String(requestData.vendorName ?? "");
      const vReqType = String(requestData.requestType ?? "");
      const vReqData = (requestData.requestData ?? {}) as Record<string, unknown>;

      if (this.missingPlugin || vendorName !== FADESTER_VENDOR_NAME) {
        this.sendResponse(
          ws,
          requestId,
          requestType,
          false,
          600,
          `No vendor with name '${vendorName}' was found.`
        );
        return;
      }

      this.vendorCallLog.push({ requestType: vReqType, requestData: vReqData });
      const responseData = this.handleVendorCall(vReqType, vReqData);
      this.sendResponse(ws, requestId, requestType, true, 100, "", {
        vendorName,
        requestType: vReqType,
        responseData
      });
    }
  }

  private handleVendorCall(
    vReqType: string,
    vReqData: Record<string, unknown>
  ): Record<string, unknown> {
    if (vReqType === "get_state") {
      return this.getStatePayload() as unknown as Record<string, unknown>;
    }

    if (vReqType === "load_profile") {
      const name = String(vReqData.name ?? "").toLowerCase();
      const meta = FAKE_PROFILES[name];
      if (!meta) {
        const msg = `Unknown profile '${name}'. Valid profiles: apc40mk2, apcminimk2, midimix, nanokontrol2, launchcontrolxl, generic.`;
        return { error: msg, comment: msg };
      }
      this.loadProfileDefaults(meta);
      this.emitVendorEvent(
        "state_changed",
        this.getStatePayload() as unknown as Record<string, unknown>
      );
      return { loaded: meta.slug, profile_tier: meta.tier };
    }

    if (vReqType === "get_catalog") {
      if (!supportsFxApi(this.fadesterVersion)) {
        const msg =
          "The 'get_catalog' request requires Midi Fadester 0.4.0 or newer.";
        return { error: msg, comment: msg };
      }
      const source =
        typeof vReqData.source === "string" ? vReqData.source : "";
      if (!source) {
        return {
          scenes: [
            {
              name: "Scene Live",
              layers: [
                { name: "Cam 1", has_audio: false },
                { name: "Logo Overlay", has_audio: false }
              ]
            },
            {
              name: "Scene Preview",
              layers: [{ name: "Loop 3", has_audio: false }]
            }
          ],
          audio_sources: [
            { name: "Desktop Audio", db: -6 },
            { name: "Mic/Aux", db: -12 }
          ],
          filter_hosts: [
            { source: "Cam 1", is_scene: false, filter_count: 2 },
            { source: "Logo Overlay", is_scene: false, filter_count: 1 },
            { source: "Scene Live", is_scene: true, filter_count: 0 }
          ]
        };
      }
      if (source === "Cam 1") {
        return {
          source,
          is_scene: false,
          filters: [
            {
              name: "Blur",
              type_id: "box_filter",
              enabled: true,
              properties: [
                {
                  name: "radius",
                  label: "Radius",
                  type: "float",
                  min: 0,
                  max: 32,
                  step: 0.1,
                  suffix: "px",
                  current: 14.1
                }
              ]
            },
            {
              name: "Crop/Pad",
              type_id: "crop_filter",
              enabled: true,
              properties: [
                {
                  name: "left",
                  label: "Left",
                  type: "int",
                  min: 0,
                  max: 960,
                  step: 1,
                  suffix: "px",
                  current: 0
                }
              ]
            }
          ]
        };
      }
      if (source === "Logo Overlay") {
        return {
          source,
          is_scene: false,
          filters: [
            {
              name: "Color Correction",
              type_id: "color_filter",
              enabled: true,
              properties: [
                {
                  name: "saturation",
                  label: "Saturation",
                  type: "float",
                  min: -100,
                  max: 100,
                  step: 0.1,
                  suffix: "%",
                  current: -40
                }
              ]
            }
          ]
        };
      }
      const isScene = source === "Scene Live" || source === "Scene Preview";
      if (!isScene && !this.validSources.has(source)) {
        const msg = `Source '${source}' not found. Create the source in OBS first or check its spelling.`;
        return { error: msg, comment: msg };
      }
      return { source, is_scene: isScene, filters: [] };
    }

    if (vReqType === "reset_fx") {
      if (!supportsFxApi(this.fadesterVersion)) {
        const msg =
          "The 'reset_fx' request requires Midi Fadester 0.4.0 or newer.";
        return { error: msg, comment: msg };
      }
      const ms = vReqData.ms === undefined ? 0 : Number(vReqData.ms);
      if (!Number.isFinite(ms) || (ms !== 0 && (ms < 50 || ms > 20000))) {
        const msg = "Duration 'ms' must be 0 (instant) or between 50 and 20000 ms.";
        return { error: msg, comment: msg };
      }
      const eligible = this.slots.filter(isResetFxEligible);
      let queued = 0;
      for (const slot of eligible) {
        slot.value = 0;
        if (!slot.available) {
          this.pendingCleanSlots.add(slot.id);
          queued++;
        } else {
          this.pendingCleanSlots.delete(slot.id);
          this.recordOutputWrite(slot);
        }
        // Fake fades settle immediately; counts and unavailable intent still
        // follow the real provider's instant/timed request contract.
        this.emitFaderChanged(slot.id, "api");
      }
      this.emitVendorEvent("state_changed", this.getStatePayload() as unknown as Record<string, unknown>);
      return {
        eligible_count: eligible.length,
        reset_count: eligible.length - queued,
        queued_unavailable_count: queued,
        ms
      };
    }

    const slotId = String(vReqData.slot ?? "");
    const slot = this.slots.find((s) => s.id === slotId);
    if (!slot) {
      const validSlots = supportsFxApi(this.fadesterVersion)
        ? CURRENT_VALID_SLOTS
        : LEGACY_VALID_SLOTS;
      const msg = `Slot '${slotId}' does not exist. Valid slots: ${validSlots}.`;
      return { error: msg, comment: msg };
    }

    if (["set_fader_value", "nudge_fader", "auto_fade"].includes(vReqType) &&
        !this.isSlotWritable(slot)) {
      const msg = slot.reason || "This slot is unavailable. Configure it in Midi Fadester first.";
      return { error: msg, comment: msg };
    }

    if (vReqType === "set_fader_value") {
      const rawVal = Number(vReqData.value ?? 0);
      this.reversedTbarDials.delete(slot.id);
      this.applyValue(slot, Math.max(0, Math.min(1, rawVal)), vReqData.release === true);
      return { slot: slot.id, value: slot.value };
    }

    if (vReqType === "nudge_fader") {
      const delta = Number(vReqData.delta ?? 0);
      if (slot.target_mode === "tbar" && slot.parked && delta === 0) {
        return { slot: slot.id, value: slot.value };
      }
      if (slot.target_mode === "tbar" && slot.parked) {
        if (delta < 0) this.reversedTbarDials.add(slot.id);
        else this.reversedTbarDials.delete(slot.id);
      }
      const effectiveDelta = this.reversedTbarDials.has(slot.id) ? -delta : delta;
      this.applyValue(slot, Math.max(0, Math.min(1, Number((slot.value + effectiveDelta).toFixed(4)))), false);
      return { slot: slot.id, value: slot.value };
    }

    if (vReqType === "auto_fade") {
      const ms = Number(vReqData.ms ?? 0);
      const to = Number(vReqData.to ?? 1);
      if (!Number.isFinite(ms) || ms < 50 || ms > 20000) {
        const msg = "Duration 'ms' must be between 50 and 20000.";
        return { error: msg, comment: msg };
      }
      if (slot.target_mode === "tbar" && slot.available && slot.enabled !== false) {
        slot.parked = false;
      }
      this.applyValue(slot, Math.max(0, Math.min(1, to)), false, "auto_fade");
      return { slot: slot.id };
    }

    if (vReqType === "set_slot") {
      if ("enabled" in vReqData && typeof vReqData.enabled !== "boolean") {
        const msg = "Parameter 'enabled' must be a boolean.";
        return { error: msg, comment: msg };
      }
      if (
        typeof vReqData.source_a === "string" &&
        vReqData.source_a.length > 0 &&
        !this.validSources.has(vReqData.source_a)
      ) {
        const msg = `Source '${vReqData.source_a}' not found in OBS. Choose an existing source name.`;
        return { error: msg, comment: msg };
      }
      if (
        typeof vReqData.source_b === "string" &&
        vReqData.source_b.length > 0 &&
        !this.validSources.has(vReqData.source_b)
      ) {
        const msg = `Source '${vReqData.source_b}' not found in OBS. Choose an existing source name.`;
        return { error: msg, comment: msg };
      }
      const candidate = { ...slot, ...vReqData } as FadesterSlot;
      candidate.enabled = typeof vReqData.enabled === "boolean"
        ? vReqData.enabled : ("target_mode" in vReqData ? true : slot.enabled);
      const pureDisable = vReqData.enabled === false &&
        !["target_mode", "source_a", "filter_name", "filter_prop", "from_val", "to_val", "bypass_at_zero"]
          .some((key) => key in vReqData);
      let filterBounds: { from_val: number; to_val: number } | undefined;
      if (candidate.target_mode === "filter_param" && !pureDisable) {
        const detail = this.handleVendorCall("get_catalog", { source: candidate.source_a });
        if (detail.error) return detail;
        const filter = (detail as unknown as CatalogSourceFiltersResponse).filters
          ?.find((entry) => entry.name === candidate.filter_name);
        const property = filter?.properties.find((entry) => entry.name === candidate.filter_prop);
        if (!property) {
          const msg = `Filter setting '${candidate.filter_prop || ""}' on '${candidate.filter_name || ""}' was not found. Choose a numeric setting from the catalog.`;
          return { error: msg, comment: msg };
        }
        const sameBinding = slot.target_mode === "filter_param" && slot.source_a === candidate.source_a &&
          slot.filter_name === candidate.filter_name && slot.filter_prop === candidate.filter_prop;
        const from = "from_val" in vReqData ? Number(vReqData.from_val) : sameBinding ? slot.from_val! : property.min;
        const to = "to_val" in vReqData ? Number(vReqData.to_val) : sameBinding ? slot.to_val! : property.max;
        if (!Number.isFinite(from) || !Number.isFinite(to) || from < property.min || from > property.max || to < property.min || to > property.max) {
          const msg = "Filter range bounds must be finite and within the property's range.";
          return { error: msg, comment: msg };
        }
        if (Math.abs(to - from) < 1e-6) {
          const msg = "'from_val' and 'to_val' must differ so the control has a range to sweep.";
          return { error: msg, comment: msg };
        }
        const owner = candidate.enabled !== false && this.slots.find((other) => other.id !== slot.id &&
          other.enabled !== false && other.target_mode === "filter_param" && other.source_a === candidate.source_a &&
          other.filter_name === candidate.filter_name && other.filter_prop === candidate.filter_prop);
        if (owner) {
          const msg = `Setting '${candidate.filter_prop}' on '${candidate.filter_name}' is already controlled by ${owner.label || owner.id}.`;
          return { error: msg, comment: msg };
        }
        filterBounds = { from_val: from, to_val: to };
      }
      if (typeof vReqData.target_mode === "string") {
        slot.target_mode = vReqData.target_mode as FadesterSlot["target_mode"];
        slot.enabled = true;
      }
      if (typeof vReqData.enabled === "boolean") {
        slot.enabled = vReqData.enabled;
        if (!slot.enabled) this.pendingCleanSlots.delete(slot.id);
      }
      if (typeof vReqData.scene === "string") {
        slot.scene = vReqData.scene;
      }
      if (typeof vReqData.source_a === "string") {
        slot.source_a = vReqData.source_a;
      }
      if (typeof vReqData.source_b === "string") {
        slot.source_b = vReqData.source_b;
      }
      if (typeof vReqData.curve === "string") {
        slot.curve = vReqData.curve as FadesterSlot["curve"];
      }
      if (typeof vReqData.afv === "boolean") {
        slot.afv = vReqData.afv;
      }
      if (typeof vReqData.filter_name === "string") {
        slot.filter_name = vReqData.filter_name;
      }
      if (typeof vReqData.filter_prop === "string") {
        slot.filter_prop = vReqData.filter_prop;
      }
      if (typeof vReqData.from_val === "number") {
        slot.from_val = vReqData.from_val;
      }
      if (typeof vReqData.to_val === "number") {
        slot.to_val = vReqData.to_val;
      }
      if (filterBounds) Object.assign(slot, filterBounds);
      if (typeof vReqData.bypass_at_zero === "boolean") {
        slot.bypass_at_zero = vReqData.bypass_at_zero;
      }
      if (typeof vReqData.cal_min === "number") {
        slot.cal_min = vReqData.cal_min;
      }
      if (typeof vReqData.cal_max === "number") {
        slot.cal_max = vReqData.cal_max;
      }
      if (!slot.enabled || slot.target_mode === "unassigned") {
        slot.available = false;
        slot.label = slot.enabled ? "Unassigned" : "Disabled";
        slot.reason = "Not used. Click to set up.";
      } else {
        slot.available = slot.target_mode !== "tbar" || this.studioMode;
        slot.reason = slot.available ? "" : "Studio Mode is off.";
      }
      slot.display_value = formatDisplayValue(slot);
      this.emitVendorEvent(
        "state_changed",
        this.getStatePayload() as unknown as Record<string, unknown>
      );
      return this.stateSlot(slot) as unknown as Record<string, unknown>;
    }

    const msg = `Unknown vendor request '${vReqType}'.`;
    return { error: msg, comment: msg };
  }

  private sendResponse(
    ws: WebSocket,
    requestId: string,
    requestType: string,
    result: boolean,
    code: number,
    comment: string,
    responseData?: Record<string, unknown>
  ): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({
        op: 7,
        d: {
          requestType,
          requestId,
          requestStatus: {
            result,
            code,
            ...(comment ? { comment } : {})
          },
          ...(responseData ? { responseData } : {})
        }
      })
    );
  }
}
