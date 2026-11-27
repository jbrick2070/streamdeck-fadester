// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension keyboard hotkeys (docs/vjster/REQUIREMENTS.md R-KEY-1..4): off until the operator ticks them,
// only [ ] \ and only where a key is not the page's own to type, following the setting live, and the intents they
// make being ordinary speed intents for the adapter.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Intent } from "../src/vjster/shared/protocol.js";

/** Every document the hotkeys asked readMediaFacts about (a pass-through, so the real search still runs). */
const mediaReads = vi.hoisted(() => ({ docs: [] as unknown[] }));
vi.mock("../vjster-extension/src/bridge-core.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../vjster-extension/src/bridge-core.js")>();
  return {
    ...real,
    readMediaFacts: (doc: Parameters<typeof real.readMediaFacts>[0]) => {
      mediaReads.docs.push(doc);
      return real.readMediaFacts(doc);
    }
  };
});
import { Adapter, type Report } from "../vjster-extension/src/adapter-core.js";
import { installBridge, type BridgeRuntime, type BridgeWindow } from "../vjster-extension/src/bridge-core.js";
import { videoControl, type PlayableVideo } from "../vjster-extension/src/generic-video.js";
import {
  KEY_FASTER, KEY_RESET, KEY_SLOWER, hotkeyIntent, hotkeyOf, installHotkeys, isEditableTarget,
  type HotkeyStorage, type HotkeyWindow, type KeyLike
} from "../vjster-extension/src/hotkeys.js";
import { FROM_BRIDGE, readBridgeMessage, readIntent } from "../vjster-extension/src/messages.js";
import { ALL_SITES_KEY, HOTKEYS_KEY, hotkeysWanted } from "../vjster-extension/src/settings.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const EXT = join(import.meta.dirname, "..", "vjster-extension");

/** A document with `count` video elements (and nothing else). */
const documentWith = (count: number) => ({ querySelectorAll: (selector: string) => (selector === "video" ? Array.from({ length: count }, () => ({ paused: true, ended: false, readyState: 0 })) : []) });

/** A window that keeps its keydown listeners, so a test can press keys and see whether the listener is installed. */
function fakeWindow(hostname: string, videos = 1, navigator?: HotkeyWindow["navigator"]) {
  const listeners = new Set<(e: KeyLike) => void>();
  const win: HotkeyWindow = {
    location: { hostname },
    document: documentWith(videos),
    navigator,
    addEventListener: (_type, fn) => void listeners.add(fn),
    removeEventListener: (_type, fn) => void listeners.delete(fn)
  };
  return { win, listeners };
}

/** A storage with the hotkeys setting and the every-site setting (or none) and a way to fire the change event. */
function fakeStorage(initial?: unknown, fail = false, sites?: unknown) {
  const values: Record<string, unknown> = {};
  if (initial !== undefined) values[HOTKEYS_KEY] = initial;
  if (sites !== undefined) values[ALL_SITES_KEY] = sites;
  let on: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
  const storage: HotkeyStorage = {
    get: () => (fail ? Promise.reject(new Error("Extension context invalidated.")) : Promise.resolve({ ...values })),
    onChanged: { addListener: (fn) => void (on = fn) }
  };
  return {
    storage,
    change: (next: unknown, area = "local", key = HOTKEYS_KEY) => {
      values[key] = next;
      on?.({ [key]: { newValue: next } }, area);
    }
  };
}

interface KeyOptions extends Partial<Omit<KeyLike, "key" | "preventDefault" | "stopImmediatePropagation">> {
  altGraph?: boolean;
}

/** A keydown, recording what the listener did with it. */
function key(k: string, options: KeyOptions = {}) {
  const calls = { prevented: 0, stopped: 0 };
  const { altGraph, ...rest } = options;
  const event: KeyLike = {
    key: k, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, defaultPrevented: false, target: { tagName: "BODY" },
    getModifierState: (name) => name === "AltGraph" && altGraph === true,
    preventDefault: () => void calls.prevented++,
    stopImmediatePropagation: () => void calls.stopped++,
    ...rest
  };
  return { event, calls };
}

/** The hotkeys installed on a fake window and storage, with the intents they post. */
async function setup(stored?: unknown, hostname = "example.com", videos = 1, sites?: unknown, navigator?: HotkeyWindow["navigator"]) {
  const w = fakeWindow(hostname, videos, navigator);
  const s = fakeStorage(stored, false, sites);
  const posted: Intent[] = [];
  let n = 0;
  const hotkeys = installHotkeys(w.win, s.storage, { post: (i) => void posted.push(i), newId: () => `hk-${++n}` });
  await flush();
  /** Press a key the way the page would deliver it: to every installed listener. */
  const press = (k: string, options?: KeyOptions) => {
    const pressed = key(k, options);
    for (const fn of [...w.listeners]) fn(pressed.event);
    return pressed.calls;
  };
  return { ...w, ...s, hotkeys, posted, press };
}

describe("hotkeys are off until the operator turns them on (R-KEY-1)", () => {
  it("reads only a stored true as on: missing, false and look-alikes are off", () => {
    expect(hotkeysWanted(undefined)).toBe(false);
    expect(hotkeysWanted(null)).toBe(false);
    expect(hotkeysWanted(false)).toBe(false);
    for (const odd of ["true", "on", 1, {}, []]) expect(hotkeysWanted(odd)).toBe(false);
    expect(hotkeysWanted(true)).toBe(true);
  });

  it("installs no keyboard listener at all on a fresh install, and takes no key", async () => {
    const t = await setup(undefined);
    expect(t.hotkeys.enabled()).toBe(false);
    expect(t.listeners.size).toBe(0);
    for (const k of [KEY_SLOWER, KEY_FASTER, KEY_RESET]) expect(t.press(k)).toEqual({ prevented: 0, stopped: 0 });
    expect(t.posted).toEqual([]);
  });

  it("stays off when the setting is false, or when the store cannot be read", async () => {
    expect((await setup(false)).hotkeys.enabled()).toBe(false);
    const w = fakeWindow("example.com");
    const hotkeys = installHotkeys(w.win, fakeStorage(true, true).storage, { post: () => undefined, newId: () => "hk-1" });
    await flush();
    expect(hotkeys.enabled()).toBe(false);
    expect(w.listeners.size).toBe(0);
  });

  it("the options page starts the box unticked, and the manifest gives no shortcut of its own", () => {
    const html = readFileSync(join(EXT, "options.html"), "utf8");
    const box = /<input id="hotkeys"[^>]*>/.exec(html)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).not.toMatch(/\bchecked\b/);
    const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.commands).toBeUndefined();
    expect(manifest.permissions).toEqual(["storage", "alarms", "scripting"]);
    // The listener is wired into the page script, not left unused.
    expect(readFileSync(join(EXT, "src", "content-bridge.ts"), "utf8")).toContain("installHotkeys(");
  });

  it("turns on and off while a tab is open, when the options page changes the setting", async () => {
    const t = await setup(undefined);
    t.change(true);
    expect(t.hotkeys.enabled()).toBe(true);
    expect(t.listeners.size).toBe(1);
    expect(t.press(KEY_FASTER).prevented).toBe(1);
    t.change(false);
    expect(t.hotkeys.enabled()).toBe(false);
    expect(t.listeners.size).toBe(0);
    expect(t.press(KEY_FASTER)).toEqual({ prevented: 0, stopped: 0 });
    expect(t.posted).toHaveLength(1);
  });

  it("ignores changes to other settings and to other storage areas, and never doubles the listener", async () => {
    const t = await setup(true);
    t.change(false, "sync");
    t.change(false, "local", "vjster.port");
    expect(t.hotkeys.enabled()).toBe(true);
    t.change(true);
    t.change(true);
    expect(t.listeners.size).toBe(1);
  });
});

describe("the keys and their intents (R-KEY-2)", () => {
  it("turns [ ] \\ into a step down, a step up and a reset, and every other key into nothing", () => {
    expect(hotkeyIntent(KEY_SLOWER, "hk-1", false)).toMatchObject({ type: "speed.step", delta: -0.25, target: "browser", v: 1, id: "hk-1" });
    expect(hotkeyIntent(KEY_FASTER, "hk-2", false)).toMatchObject({ type: "speed.step", delta: 0.25 });
    expect(hotkeyIntent(KEY_RESET, "hk-3", false)).toMatchObject({ type: "speed.reset" });
    for (const other of ["{", "}", "|", "a", "A", "1", "<", ">", ",", ".", " ", "Enter", "ArrowUp", "Shift", "Dead", ""]) {
      expect(hotkeyIntent(other, "hk-4", true), other).toBeNull();
    }
  });

  it("makes intents the adapter's own parser accepts, for both ranges", () => {
    for (const extended of [false, true]) {
      for (const k of [KEY_SLOWER, KEY_FASTER, KEY_RESET]) {
        const intent = hotkeyIntent(k, "hk-1", extended);
        expect(intent && readIntent(intent), `${k} ${extended}`).toEqual(intent);
      }
    }
  });

  it("posts the intent and takes the key, so the page's own shortcut does not fire too", async () => {
    const t = await setup(true);
    expect(t.press(KEY_FASTER)).toEqual({ prevented: 1, stopped: 1 });
    expect(t.press(KEY_SLOWER)).toEqual({ prevented: 1, stopped: 1 });
    expect(t.press(KEY_RESET)).toEqual({ prevented: 1, stopped: 1 });
    expect(t.posted.map((i) => i.type)).toEqual(["speed.step", "speed.step", "speed.reset"]);
    expect(t.posted.map((i) => i.id)).toEqual(["hk-1", "hk-2", "hk-3"]);
  });

  it("leaves every other key to the page", async () => {
    const t = await setup(true);
    for (const k of ["{", "a", "Enter", "Escape", " ", "ArrowRight"]) expect(t.press(k), k).toEqual({ prevented: 0, stopped: 0 });
    // A keydown a script made with no key at all (Chrome's autofill sends one): ignored, never an error.
    for (const k of [undefined, null, 5]) expect(() => t.press(k as unknown as string, { code: "BracketLeft" }), String(k)).not.toThrow();
    expect(hotkeyOf({ key: undefined as unknown as string, code: "BracketLeft" })).toBeNull();
    expect(t.posted).toEqual([]);
  });

  it("steps YouTube through its own player and any other site over the extended range", async () => {
    const youtube = await setup(true, "www.youtube.com");
    youtube.press(KEY_FASTER);
    expect(youtube.posted[0]).toMatchObject({ type: "speed.step", direct: false, hold: true });
    const other = await setup(true, "lectures.example.org");
    other.press(KEY_FASTER);
    expect(other.posted[0]).toMatchObject({ type: "speed.step", direct: true, hold: true });
  });

  it("lets a held step key keep stepping, but resets only once per press", async () => {
    const t = await setup(true);
    t.press(KEY_FASTER, { repeat: true });
    t.press(KEY_FASTER, { repeat: true });
    t.press(KEY_RESET, { repeat: true });
    expect(t.posted.map((i) => i.type)).toEqual(["speed.step", "speed.step"]);
  });
});

describe("hotkeys never take a key that is the page's own (R-KEY-3)", () => {
  it("ignores Ctrl, Alt and Command, but allows AltGr (some layouts type [ ] \\ with it)", async () => {
    const t = await setup(true);
    for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true, altKey: true }]) {
      expect(t.press(KEY_FASTER, mod), JSON.stringify(mod)).toEqual({ prevented: 0, stopped: 0 });
    }
    expect(t.posted).toEqual([]);
    // Windows reports AltGr as Ctrl and Alt together, with the AltGraph modifier on.
    expect(t.press(KEY_FASTER, { ctrlKey: true, altKey: true, altGraph: true }).prevented).toBe(1);
    // AltGr does not unlock the Command key.
    expect(t.press(KEY_FASTER, { metaKey: true, altGraph: true }).prevented).toBe(0);
    expect(t.posted).toHaveLength(1);
    // Alt with AltGr but without Ctrl (Linux reports AltGr that way) is AltGr too; Ctrl with AltGr is Windows' AltGr.
    expect(t.press(KEY_SLOWER, { altKey: true, altGraph: true }).prevented).toBe(1);
    // Shift alone does not stop a key whose character is still exactly [ ] \ (layouts that type them with Shift).
    expect(t.press(KEY_RESET, { shiftKey: true }).prevented).toBe(1);
    // Every modifier with Command or Ctrl (and no AltGr) is a shortcut of the page or the browser.
    for (const mod of [{ ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }, { metaKey: true, altKey: true }, { ctrlKey: true, metaKey: true }]) {
      expect(t.press(KEY_FASTER, mod), JSON.stringify(mod)).toEqual({ prevented: 0, stopped: 0 });
    }
    expect(t.posted).toHaveLength(3);
  });

  const MAC = { userAgentData: { platform: "macOS" }, platform: "MacIntel" };
  const MAC_OLD = { platform: "MacIntel" }; // Chrome before userAgentData, or with it turned off
  const WINDOWS = { userAgentData: { platform: "Windows" }, platform: "Win32" };
  const LINUX = { userAgentData: { platform: "Linux" }, platform: "Linux x86_64" };

  it("on a Mac takes [ ] \\ typed with Option (European layouts), and nothing else Option types", async () => {
    for (const nav of [MAC, MAC_OLD]) {
      const t = await setup(true, "www.youtube.com", 1, undefined, nav);
      // German: Option+5 types [, Option+6 types ], Shift+Option+7 types \ (Chrome on macOS reports Option as Alt, never AltGraph).
      expect(t.press(KEY_SLOWER, { altKey: true, code: "Digit5" }), JSON.stringify(nav)).toEqual({ prevented: 1, stopped: 1 });
      expect(t.press(KEY_FASTER, { altKey: true, code: "Digit6" }).prevented).toBe(1);
      expect(t.press(KEY_RESET, { altKey: true, shiftKey: true, code: "Digit7" }).prevented).toBe(1);
      expect(t.posted.map((i) => i.type)).toEqual(["speed.step", "speed.step", "speed.reset"]);
      // US layout: Option+[ types “ and Option+] types ‘, which are not the keys: left to the page.
      expect(t.press("“", { altKey: true, code: "BracketLeft" }).prevented).toBe(0);
      expect(t.press("‘", { altKey: true, code: "BracketRight" }).prevented).toBe(0);
      // Option with Command or Ctrl is still a shortcut.
      expect(t.press(KEY_FASTER, { altKey: true, metaKey: true }).prevented).toBe(0);
      expect(t.press(KEY_FASTER, { altKey: true, ctrlKey: true }).prevented).toBe(0);
      expect(t.posted).toHaveLength(3);
    }
  });

  it("does not relax Alt on Windows or Linux: Alt+[ there is a real Alt chord", async () => {
    for (const nav of [WINDOWS, LINUX, undefined]) {
      const t = await setup(true, "www.youtube.com", 1, undefined, nav);
      expect(t.press(KEY_SLOWER, { altKey: true }), JSON.stringify(nav)).toEqual({ prevented: 0, stopped: 0 });
      expect(t.press(KEY_FASTER, { altKey: true, shiftKey: true }).prevented).toBe(0);
      expect(t.posted).toEqual([]);
    }
  });

  // Layouts that do not type [ ] \ on those keys (R-KEY-2).
  it("on Russian and Ukrainian layouts takes the physical [ ] \\ keys, which type Cyrillic letters there", async () => {
    const t = await setup(true, "www.youtube.com");
    // Russian: BracketLeft types х, BracketRight ъ; Backslash still types \ (matched by its character).
    expect(t.press("х", { code: "BracketLeft" })).toEqual({ prevented: 1, stopped: 1 });
    expect(t.press("ъ", { code: "BracketRight" }).prevented).toBe(1);
    expect(t.press(KEY_RESET, { code: "Backslash" }).prevented).toBe(1);
    // Ukrainian: BracketRight types ї and Backslash types ґ.
    expect(t.press("х", { code: "BracketLeft" }).prevented).toBe(1);
    expect(t.press("ї", { code: "BracketRight" }).prevented).toBe(1);
    expect(t.press("ґ", { code: "Backslash" }).prevented).toBe(1);
    expect(t.posted.map((i) => i.type)).toEqual(["speed.step", "speed.step", "speed.reset", "speed.step", "speed.step", "speed.reset"]);
    expect(t.posted.map((i) => (i.type === "speed.step" ? Math.sign(i.delta) : 0))).toEqual([-1, 1, 0, -1, 1, 0]);
    // Caps Lock gives the capital letter on the same key: still the key.
    expect(t.press("Х", { code: "BracketLeft" }).prevented).toBe(1);
  });

  it("leaves Cyrillic typing to the page everywhere else: other keys, Shift, modifiers, text fields", async () => {
    const t = await setup(true, "www.youtube.com");
    // The same letters on other keys, and other letters.
    expect(t.press("х", { code: "KeyQ" }).prevented).toBe(0);
    expect(t.press("ж", { code: "Semicolon" }).prevented).toBe(0);
    expect(t.press("х").prevented).toBe(0); // no code at all
    // Shift on that key types a capital (Х): a shifted character, as { is on a US layout.
    expect(t.press("Х", { code: "BracketLeft", shiftKey: true }).prevented).toBe(0);
    // Russian Shift+Backslash types /: not a letter, not the key.
    expect(t.press("/", { code: "Backslash", shiftKey: true }).prevented).toBe(0);
    expect(t.press("х", { code: "BracketLeft", ctrlKey: true }).prevented).toBe(0);
    expect(t.press("х", { code: "BracketLeft", altKey: true }).prevented).toBe(0);
    // Nor with AltGr (Windows: Ctrl+Alt with AltGraph; Linux: Alt with AltGraph), nor Option on a Mac.
    expect(t.press("х", { code: "BracketLeft", ctrlKey: true, altKey: true, altGraph: true }).prevented).toBe(0);
    expect(t.press("х", { code: "BracketLeft", altKey: true, altGraph: true }).prevented).toBe(0);
    expect(t.press("х", { code: "BracketLeft", altGraph: true }).prevented).toBe(0);
    expect(t.press("х", { code: "BracketLeft", metaKey: true }).prevented).toBe(0);
    const mac = await setup(true, "www.youtube.com", 1, undefined, { userAgentData: { platform: "macOS" } });
    expect(mac.press("х", { code: "BracketLeft", altKey: true }).prevented).toBe(0);
    expect(mac.posted).toEqual([]);
    expect(t.press("х", { code: "BracketLeft", target: { tagName: "INPUT" } }).prevented).toBe(0);
    expect(t.press("х", { code: "BracketLeft", isComposing: true }).prevented).toBe(0);
    expect(t.posted).toEqual([]);
  });

  it("never takes Latin letters or symbols on those keys: German ü + #, French ^ $ *, Nordic å stay with the page", async () => {
    const t = await setup(true, "www.youtube.com");
    const latin: [string, string][] = [
      ["ü", "BracketLeft"], ["+", "BracketRight"], ["#", "Backslash"], // German QWERTZ
      ["Dead", "BracketLeft"], ["^", "BracketLeft"], ["$", "BracketRight"], ["*", "Backslash"], // French AZERTY
      ["å", "BracketLeft"], ["¨", "BracketRight"], ["'", "Backslash"], // Nordic
      ["`", "BracketLeft"], ["ñ", "Semicolon"], ["é", "Digit2"], ["a", "BracketLeft"]
    ];
    for (const [k, code] of latin) expect(t.press(k, { code }), `${k} ${code}`).toEqual({ prevented: 0, stopped: 0 });
    expect(t.posted).toEqual([]);
  });

  it("ignores typing in a text field, a text area, a drop-down, an editor, an ARIA text box, list or menu", async () => {
    const t = await setup(true);
    const editable: unknown[] = [
      { tagName: "INPUT" },
      { tagName: "input" },
      { tagName: "TEXTAREA" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
      { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "textbox" : null) },
      { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "searchbox" : null) },
      { tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "Combobox" : null) },
      // ARIA allows fallback roles, separated by spaces: any one of them that types makes the element a text field.
      ...["textbox combobox", "combobox textbox", "  searchbox  ", "widget\ttextbox", "button Menu"].map((role) => ({
        tagName: "DIV",
        getAttribute: (n: string) => (n === "role" ? role : null)
      })),
      ...["listbox", "option", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "spinbutton"].map((role) => ({
        tagName: "DIV",
        getAttribute: (n: string) => (n === "role" ? role : null)
      }))
    ];
    for (const target of editable) {
      expect(t.press(KEY_FASTER, { target }), JSON.stringify(Object.keys(target as object))).toEqual({ prevented: 0, stopped: 0 });
    }
    expect(t.posted).toEqual([]);
  });

  it("reads the focused element through an open shadow root, whose event target is only the host", async () => {
    const t = await setup(true);
    const host = { tagName: "YT-SEARCH" };
    const input = { tagName: "INPUT" };
    expect(t.press(KEY_FASTER, { target: host, composedPath: () => [input, host] }).prevented).toBe(0);
    // A path that starts at a plain element is not editable.
    expect(t.press(KEY_FASTER, { target: host, composedPath: () => [{ tagName: "DIV" }, host] }).prevented).toBe(1);
  });

  it("treats a page element that is not editable, a button or a player as free", () => {
    for (const free of [{ tagName: "BODY" }, { tagName: "VIDEO" }, { tagName: "BUTTON" }, { tagName: "DIV", isContentEditable: false }, {}, null, undefined, "text", 3]) {
      expect(isEditableTarget(free), JSON.stringify(free)).toBe(false);
    }
    for (const role of ["button", "slider", "button slider", "", "   ", "textboxes", "presentation none"]) {
      expect(isEditableTarget({ tagName: "DIV", getAttribute: (n: string) => (n === "role" ? role : null) }), role).toBe(false);
    }
  });

  it("ignores a key an input method is composing, and one the page already handled", async () => {
    const t = await setup(true);
    expect(t.press(KEY_FASTER, { isComposing: true }).prevented).toBe(0);
    expect(t.press(KEY_FASTER, { defaultPrevented: true }).prevented).toBe(0);
    expect(t.posted).toEqual([]);
  });

  it("takes nothing on a page with no video, and takes a key again once a video is there", async () => {
    const empty = await setup(true, "example.com", 0);
    expect(empty.press(KEY_FASTER)).toEqual({ prevented: 0, stopped: 0 });
    expect(empty.posted).toEqual([]);
    const later = await setup(true);
    expect(later.press(KEY_FASTER).prevented).toBe(1);
    // No document at all (a test window): nothing is searched, nothing is taken. readMediaFacts would also find no
    // video in a missing document (its search is wrapped), so the test checks the guard itself: no search was made.
    const bare = fakeWindow("example.com");
    const noDocument: HotkeyWindow = { ...bare.win, document: undefined };
    const posted: Intent[] = [];
    installHotkeys(noDocument, fakeStorage(true).storage, { post: (i) => void posted.push(i), newId: () => "hk-1" });
    await flush();
    expect(bare.listeners.size).toBe(1);
    mediaReads.docs.length = 0;
    const pressed = key(KEY_FASTER);
    for (const fn of bare.listeners) fn(pressed.event);
    expect(pressed.calls).toEqual({ prevented: 0, stopped: 0 });
    expect(posted).toEqual([]);
    expect(mediaReads.docs).toEqual([]);
  });

  it("lets go once the extension was updated under the page, so a new copy is not answered twice", async () => {
    const w = fakeWindow("example.com");
    const posted: Intent[] = [];
    let alive = true;
    const hotkeys = installHotkeys(w.win, fakeStorage(true).storage, { post: (i) => void posted.push(i), newId: () => "hk-1", alive: () => alive });
    await flush();
    const press = () => {
      const pressed = key(KEY_FASTER);
      for (const fn of [...w.listeners]) fn(pressed.event);
      return pressed.calls;
    };
    expect(press().prevented).toBe(1);
    alive = false;
    expect(press()).toEqual({ prevented: 0, stopped: 0 });
    expect(hotkeys.enabled()).toBe(false);
    expect(w.listeners.size).toBe(0);
    expect(posted).toHaveLength(1);
  });
});

describe("hotkeys follow \"Control videos on every site\" away from YouTube (R-KEY-3, D-4)", () => {
  it("stays on when the option was never touched (it is on unless unticked), and on when ticked", async () => {
    const never = await setup(true, "lectures.example.org");
    expect(never.hotkeys.enabled()).toBe(true);
    const ticked = await setup(true, "lectures.example.org", 1, true);
    expect(ticked.hotkeys.enabled()).toBe(true);
  });

  it("installs nothing away from YouTube while that option is unticked, even with the hotkeys on", async () => {
    const t = await setup(true, "lectures.example.org", 1, false);
    expect(t.hotkeys.enabled()).toBe(false);
    expect(t.listeners.size).toBe(0);
    expect(t.press(KEY_FASTER)).toEqual({ prevented: 0, stopped: 0 });
    expect(t.posted).toEqual([]);
  });

  it("ends in a tab that was already open when the option is unticked, and returns when it is ticked again", async () => {
    const t = await setup(true, "lectures.example.org");
    expect(t.press(KEY_FASTER).prevented).toBe(1);
    t.change(false, "local", ALL_SITES_KEY);
    expect(t.hotkeys.enabled()).toBe(false);
    expect(t.listeners.size).toBe(0);
    expect(t.press(KEY_FASTER)).toEqual({ prevented: 0, stopped: 0 });
    t.change(true, "local", ALL_SITES_KEY);
    expect(t.hotkeys.enabled()).toBe(true);
    expect(t.press(KEY_FASTER).prevented).toBe(1);
    expect(t.posted).toHaveLength(2);
  });

  it("is not touched by that option on YouTube, and still needs its own tick everywhere", async () => {
    const youtube = await setup(true, "www.youtube.com", 1, false);
    expect(youtube.hotkeys.enabled()).toBe(true);
    youtube.change(false, "local", ALL_SITES_KEY);
    expect(youtube.hotkeys.enabled()).toBe(true);
    const off = await setup(undefined, "lectures.example.org", 1, true);
    expect(off.hotkeys.enabled()).toBe(false);
    off.change(true, "local", ALL_SITES_KEY);
    expect(off.hotkeys.enabled()).toBe(false);
  });
});

describe("a taken key goes no further (R-KEY-3)", () => {
  it("stops a window handler added after ours, in a real event dispatch, and lets other keys through", async () => {
    const target = new EventTarget();
    const win = {
      location: { hostname: "example.com" },
      document: documentWith(1),
      // `never`, not the DOM's EventListener: the repository's root tsc has no DOM types, and the handler only needs to be called.
      addEventListener: (type: string, fn: unknown, capture: boolean) => target.addEventListener(type, fn as never, capture),
      removeEventListener: (type: string, fn: unknown, capture: boolean) => target.removeEventListener(type, fn as never, capture)
    } as unknown as HotkeyWindow;
    const posted: Intent[] = [];
    installHotkeys(win, fakeStorage(true).storage, { post: (i) => void posted.push(i), newId: () => "hk-1" });
    await flush();
    let competitor = 0;
    target.addEventListener("keydown", () => void competitor++, true);
    const keydown = (k: string) => {
      const event = new Event("keydown", { cancelable: true });
      for (const [name, value] of Object.entries({ key: k, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false })) {
        Object.defineProperty(event, name, { value });
      }
      target.dispatchEvent(event);
      return event;
    };
    const taken = keydown("]");
    expect(taken.defaultPrevented).toBe(true);
    expect(competitor).toBe(0);
    expect(posted).toHaveLength(1);
    const other = keydown("a");
    expect(other.defaultPrevented).toBe(false);
    expect(competitor).toBe(1);
  });

  it("makes no message id for a key that is not one of the three, however many are typed", async () => {
    let made = 0;
    const w = fakeWindow("example.com");
    installHotkeys(w.win, fakeStorage(true).storage, { post: () => undefined, newId: () => `hk-${++made}` });
    await flush();
    for (let i = 0; i < 200; i++) for (const fn of [...w.listeners]) fn(key(i % 2 ? "a" : "Enter").event);
    expect(made).toBe(0);
    for (const fn of [...w.listeners]) fn(key(KEY_FASTER).event);
    expect(made).toBe(1);
  });
});

describe("hotkeys reach the page's adapter like any intent (R-KEY-4)", () => {
  it("goes through the bridge to the page as an intent message the adapter accepts", () => {
    const posted: { message: unknown; origin: string }[] = [];
    const win = {
      location: { hostname: "example.com", origin: "https://example.com" },
      addEventListener: () => undefined,
      postMessage: (message: unknown, origin: string) => void posted.push({ message, origin })
    } as unknown as BridgeWindow;
    const runtime: BridgeRuntime = { sendMessage: () => Promise.resolve(), onMessage: { addListener: () => undefined } };
    const bridge = installBridge(win, runtime);
    const intent = hotkeyIntent(KEY_FASTER, "hk-1", true)!;
    bridge.intentToPage(intent);
    expect(posted).toHaveLength(1);
    expect(posted[0].origin).toBe("https://example.com");
    expect(posted[0].message).toMatchObject({ source: FROM_BRIDGE, kind: "intent", intent });
    expect(readBridgeMessage(posted[0].message)).toMatchObject({ kind: "intent", intent });
  });

  /** A plain video element at `rate`, driven by a real adapter, as on a lecture site. */
  function lecture(rate: number) {
    const video: PlayableVideo = { playbackRate: rate, paused: false, ended: false, play: () => Promise.resolve(), pause: () => undefined };
    const reports: Report[] = [];
    const adapter = new Adapter(() => videoControl(() => video), (report) => void reports.push(report));
    const press = (k: string, extended = true) => adapter.handle(hotkeyIntent(k, "hk-1", extended)!);
    return { video, reports, press };
  }

  it("steps a plain video by a quarter, past the 2x a plain video's own range would stop at, and resets to 1x", () => {
    const l = lecture(1);
    l.press(KEY_FASTER);
    expect(l.video.playbackRate).toBe(1.25);
    l.press(KEY_SLOWER);
    l.press(KEY_SLOWER);
    expect(l.video.playbackRate).toBe(0.75);
    const fast = lecture(2);
    fast.press(KEY_FASTER);
    expect(fast.video.playbackRate).toBe(2.25);
    for (let i = 0; i < 80; i++) fast.press(KEY_FASTER);
    expect(fast.video.playbackRate).toBe(16);
    fast.press(KEY_RESET);
    expect(fast.video.playbackRate).toBe(1);
    expect(fast.reports.at(-1)).toMatchObject({ kind: "state", state: { rate: 1 } });
  });

  it("with the player's own range (YouTube), a plain video stops at 2x", () => {
    const l = lecture(2);
    l.press(KEY_FASTER, false);
    expect(l.video.playbackRate).toBe(2);
  });
});
