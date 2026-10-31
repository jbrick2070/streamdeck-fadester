// SPDX-License-Identifier: GPL-2.0-or-later
// VJster: the vocabulary shared by the deck actions, the Chrome extension and
// the Phase 2 page (docs/vjster/REQUIREMENTS.md section 2, PLAN.md 3.3).
// Requirement ids in src/vjster refer to docs/vjster/REQUIREMENTS.md.
//
// This folder imports nothing from Fadester's OBS code, so a standalone VJster
// plugin can be built from the same source later (R-HOME-3).
//
// Every message is validated field by field before use (R-INT-3): unknown
// fields are dropped, a malformed or unknown message becomes a ParseFailure
// that the receiver answers with an `error`, and nothing is evaluated or
// looked up by a key taken from the message.

import { ALLOWED_STEPS, EXTENDED_RANGE, rangeBounds } from "./speed.js";
import { isLevelId } from "./quality.js";

/** Protocol version carried by every message (R-INT-1). */
export const PROTOCOL_VERSION = 1 as const;

/** Default port of the plugin's loopback link server (R-LNK-1). */
export const DEFAULT_LINK_PORT = 48150;

/** The only address the link server ever binds (R-LNK-1). */
export const LINK_HOST = "127.0.0.1";

/** The targets an intent can address (R-INT-1). The array is the source of the type, so they cannot drift apart. */
export const TARGETS = ["browser", "obs"] as const;
export type Target = (typeof TARGETS)[number];

/** What a target can do (R-INT-2). */
export const CAPABILITIES = ["speed", "quality", "transport"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Longest message accepted, in UTF-16 code units; longer text is refused unread. */
export const MAX_MESSAGE_CHARS = 16384;
const MAX_TITLE_CHARS = 300;
const MAX_LIST = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;
const MAX_RATE = rangeBounds(EXTENDED_RANGE).max;

export const INTENT_TYPES = [
  "speed.set",
  "speed.step",
  "speed.reset",
  "quality.set",
  "quality.step",
  "quality.reset",
  "transport.toggle",
  "state.get",
  "pin.set"
] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export const REPORT_TYPES = ["state", "error"] as const;
export const KEEPALIVE_TYPES = ["ping", "pong"] as const;

export const ERROR_CODES = [
  "too-long",
  "bad-json",
  "bad-version",
  "bad-message",
  "unknown-type",
  "unexpected-type",
  "no-video",
  "unsupported",
  "internal"
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

interface Envelope {
  readonly v: typeof PROTOCOL_VERSION;
  readonly id: string;
  readonly target: Target;
}

export type SpeedSet = Envelope & { readonly type: "speed.set"; readonly rate: number; readonly direct: boolean; readonly hold: boolean };
export type SpeedStep = Envelope & { readonly type: "speed.step"; readonly delta: number; readonly direct: boolean; readonly hold: boolean };
export type SpeedReset = Envelope & { readonly type: "speed.reset" };
export type QualitySet = Envelope & { readonly type: "quality.set"; readonly level: string; readonly hold: boolean };
export type QualityStep = Envelope & { readonly type: "quality.step"; readonly direction: 1 | -1; readonly hold: boolean };
export type QualityReset = Envelope & { readonly type: "quality.reset" };
export type TransportToggle = Envelope & { readonly type: "transport.toggle" };
export type StateGet = Envelope & { readonly type: "state.get" };
export type PinSet = Envelope & { readonly type: "pin.set"; readonly pinned: boolean };

export type Intent =
  | SpeedSet
  | SpeedStep
  | SpeedReset
  | QualitySet
  | QualityStep
  | QualityReset
  | TransportToggle
  | StateGet
  | PinSet;

/** State of a target's current video (R-INT-2). All video fields are null or empty when there is none. */
export type StateReport = Envelope & {
  readonly type: "state";
  readonly inReplyTo: string | null;
  readonly rate: number | null;
  /** The rate was written to the element directly (R-SPD-2 extended range); the site's own menu does not show it. */
  readonly rateDirect: boolean;
  readonly availableRates: readonly number[];
  /** The level playing now (`unknown` while the player has not decided). */
  readonly quality: string | null;
  readonly availableQualities: readonly string[];
  /** Auto is on; null when the target has no quality control. */
  readonly qualityAuto: boolean | null;
  readonly title: string | null;
  readonly host: string | null;
  readonly playing: boolean;
  readonly adPlaying: boolean;
  readonly capabilities: readonly Capability[];
};

export type ErrorReport = Envelope & {
  readonly type: "error";
  readonly code: ErrorCode;
  readonly message: string;
  readonly inReplyTo: string | null;
};

export type Keepalive = Envelope & { readonly type: "ping" | "pong"; readonly t: number };

export type Report = StateReport | ErrorReport;
export type Message = Intent | Report | Keepalive;

/** Which messages a receiver accepts: a target takes intents, the deck takes reports; both take keepalives. */
export type Accept = "intents" | "reports";

export type ParseResult =
  | { readonly ok: true; readonly message: Message }
  | { readonly ok: false; readonly code: ErrorCode; readonly reason: string; readonly inReplyTo: string | null };

type Raw = Record<string, unknown>;

class Invalid extends Error {}

const fail = (reason: string): never => {
  throw new Invalid(reason);
};

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

function bool(raw: Raw, key: string, fallback?: boolean): boolean {
  const value = raw[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") fail(`${key} must be true or false`);
  return value as boolean;
}

function num(raw: Raw, key: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${key} must be a finite number`);
  return value as number;
}

function rateValue(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_RATE) {
    fail(`${what} must be a number above 0 and at most ${MAX_RATE}`);
  }
  return value as number;
}

function optionalId(raw: Raw, key: string): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(`${key} must be a message id`);
  return value as string;
}

function nullableLevel(raw: Raw, key: string): string | null {
  const value = raw[key];
  if (value === null) return null;
  if (!isLevelId(value)) fail(`${key} must be a level id or null`);
  return value as string;
}

function nullableText(raw: Raw, key: string, max: number, pattern?: RegExp): string | null {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max || (pattern !== undefined && !pattern.test(value))) {
    fail(`${key} must be ${pattern ? "a host name" : `text of at most ${max} characters`} or null`);
  }
  return value as string;
}

function list<T>(raw: Raw, key: string, item: (value: unknown) => T): T[] {
  const value = raw[key];
  if (!Array.isArray(value) || value.length > MAX_LIST) fail(`${key} must be a list of at most ${MAX_LIST} items`);
  return (value as unknown[]).map(item);
}

function readIntent(raw: Raw, env: Envelope, type: IntentType): Intent {
  switch (type) {
    case "speed.set":
      return { ...env, type, rate: rateValue(raw.rate, "rate"), direct: bool(raw, "direct", false), hold: bool(raw, "hold", false) };
    case "speed.step": {
      const delta = num(raw, "delta");
      if (!(ALLOWED_STEPS as readonly number[]).includes(Math.abs(delta))) {
        fail(`delta must be plus or minus one of ${ALLOWED_STEPS.join(", ")}`);
      }
      return { ...env, type, delta, direct: bool(raw, "direct", false), hold: bool(raw, "hold", false) };
    }
    case "quality.set": {
      const level = raw.level;
      if (!isLevelId(level)) fail("level must be a level id");
      return { ...env, type, level: level as string, hold: bool(raw, "hold", false) };
    }
    case "quality.step": {
      const direction = raw.direction;
      if (direction !== 1 && direction !== -1) fail("direction must be 1 or -1");
      return { ...env, type, direction: direction as 1 | -1, hold: bool(raw, "hold", false) };
    }
    case "pin.set":
      return { ...env, type, pinned: bool(raw, "pinned") };
    case "speed.reset":
    case "quality.reset":
    case "transport.toggle":
    case "state.get":
      return { ...env, type };
  }
}

function readState(raw: Raw, env: Envelope): StateReport {
  const rateRaw = raw.rate;
  const capabilities: Capability[] = [];
  for (const c of list(raw, "capabilities", (value) => value)) {
    // Unknown capabilities from a newer peer are ignored, like unknown fields.
    if ((CAPABILITIES as readonly unknown[]).includes(c) && !capabilities.includes(c as Capability)) capabilities.push(c as Capability);
  }
  const qualityAuto = raw.qualityAuto;
  if (qualityAuto !== null && typeof qualityAuto !== "boolean") fail("qualityAuto must be true, false or null");
  return {
    ...env,
    type: "state",
    inReplyTo: optionalId(raw, "inReplyTo"),
    rate: rateRaw === null ? null : rateValue(rateRaw, "rate"),
    rateDirect: bool(raw, "rateDirect", false),
    availableRates: list(raw, "availableRates", (value) => rateValue(value, "availableRates item")),
    quality: nullableLevel(raw, "quality"),
    availableQualities: list(raw, "availableQualities", (value) => {
      if (!isLevelId(value)) fail("availableQualities items must be level ids");
      return value as string;
    }),
    qualityAuto: qualityAuto as boolean | null,
    title: nullableText(raw, "title", MAX_TITLE_CHARS),
    host: nullableText(raw, "host", 253, HOST_PATTERN),
    playing: bool(raw, "playing"),
    adPlaying: bool(raw, "adPlaying"),
    capabilities
  };
}

function readError(raw: Raw, env: Envelope): ErrorReport {
  const code = raw.code;
  if (!(ERROR_CODES as readonly unknown[]).includes(code)) fail("code must be a known error code");
  const message = raw.message;
  if (typeof message !== "string" || message.length > MAX_TITLE_CHARS) fail(`message must be text of at most ${MAX_TITLE_CHARS} characters`);
  return { ...env, type: "error", code: code as ErrorCode, message: message as string, inReplyTo: optionalId(raw, "inReplyTo") };
}

/**
 * Parse and validate one message. Never throws; a failure carries the error
 * code to answer with and, when the message had a readable id, `inReplyTo`.
 */
export function parse(text: unknown, accept: Accept): ParseResult {
  if (typeof text !== "string") return { ok: false, code: "bad-message", reason: "a message must be text", inReplyTo: null };
  if (text.length > MAX_MESSAGE_CHARS) return { ok: false, code: "too-long", reason: `messages are limited to ${MAX_MESSAGE_CHARS} characters`, inReplyTo: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: "bad-json", reason: "the message is not valid JSON", inReplyTo: null };
  }
  if (!isRecord(data)) return { ok: false, code: "bad-message", reason: "a message must be a JSON object", inReplyTo: null };

  const id = typeof data.id === "string" && ID_PATTERN.test(data.id) ? data.id : null;
  const failure = (code: ErrorCode, reason: string): ParseResult => ({ ok: false, code, reason, inReplyTo: id });

  if (data.v !== PROTOCOL_VERSION) return failure("bad-version", `this side speaks protocol version ${PROTOCOL_VERSION}`);
  const type = data.type;
  if (typeof type !== "string") return failure("bad-message", "type must be text");
  const isIntent = (INTENT_TYPES as readonly string[]).includes(type);
  const isReport = (REPORT_TYPES as readonly string[]).includes(type);
  const isKeepalive = (KEEPALIVE_TYPES as readonly string[]).includes(type);
  if (!isIntent && !isReport && !isKeepalive) return failure("unknown-type", "unknown message type");
  if ((isIntent && accept !== "intents") || (isReport && accept !== "reports")) {
    return failure("unexpected-type", "this side does not accept that message type");
  }
  if (id === null) return failure("bad-message", "id must be 1 to 64 letters, digits, hyphens or underscores");
  const target = data.target;
  if (!(TARGETS as readonly unknown[]).includes(target)) return failure("bad-message", `target must be one of ${TARGETS.join(", ")}`);
  const env: Envelope = { v: PROTOCOL_VERSION, id, target: target as Target };

  try {
    if (isIntent) return { ok: true, message: readIntent(data, env, type as IntentType) };
    if (type === "state") return { ok: true, message: readState(data, env) };
    if (type === "error") return { ok: true, message: readError(data, env) };
    return { ok: true, message: { ...env, type: type as "ping" | "pong", t: num(data, "t") } };
  } catch (e) {
    if (e instanceof Invalid) return failure("bad-message", e.message);
    return failure("internal", "the message could not be read");
  }
}

/** Text for one message. */
export function serialize(message: Message): string {
  return JSON.stringify(message);
}

/** The `error` reply for a failed parse or a refused intent (R-INT-3, R-INT-4). */
export function errorReply(
  code: ErrorCode,
  message: string,
  inReplyTo: string | null,
  env: { readonly id: string; readonly target: Target }
): ErrorReport {
  return {
    v: PROTOCOL_VERSION,
    id: env.id,
    target: env.target,
    type: "error",
    code,
    message: message.slice(0, MAX_TITLE_CHARS),
    inReplyTo
  };
}
