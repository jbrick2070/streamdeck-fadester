// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension: optional keyboard hotkeys for the page you are on, run in the isolated world beside the bridge.
//
//   [  slower (one step down)      ]  faster (one step up)      \  back to 1x
//
// They are OFF until the operator ticks "Keyboard hotkeys" on the options page (settings.ts hotkeysWanted): most
// people have their hands on the keyboard while a video plays, so no key is taken without being asked for. While on,
// a key is taken only when all of these hold, and is left to the page in every other case:
//   - it is exactly one of the three keys, with no Ctrl, Alt or Command (AltGr is allowed, some layouts type [ ] \ with it,
//     and on a Mac so is Option when the character it gives is [ ] or \); on a layout that types a non-Latin letter on
//     those physical keys (Russian, Ukrainian) the physical key counts (hotkeyOf);
//   - the focus is not in a text field, a drop-down list, a menu, a list box, or anything editable (read through open
//     shadow roots; a closed shadow root shows only its host), and no input method is composing text;
//   - the page has a video the bridge can see (bridge-core.ts readMediaFacts);
//   - on a site other than YouTube, "Control videos on every site" is still on (D-4): turning it off ends the hotkeys
//     in tabs that were already open, as it ends everything else VJster does there.
// A key that is taken goes no further: it does not reach the page's handlers below this one (document, elements),
// nor any handler added to the window after this one. A handler the page registered earlier has already run.
// The key becomes an ordinary speed intent for this page's adapter, so the hotkeys share everything the deck's keys
// have: the ad hold (R-BEH-1), the grid and the range (R-SPD-1..2), and the answer. They work with no deck and no
// companion program; the keystroke is read here, never stored, and never leaves the page (docs/vjster/PRIVACY.md).

import { PROTOCOL_VERSION, type Intent } from "../../src/vjster/shared/protocol.js";
import { DEFAULT_STEP } from "../../src/vjster/shared/speed.js";
import { readMediaFacts, type BridgeDocument } from "./bridge-core.js";
import { ALL_SITES_KEY, HOTKEYS_KEY, allSitesWanted, hotkeysWanted } from "./settings.js";
import { isYouTubeHost } from "./youtube.js";

/** The keys, as `KeyboardEvent.key` names them (the character the layout types, so a layout with [ ] \ elsewhere works). */
export const KEY_SLOWER = "[";
export const KEY_FASTER = "]";
export const KEY_RESET = "\\";

/**
 * The intent for a key, or null for any other key. `extended` writes the rate straight to the element, which allows
 * 0.1x to 16x (R-SPD-2): a hotkey policy for a plain video element, since VJster's default range for a player that
 * names no rates of its own stops at 2x. YouTube is stepped through its player instead, so its own speed menu
 * follows and the rates it offers apply.
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
/** ARIA roles whose widget uses typed characters: text boxes, and the lists and menus that jump to what is typed. */
const EDITABLE_ROLES = new Set([
  "textbox", "searchbox", "combobox", "spinbutton", "listbox", "option", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio"
]);

/** True where a typed character belongs to the page's widget, not to a shortcut: inputs, text areas, lists, menus, editors. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const el = target as FocusedLike;
  if (typeof el.tagName === "string" && EDITABLE_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable === true) return true;
  const role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  // ARIA allows fallback roles ("textbox combobox"): any one of them that takes typed characters counts.
  return typeof role === "string" && role.toLowerCase().split(/\s+/).some((token) => EDITABLE_ROLES.has(token));
}

/** The key each of the three physical keys stands for, used only where the layout types a non-Latin letter there. */
const KEY_BY_CODE: Readonly<Record<string, string>> = { BracketLeft: KEY_SLOWER, BracketRight: KEY_FASTER, Backslash: KEY_RESET };

/**
 * The hotkey a keydown stands for, or null. The character the layout types (`key`) decides first, so a layout that
 * types [ ] \ elsewhere works and one that types something else on those keys (German ü + #, French ^ $ *) keeps it.
 * Only when that character is a single letter of a non-Latin script (Russian х ъ, Ukrainian х ї ґ) is the physical key
 * (`code`) read instead: those layouts have no [ ] on the keyboard at all. A capital (Shift) is a shifted character
 * there, as { is on a US layout, and is not taken.
 */
export function hotkeyOf(event: Pick<KeyLike, "key" | "code" | "shiftKey">): string | null {
  const k = event.key;
  if (k === KEY_SLOWER || k === KEY_FASTER || k === KEY_RESET) return k;
  // Cheap first: one character (two UTF-16 units at most) above Latin Extended-B, before any regular expression.
  if (k.length === 0 || k.length > 2 || k.charCodeAt(0) <= 0x24f) return null;
  if (event.shiftKey === true || !/^\p{L}$/u.test(k) || /\p{Script=Latin}/u.test(k)) return null;
  const code = event.code;
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(KEY_BY_CODE, code) ? KEY_BY_CODE[code] : null;
}

/** What the hotkeys read of the browser's navigator: only which system it runs on. */
export interface NavigatorLike {
  readonly platform?: string;
  readonly userAgentData?: { readonly platform?: string } | null;
}

/** True on macOS, where Option (reported as Alt) is how many layouts type [ ] \, much as AltGr is elsewhere. */
export function isMacPlatform(nav: NavigatorLike | undefined): boolean {
  const platform = nav?.userAgentData?.platform;
  if (typeof platform === "string" && platform !== "") return platform === "macOS";
  return typeof nav?.platform === "string" && /^Mac/.test(nav.platform);
}

/** The part of a keydown event the hotkeys use. */
export interface KeyLike {
  readonly key: string;
  /** The physical key, read only where the layout types a non-Latin letter on it (hotkeyOf). */
  readonly code?: string;
  readonly shiftKey?: boolean;
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
  /** Stops the event for every later handler, on this window too (stopPropagation would leave those). */
  stopImmediatePropagation(): void;
}

/** The part of the window the hotkeys use. */
export interface HotkeyWindow {
  readonly location: { readonly hostname: string };
  /** Absent only in tests: without it no video is found and no key is taken. */
  readonly document?: BridgeDocument;
  /** Which system the browser runs on (isMacPlatform); absent: not a Mac. */
  readonly navigator?: NavigatorLike;
  addEventListener(type: "keydown", fn: (event: KeyLike) => void, capture: boolean): void;
  removeEventListener(type: "keydown", fn: (event: KeyLike) => void, capture: boolean): void;
}

/** The part of chrome.storage.local the hotkeys use, with its change event. */
export interface HotkeyStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
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
 *
 * On a site other than YouTube the hotkeys also follow "Control videos on every site" (D-4), the way the worker does
 * for everything else: that option is on unless the operator unticked it (allSitesWanted), and unticking it ends the
 * hotkeys in a tab that was open at the time, whose script Chrome keeps until the page reloads.
 */
export function installHotkeys(win: HotkeyWindow, storage: HotkeyStorage, deps: HotkeyDeps): Hotkeys {
  let active = false;
  let hotkeysOn = false;
  let sitesOn = true;
  const onYouTube = isYouTubeHost(win.location.hostname);
  const extended = !onYouTube;
  const mac = isMacPlatform(win.navigator);

  const onKey = (event: KeyLike): void => {
    // Every other key, the great majority of what is typed on a page, ends here, before anything is made or read.
    const hotkey = hotkeyOf(event);
    if (hotkey === null) return;
    if (deps.alive && !deps.alive()) return follow();
    if (event.defaultPrevented || event.isComposing) return;
    const altGraph = event.getModifierState?.("AltGraph") === true;
    // On a Mac, Option changes the character (Chrome reports it as Alt, never as AltGraph): a [ ] \ that arrives with
    // Option held is what the layout types there (German Option+5 is [). A US Mac's Option+[ types “, not [.
    const macOption = mac && event.altKey && !event.ctrlKey && !event.metaKey && event.key === hotkey;
    if (event.metaKey || ((event.ctrlKey || event.altKey) && !altGraph && !macOption)) return;
    // Holding a step key keeps stepping; holding the reset key resets once.
    if (event.repeat && hotkey === KEY_RESET) return;
    if (isEditableTarget(event.composedPath?.()[0] ?? event.target)) return;
    if (!win.document || !readMediaFacts(win.document).video) return;
    const intent = hotkeyIntent(hotkey, deps.newId(), extended);
    if (!intent) return;
    // Taken: the page's own shortcut for this key (a site that also uses [ ]) must not fire as well.
    event.preventDefault();
    event.stopImmediatePropagation();
    deps.post(intent);
  };

  /** Install or remove the listener to match the settings; an orphaned copy (extension updated) lets go for good. */
  function follow(): void {
    const orphaned = deps.alive !== undefined && !deps.alive();
    const wanted = !orphaned && hotkeysOn && (onYouTube || sitesOn);
    if (wanted === active) return;
    active = wanted;
    if (wanted) win.addEventListener("keydown", onKey, true);
    else win.removeEventListener("keydown", onKey, true);
  }

  // Off until the stored value says on. A store that cannot be read (an orphaned script) leaves it off.
  void Promise.resolve()
    .then(() => storage.get([HOTKEYS_KEY, ALL_SITES_KEY]))
    .then((stored) => {
      hotkeysOn = hotkeysWanted(stored[HOTKEYS_KEY]);
      sitesOn = allSitesWanted(stored[ALL_SITES_KEY]);
      follow();
    })
    .catch(() => {
      hotkeysOn = false;
      follow();
    });
  try {
    storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (HOTKEYS_KEY in changes) hotkeysOn = hotkeysWanted(changes[HOTKEYS_KEY].newValue);
      if (ALL_SITES_KEY in changes) sitesOn = allSitesWanted(changes[ALL_SITES_KEY].newValue);
      if (HOTKEYS_KEY in changes || ALL_SITES_KEY in changes) follow();
    });
  } catch {
    // orphaned: the settings can no longer be followed, and they stay as they were
  }

  return { enabled: () => active };
}
