// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: optional keyboard hotkeys for the page you are on, run in the isolated world beside the bridge.
//
//   [  slower (one step down)      ]  faster (one step up)      \  back to 1x
//
// They are OFF until the operator ticks "Keyboard hotkeys" on the options page (settings.ts hotkeysWanted): most
// people have their hands on the keyboard while a video plays, so no key is taken without being asked for. While on,
// a key is taken only when all of these hold, and is left to the page in every other case:
//   - it is exactly one of the three keys, with no Ctrl, Alt or Command (AltGr is allowed, some layouts type [ ] \ with it);
//   - the focus is not in a text field, a menu, or anything editable, and no input method is composing text;
//   - the page has a video the bridge can see (bridge-core.ts readMediaFacts).
// The key becomes an ordinary speed intent for this page's adapter, so the hotkeys share everything the deck's keys
// have: the ad hold (R-BEH-1), the grid and the range (R-SPD-1..2), and the answer. They work with no deck and no
// companion program; the keystroke is read here, never stored, and never leaves the page (docs/vjster/PRIVACY.md).

import { PROTOCOL_VERSION, type Intent } from "../../src/vjster/shared/protocol.js";
import { DEFAULT_STEP } from "../../src/vjster/shared/speed.js";
import { readMediaFacts, type BridgeDocument } from "./bridge-core.js";
import { HOTKEYS_KEY, hotkeysWanted } from "./settings.js";
import { isYouTubeHost } from "./youtube.js";

/** The keys, as `KeyboardEvent.key` names them (the character the layout types, so a layout with [ ] \ elsewhere works). */
export const KEY_SLOWER = "[";
export const KEY_FASTER = "]";
export const KEY_RESET = "\\";

/**
 * The intent for a key, or null for any other key. `extended` writes the rate straight to the element, which allows
 * 0.1x to 16x (R-SPD-2): right for a plain video element, whose own range would otherwise stop at 2x. YouTube is
 * stepped through its player instead, so its own speed menu follows and its own range applies.
 */
export function hotkeyIntent(key: string, id: string, extended: boolean): Intent | null {
  const envelope = { v: PROTOCOL_VERSION, id, target: "browser" } as const;
  switch (key) {
    case KEY_SLOWER:
      return { ...envelope, type: "speed.step", delta: -DEFAULT_STEP, direct: extended, hold: true };
    case KEY_FASTER:
      return { ...envelope, type: "speed.step", delta: DEFAULT_STEP, direct: extended, hold: true };
    case KEY_RESET:
      return { ...envelope, type: "speed.reset" };
    default:
      return null;
  }
}

/** What the hotkeys read of an element that has the focus (no DOM types, so it is tested in Node). */
export interface FocusedLike {
  readonly tagName?: unknown;
  readonly isContentEditable?: unknown;
  getAttribute?(name: string): string | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox"]);

/** True where a typed character belongs to the page's field, not to a shortcut: inputs, text areas, menus, editors. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const el = target as FocusedLike;
  if (typeof el.tagName === "string" && EDITABLE_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable === true) return true;
  const role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  return role !== null && EDITABLE_ROLES.has(role.toLowerCase());
}

/** The part of a keydown event the hotkeys use. */
export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
  readonly target: unknown;
  /** The element the key was typed into, even inside an open shadow root (the event's own target is the shadow's host). */
  composedPath?(): unknown[];
  /** `getModifierState("AltGraph")`: Windows reports AltGr as Ctrl and Alt together. */
  getModifierState?(key: string): boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/** The part of the window the hotkeys use. */
export interface HotkeyWindow {
  readonly location: { readonly hostname: string };
  /** Absent only in tests: without it no video is found and no key is taken. */
  readonly document?: BridgeDocument;
  addEventListener(type: "keydown", fn: (event: KeyLike) => void, capture: boolean): void;
  removeEventListener(type: "keydown", fn: (event: KeyLike) => void, capture: boolean): void;
}

/** The part of chrome.storage.local the hotkeys use, with its change event. */
export interface HotkeyStorage {
  get(keys: string): Promise<Record<string, unknown>>;
  onChanged: { addListener(fn: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void): void };
}

export interface HotkeyDeps {
  /** Hand an intent to this page's adapter (Bridge.intentToPage). */
  post(intent: Intent): void;
  /** A message id, unique on this page (the adapter answers with it). */
  newId(): string;
  /**
   * False once the extension was updated or reloaded under this page: its scripts are orphaned and a new bridge has
   * its own hotkeys (content-bridge.ts), so this copy lets go instead of answering every key twice.
   */
  alive?(): boolean;
}

export interface Hotkeys {
  /** Whether the keyboard listener is installed now. */
  enabled(): boolean;
}

/**
 * Follow the "Keyboard hotkeys" setting: the listener is installed only while it is on, so with it off (the default)
 * VJster sees no key at all. Turning it on or off on the options page takes effect in open tabs at once.
 */
export function installHotkeys(win: HotkeyWindow, storage: HotkeyStorage, deps: HotkeyDeps): Hotkeys {
  let active = false;
  const extended = !isYouTubeHost(win.location.hostname);

  const onKey = (event: KeyLike): void => {
    if (deps.alive && !deps.alive()) return apply(false);
    if (event.defaultPrevented || event.isComposing) return;
    const altGraph = event.getModifierState?.("AltGraph") === true;
    if (event.metaKey || ((event.ctrlKey || event.altKey) && !altGraph)) return;
    const intent = hotkeyIntent(event.key, deps.newId(), extended);
    if (!intent) return;
    // Holding a step key keeps stepping; holding the reset key resets once.
    if (event.repeat && intent.type === "speed.reset") return;
    if (isEditableTarget(event.composedPath?.()[0] ?? event.target)) return;
    if (!win.document || !readMediaFacts(win.document).video) return;
    // Taken: the page's own shortcut for this key (a site that also uses [ ]) must not fire as well.
    event.preventDefault();
    event.stopPropagation();
    deps.post(intent);
  };

  function apply(wanted: boolean): void {
    if (wanted === active) return;
    active = wanted;
    if (wanted) win.addEventListener("keydown", onKey, true);
    else win.removeEventListener("keydown", onKey, true);
  }

  // Off until the stored value says on. A store that cannot be read (an orphaned script) leaves it off.
  void Promise.resolve()
    .then(() => storage.get(HOTKEYS_KEY))
    .then((stored) => apply(hotkeysWanted(stored[HOTKEYS_KEY])))
    .catch(() => apply(false));
  try {
    storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && HOTKEYS_KEY in changes) apply(hotkeysWanted(changes[HOTKEYS_KEY].newValue));
    });
  } catch {
    // orphaned: the setting can no longer be followed, and it stays as it was
  }

  return { enabled: () => active };
}
