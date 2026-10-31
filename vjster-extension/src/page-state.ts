// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: what a page reports about its video, cleaned to the
// sender rules of docs/vjster/PLAN.md 3.3 before it leaves the page, so the
// plugin's strict parser never has to refuse a whole report over one odd value.

import { normalizeLevels } from "../../src/vjster/shared/quality.js";
import { CAPABILITIES, type Capability } from "../../src/vjster/shared/protocol.js";

const MAX_TITLE = 300;
const MAX_RATE = 16;
const MAX_LIST = 64;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;
/** C0 and C1 controls, plus line and paragraph separators and bidirectional overrides. */
const CONTROL_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069]
];
/** Built from character codes, so no escape in this file can be mangled by a tool that copies it. */
const CONTROL = new RegExp(`[${CONTROL_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]`, "g");

/** The video part of a state report, as a page produces it (no envelope, no host). */
export interface PageState {
  readonly rate: number | null;
  readonly rateDirect: boolean;
  readonly availableRates: readonly number[];
  readonly quality: string | null;
  readonly availableQualities: readonly string[];
  readonly qualityAuto: boolean | null;
  readonly title: string | null;
  readonly playing: boolean;
  readonly adPlaying: boolean;
  readonly capabilities: readonly Capability[];
}

/** A page with no usable video. */
export const NO_VIDEO: PageState = {
  rate: null,
  rateDirect: false,
  availableRates: [],
  quality: null,
  availableQualities: [],
  qualityAuto: null,
  title: null,
  playing: false,
  adPlaying: false,
  capabilities: []
};

/** A title the plugin will accept: controls removed, whitespace collapsed, at most 300 characters, null if empty. */
export function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  if (text.length <= MAX_TITLE) return text;
  // Do not cut a surrogate pair in half.
  let cut = text.slice(0, MAX_TITLE);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** An error message the plugin will accept: controls removed, whitespace collapsed, at most 300 characters. */
export function cleanMessage(raw: unknown): string {
  return cleanTitle(raw) ?? "";
}

/** `location.hostname` when it is a plain host name, else null (IPv6 literals, file pages, ports never pass). */
export function cleanHost(hostname: unknown): string | null {
  return typeof hostname === "string" && HOST.test(hostname) ? hostname : null;
}

const isRate = (r: unknown): r is number => typeof r === "number" && Number.isFinite(r) && r > 0 && r <= MAX_RATE;

/** A usable rate, else null (never 0). */
export function cleanRate(raw: unknown): number | null {
  return isRate(raw) ? raw : null;
}

/** Usable rates only, in their order, at most 64. */
export function cleanRates(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.filter(isRate).slice(0, MAX_LIST) : [];
}

/** Level ids only (auto kept: it is part of what the player offers), at most 64. */
export function cleanLevels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const levels = normalizeLevels(raw);
  return raw.includes("auto") && levels.length > 0 ? [...levels, "auto"].slice(0, MAX_LIST) : levels.slice(0, MAX_LIST);
}

/** A level id, or null. */
export function cleanLevel(raw: unknown): string | null {
  return typeof raw === "string" && /^[a-z0-9]{1,16}$/.test(raw) ? raw : null;
}

/** Known capabilities only, once each. */
export function cleanCapabilities(raw: readonly unknown[]): Capability[] {
  const out: Capability[] = [];
  for (const c of raw) if ((CAPABILITIES as readonly unknown[]).includes(c) && !out.includes(c as Capability)) out.push(c as Capability);
  return out;
}

/** Apply every sender rule to a raw page state. */
export function cleanPageState(raw: Partial<Record<keyof PageState, unknown>>): PageState {
  const rate = cleanRate(raw.rate);
  if (rate === null) return NO_VIDEO;
  const qualityAuto = raw.qualityAuto === true ? true : raw.qualityAuto === false ? false : null;
  return {
    rate,
    rateDirect: raw.rateDirect === true,
    availableRates: cleanRates(raw.availableRates),
    quality: cleanLevel(raw.quality),
    availableQualities: cleanLevels(raw.availableQualities),
    qualityAuto,
    title: cleanTitle(raw.title),
    playing: raw.playing === true,
    adPlaying: raw.adPlaying === true,
    capabilities: cleanCapabilities(Array.isArray(raw.capabilities) ? raw.capabilities : [])
  };
}
