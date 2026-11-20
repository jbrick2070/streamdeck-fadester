// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Visual Sidechain Tape Deck subscription and commands (P1-6):
 * - Reads initial deck state via `visual-sidechain` `get_decks` on connect/reconnect
 *   and subscribes to `decks_changed` vendor events (no polling loops).
 * - Sends `deck_command` (`play_pause`, `cue_to_start`, `normal_speed`, `speed_step`,
 *   `speed_set`) over the shared multi-vendor client.
 * - Reports plain states `not_loaded` (Visual Sidechain absent: OBS's 600 "No vendor was
 *   found" on `get_decks`) and `no_deck` (none found or selected Browser Source missing),
 *   and flags older Visual Sidechain builds that lack `get_decks` or `deck_command` (OBS's
 *   600 "No request was found", or 604 from test servers -> `"Update Midi Fadester"`).
 */
import { EventEmitter } from "node:events";
import { DirectObsClient, DirectObsError } from "../obs/direct-obs-client.js";
import { VS_VENDOR_NAME } from "./visual-safety.js";
import { TapeDeckOperation } from "../types/settings.js";
import {
  OBS_VENDOR_NOT_FOUND,
  OBS_VENDOR_REQUEST_MISSING,
  isObsVendorMissingError,
  isObsVendorRequestMissingError
} from "../../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";
import { ownText } from "../../packages/streamdeck-fadester-shared/src/i18n.js";

export const TAPE_DECK_MIN_PCT = 25;
export const TAPE_DECK_MAX_PCT = 800;
export const TAPE_DECK_NORMAL_PCT = 100;
export const TAPE_DECK_LADDER: readonly number[] = [
  25, 50, 75, 100, 125, 150, 200, 300, 400, 600, 800
];

export type TapeDeckAvailability = "unknown" | "loaded" | "not_loaded";
export type TapeDeckPlainState = "disconnected" | "not_loaded" | "no_deck" | "active";
export type TapeDeckTransportState = "playing" | "paused" | "ended";

export interface TapeDeckSpeedFaderInfo {
  readonly slot: number;
  readonly slotId: string;
  readonly minPercent: number;
  readonly maxPercent: number;
  readonly live: boolean;
}

export interface TapeDeckReportedInfo {
  readonly currentTape: boolean;
  readonly rate: number;
  readonly position: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  readonly error: number;
  readonly noPicture: boolean;
}

export interface TapeDeckEntry {
  readonly source: string;
  readonly filter: string;
  readonly deckId: string;
  readonly role: string;
  readonly state: string;
  readonly tape: string;
  readonly speedPercent: number;
  readonly effectiveSpeedPercent: number;
  readonly speedFader: TapeDeckSpeedFaderInfo;
  readonly tapePitch: boolean;
  readonly playing: boolean;
  readonly loop: boolean;
  readonly startSeconds: number;
  readonly linked: boolean;
  readonly reported?: TapeDeckReportedInfo;
}

export interface SampledTapeDeck {
  readonly state: TapeDeckPlainState;
  readonly connected: boolean;
  readonly availability: TapeDeckAvailability;
  readonly deckCommandUnsupported: boolean;
  readonly deck: TapeDeckEntry | null;
  readonly transport: TapeDeckTransportState;
  readonly speedPercent: number;
  readonly speedLabel: string;
  readonly decks: readonly TapeDeckEntry[];
}

export interface DeckCommandReply {
  success?: boolean;
  version?: string;
  api_version?: number;
  deck?: string;
  source?: string;
  filter?: string;
  op?: string;
  playing?: boolean;
  speed_percent?: number;
  effective_speed_percent?: number;
  speed_fader_live?: boolean;
  coalesced?: boolean;
}

interface GetDecksReply {
  success?: boolean;
  version?: string;
  api_version?: number;
  decks?: unknown[];
}

/** Formats a Tape Deck speed in both units, e.g. `"150% (1.5x)"` or `"100% (1x)"`. */
export function formatTapeDeckSpeed(percent: number): string {
  const clamped = Number.isFinite(percent)
    ? Math.max(TAPE_DECK_MIN_PCT, Math.min(TAPE_DECK_MAX_PCT, Math.round(percent)))
    : TAPE_DECK_NORMAL_PCT;
  const rate = Number((clamped / 100).toFixed(2));
  return `${clamped}% (${rate}x)`;
}

function clampSpeedPct(raw: unknown, fallback = TAPE_DECK_NORMAL_PCT): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.max(TAPE_DECK_MIN_PCT, Math.min(TAPE_DECK_MAX_PCT, Math.round(raw)))
    : fallback;
}

function normalizeDeckEntry(raw: unknown): TapeDeckEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const source = typeof rec.source === "string" ? rec.source : "";
  const filter = typeof rec.filter === "string" ? rec.filter : "";
  const deckId = typeof rec.deck_id === "string" ? rec.deck_id : "";
  if (!source && !deckId) return null;

  const sfRaw =
    rec.speed_fader && typeof rec.speed_fader === "object"
      ? (rec.speed_fader as Record<string, unknown>)
      : {};
  const speedPercent = clampSpeedPct(rec.speed_percent, TAPE_DECK_NORMAL_PCT);
  const effectiveSpeedPercent = clampSpeedPct(rec.effective_speed_percent, speedPercent);

  let reported: TapeDeckReportedInfo | undefined;
  if (rec.reported && typeof rec.reported === "object") {
    const rep = rec.reported as Record<string, unknown>;
    reported = {
      currentTape: Boolean(rep.current_tape),
      rate: typeof rep.rate === "number" && Number.isFinite(rep.rate) ? rep.rate : 1,
      position: typeof rep.position === "number" && Number.isFinite(rep.position) ? rep.position : 0,
      duration: typeof rep.duration === "number" && Number.isFinite(rep.duration) ? rep.duration : 0,
      paused: Boolean(rep.paused),
      ended: Boolean(rep.ended),
      readyState: typeof rep.ready_state === "number" && Number.isFinite(rep.ready_state) ? Math.trunc(rep.ready_state) : 0,
      error: typeof rep.error === "number" && Number.isFinite(rep.error) ? Math.trunc(rep.error) : 0,
      noPicture: Boolean(rep.no_picture)
    };
  }

  return {
    source,
    filter,
    deckId,
    role: typeof rec.role === "string" ? rec.role : "owner",
    state: typeof rec.state === "string" ? rec.state : "",
    tape: typeof rec.tape === "string" ? rec.tape : "",
    speedPercent,
    effectiveSpeedPercent,
    speedFader: {
      slot: typeof sfRaw.slot === "number" && Number.isFinite(sfRaw.slot) ? Math.trunc(sfRaw.slot) : -1,
      slotId: typeof sfRaw.slot_id === "string" ? sfRaw.slot_id : "",
      minPercent: clampSpeedPct(sfRaw.min_percent, 50),
      maxPercent: clampSpeedPct(sfRaw.max_percent, 200),
      live: Boolean(sfRaw.live)
    },
    tapePitch: Boolean(rec.tape_pitch),
    playing: Boolean(rec.playing),
    loop: Boolean(rec.loop),
    startSeconds: typeof rec.start_seconds === "number" && Number.isFinite(rec.start_seconds) ? rec.start_seconds : 0,
    linked: Boolean(rec.linked),
    ...(reported ? { reported } : {})
  };
}

function normalizeDecksList(raw: unknown): TapeDeckEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TapeDeckEntry[] = [];
  for (const item of raw) {
    const entry = normalizeDeckEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

export function transportForDeck(deck: TapeDeckEntry): TapeDeckTransportState {
  if (deck.state === "ended" || (deck.linked && deck.reported?.currentTape && deck.reported.ended)) {
    return "ended";
  }
  if (deck.linked && deck.reported?.currentTape) {
    return deck.reported.paused ? "paused" : "playing";
  }
  return deck.playing ? "playing" : "paused";
}

function errorCodeOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

export class TapeDecks extends EventEmitter {
  private availability: TapeDeckAvailability = "unknown";
  private version = "";
  private decks: TapeDeckEntry[] = [];
  private deckCommandUnsupported = false;
  private connectionGen = 0;

  public constructor(private readonly client: DirectObsClient) {
    super();
    this.setMaxListeners(0);

    client.on("connectionReset", () => {
      this.connectionGen++;
      this.availability = "unknown";
      this.version = "";
      this.decks = [];
      this.deckCommandUnsupported = false;
      this.emit("changed");
    });

    client.on("connectionReady", () => {
      void this.refreshDecks();
    });

    client.on(
      "namedVendorEvent",
      (vendorName: string, eventType: string, eventData: Record<string, unknown>) => {
        if (vendorName !== VS_VENDOR_NAME || eventType !== "decks_changed") return;
        this.applyDecksPayload(eventData, false);
      }
    );

    if (client.isConnected()) {
      void this.refreshDecks();
    }
  }

  public getAvailability(): TapeDeckAvailability {
    return this.availability;
  }

  public getVersion(): string {
    return this.version;
  }

  public isDeckCommandUnsupported(): boolean {
    return this.deckCommandUnsupported;
  }

  public getDecks(): readonly TapeDeckEntry[] {
    return this.decks;
  }

  /** Inspector snapshot broadcast inside `directObsState`. */
  public getInspectorState(): {
    availability: TapeDeckAvailability;
    version: string;
    deckCommandUnsupported: boolean;
    decks: Array<{
      source: string;
      filter: string;
      deckId: string;
      role: string;
      state: string;
      speedPercent: number;
      effectiveSpeedPercent: number;
      speedFaderLive: boolean;
      speedFaderSlotId: string;
      playing: boolean;
    }>;
  } {
    return {
      availability: this.availability,
      version: this.version,
      deckCommandUnsupported: this.deckCommandUnsupported,
      decks: this.decks.map((d) => ({
        source: d.source,
        filter: d.filter,
        deckId: d.deckId,
        role: d.role,
        state: d.state,
        speedPercent: d.speedPercent,
        effectiveSpeedPercent: d.effectiveSpeedPercent,
        speedFaderLive: d.speedFader.live,
        speedFaderSlotId: d.speedFader.slotId,
        playing: d.playing
      }))
    };
  }

  public async refreshDecks(): Promise<void> {
    if (!this.client.isIdentified()) return;
    const gen = this.connectionGen;
    try {
      const reply = await this.client.callNamedVendor<GetDecksReply>(VS_VENDOR_NAME, "get_decks");
      if (gen !== this.connectionGen) return;
      this.applyDecksPayload(reply as Record<string, unknown>, true);
    } catch (error) {
      if (gen !== this.connectionGen) return;
      if (isObsVendorRequestMissingError(error)) {
        // The vendor answered, without this request (OBS's 600 "No request was found", or 604): Visual Sidechain is
        // loaded and older than the Tape Deck requests. "Update Midi Fadester", not "not loaded".
        this.availability = "loaded";
        this.decks = [];
        this.deckCommandUnsupported = true;
        this.emit("changed");
      } else if (isObsVendorMissingError(error)) {
        this.availability = "not_loaded";
        this.version = "";
        this.decks = [];
        this.deckCommandUnsupported = false;
        this.emit("changed");
      }
    }
  }

  public resolveDeck(deckSource = ""): TapeDeckEntry | null {
    const trimmed = deckSource.trim();
    const owners = this.decks.filter((d) => d.role === "owner" || d.role === "pending");
    if (!trimmed) {
      return owners[0] ?? null;
    }
    return (
      owners.find((d) => d.source === trimmed) ??
      this.decks.find((d) => d.source === trimmed) ??
      null
    );
  }

  public sample(deckSource = ""): SampledTapeDeck {
    const connected = this.client.isConnected();
    if (!connected) {
      return {
        state: "disconnected",
        connected: false,
        availability: this.availability,
        deckCommandUnsupported: this.deckCommandUnsupported,
        deck: null,
        transport: "paused",
        speedPercent: TAPE_DECK_NORMAL_PCT,
        speedLabel: formatTapeDeckSpeed(TAPE_DECK_NORMAL_PCT),
        decks: this.decks
      };
    }
    if (this.availability === "not_loaded") {
      return {
        state: "not_loaded",
        connected: true,
        availability: "not_loaded",
        deckCommandUnsupported: false,
        deck: null,
        transport: "paused",
        speedPercent: TAPE_DECK_NORMAL_PCT,
        speedLabel: formatTapeDeckSpeed(TAPE_DECK_NORMAL_PCT),
        decks: this.decks
      };
    }
    const deck = this.resolveDeck(deckSource);
    if (!deck) {
      return {
        state: "no_deck",
        connected: true,
        availability: this.availability,
        deckCommandUnsupported: this.deckCommandUnsupported,
        deck: null,
        transport: "paused",
        speedPercent: TAPE_DECK_NORMAL_PCT,
        speedLabel: formatTapeDeckSpeed(TAPE_DECK_NORMAL_PCT),
        decks: this.decks
      };
    }
    return {
      state: "active",
      connected: true,
      availability: this.availability,
      deckCommandUnsupported: this.deckCommandUnsupported,
      deck,
      transport: transportForDeck(deck),
      speedPercent: deck.effectiveSpeedPercent,
      speedLabel: formatTapeDeckSpeed(deck.effectiveSpeedPercent),
      decks: this.decks
    };
  }

  public async executeOperation(deckSource: string, operation: TapeDeckOperation): Promise<DeckCommandReply> {
    switch (operation) {
      case "play_pause":
        return this.sendDeckCommand(deckSource, { op: "play_pause" });
      case "cue_to_start":
        return this.sendDeckCommand(deckSource, { op: "cue_to_start" });
      case "normal_speed":
        return this.sendDeckCommand(deckSource, { op: "normal_speed" });
      case "speed_up":
        return this.sendDeckCommand(deckSource, { op: "speed_step", steps: 1 });
      case "speed_down":
        return this.sendDeckCommand(deckSource, { op: "speed_step", steps: -1 });
    }
  }

  public async stepSpeed(deckSource: string, ticks: number): Promise<DeckCommandReply> {
    const steps = Math.trunc(ticks);
    return this.sendDeckCommand(deckSource, { op: "speed_step", steps });
  }

  public async setSpeed(deckSource: string, percent: number): Promise<DeckCommandReply> {
    return this.sendDeckCommand(deckSource, { op: "speed_set", percent });
  }

  private async sendDeckCommand(
    deckSource: string,
    params: Record<string, unknown>
  ): Promise<DeckCommandReply> {
    if (this.availability === "not_loaded") {
      throw new DirectObsError(ownText("vpNotLoaded"), OBS_VENDOR_NOT_FOUND);
    }
    const resolved = this.resolveDeck(deckSource);
    const targetName = resolved?.source || deckSource.trim();
    if (!targetName) {
      throw new DirectObsError(ownText("tdErrorNoDeck"), 404);
    }

    const gen = this.connectionGen;
    try {
      const reply = await this.client.callNamedVendor<DeckCommandReply>(
        VS_VENDOR_NAME,
        "deck_command",
        { deck: targetName, ...params }
      );
      if (gen === this.connectionGen) {
        this.deckCommandUnsupported = false;
        this.availability = "loaded";
        this.applyCommandReply(targetName, reply);
      }
      return reply;
    } catch (error) {
      const code = errorCodeOf(error);
      // First: OBS answers 600 for a missing request too (by its comment), and that is not a missing plugin.
      if (isObsVendorRequestMissingError(error)) {
        if (gen === this.connectionGen) {
          this.deckCommandUnsupported = true;
          this.emit("changed");
        }
        throw new DirectObsError(
          ownText("vsNeedsUpdateSentence", { request: "deck_command" }),
          OBS_VENDOR_REQUEST_MISSING
        );
      }
      if (code === OBS_VENDOR_NOT_FOUND) {
        if (gen === this.connectionGen) {
          this.availability = "not_loaded";
          this.decks = [];
          this.emit("changed");
        }
        throw new DirectObsError(ownText("vpNotLoaded"), OBS_VENDOR_NOT_FOUND);
      }
      throw error;
    }
  }

  private applyDecksPayload(payload: Record<string, unknown>, initial: boolean): void {
    this.availability = "loaded";
    if (typeof payload.version === "string" && payload.version.length > 0) {
      this.version = payload.version;
      if (initial) {
        this.deckCommandUnsupported = false;
      }
    } else if (initial) {
      // Pre-P1-6 Visual Sidechain omitted `version` in `get_decks` and lacked `deck_command`.
      this.deckCommandUnsupported = true;
    }
    this.decks = normalizeDecksList(payload.decks);
    this.emit("changed");
  }

  private applyCommandReply(targetSource: string, reply: DeckCommandReply): void {
    const idx = this.decks.findIndex(
      (d) =>
        (reply.deck && d.deckId === reply.deck) ||
        (d.source === (reply.source ?? targetSource) && (d.role === "owner" || d.role === "pending"))
    );
    if (idx === -1) return;
    const prev = this.decks[idx];
    const nextSpeed = clampSpeedPct(reply.speed_percent, prev.speedPercent);
    const nextEffective = clampSpeedPct(reply.effective_speed_percent, nextSpeed);
    const nextPlaying = typeof reply.playing === "boolean" ? reply.playing : prev.playing;
    const nextLive =
      typeof reply.speed_fader_live === "boolean" ? reply.speed_fader_live : prev.speedFader.live;
    const nextState =
      reply.op === "play_pause"
        ? nextPlaying
          ? "playing"
          : "paused"
        : prev.state;

    const nextDecks = [...this.decks];
    nextDecks[idx] = {
      ...prev,
      playing: nextPlaying,
      speedPercent: nextSpeed,
      effectiveSpeedPercent: nextEffective,
      state: nextState,
      speedFader: {
        ...prev.speedFader,
        live: nextLive
      },
      ...(prev.reported
        ? {
            reported: {
              ...prev.reported,
              ...(reply.op === "play_pause" ? { paused: !nextPlaying, ended: false } : {})
            }
          }
        : {})
    };
    this.decks = nextDecks;
    this.emit("changed");
  }
}
