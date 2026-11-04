// SPDX-License-Identifier: GPL-2.0-or-later
// The VJster settings page in a small stand-in DOM (tests/vjster-pi.test.ts,
// tests/vjster-pi-language.test.ts): its own elements from vjster.html, the
// generated ui/i18n.js and vjster.js run in a fresh context, and a pretend
// Stream Deck socket that records what the page sends.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { PI_STRINGS_FILE } from "../../scripts/vjster/make-pi-strings.js";
import { PLUGIN_DIR } from "../vjster-languages.js";

export const html = readFileSync(join(PLUGIN_DIR, "ui", "vjster.html"), "utf8");
export const js = readFileSync(join(PLUGIN_DIR, "ui", "vjster.js"), "utf8");
// A Windows checkout may have CRLF line endings; compare as stored (LF).
export const i18n = readFileSync(PI_STRINGS_FILE, "utf8").replace(/\r\n/g, "\n");

export interface FakeElement {
  tag: string;
  id: string;
  attrs: Record<string, string>;
  children: FakeElement[];
  textContent: string;
  value: string;
  checked: boolean;
  className: string;
  listeners: Record<string, ((e: unknown) => void)[]>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  appendChild(c: FakeElement): FakeElement;
  select(): void;
}

export function element(tag: string, attrs: Record<string, string> = {}): FakeElement {
  const e: FakeElement = {
    tag,
    id: attrs.id ?? "",
    attrs: { ...attrs },
    children: [],
    value: "",
    checked: false,
    className: attrs.class ?? "",
    listeners: {},
    get textContent() {
      return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this.attrs["\u0000text"] ?? "";
    },
    set textContent(v: string) {
      this.children = [];
      this.attrs["\u0000text"] = v;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    select() {}
  } as FakeElement;
  return e;
}

export interface LoadOptions {
  /** Changes the generated text tables before the page reads them (malformed translations). */
  patchStrings?(tables: Record<string, { pi: Record<string, string>; deck: Record<string, string> }>): void;
  /** Run the page as the suite plugin shows it (ui/vjster/suite.js sets this before vjster.js runs). */
  suite?: boolean;
}

/** Load the page in a fresh context; returns the document, what it sent, and a way to talk to it. */
export function loadPage(language: string, action: string, settings: Record<string, unknown> = {}, options: LoadOptions = {}) {
  const all: FakeElement[] = [];
  // The page's own elements: every tag with an id or a data-i18n attribute, with its English text.
  for (const m of html.matchAll(/<([a-z0-9]+)((?:\s+[a-z0-9-]+(?:="[^"]*")?)*)\s*\/?>(?:([^<]*)<\/\1>)?/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([a-z0-9-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? "";
    if (!attrs.id && !("data-i18n" in attrs) && !("data-i18n-placeholder" in attrs)) continue;
    const e = element(m[1], attrs);
    e.textContent = m[3] ?? "";
    all.push(e);
  }
  const root = element("html", { lang: "en" });
  const sent: Record<string, unknown>[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    send(data: string) {
      sent.push(JSON.parse(data));
    }
  }
  let socket: FakeSocket | null = null;
  const window: Record<string, unknown> = { setTimeout: () => 0 };
  const document = {
    documentElement: root,
    /** The focused element; a test sets it to put the operator in a box. */
    activeElement: null as FakeElement | null,
    getElementById: (id: string) => all.find((e) => e.id === id) ?? null,
    createElement: (tag: string) => element(tag),
    querySelectorAll: (sel: string) => {
      const attr = /^\[([a-z0-9-]+)\]$/.exec(sel)?.[1];
      return attr ? all.filter((e) => e.getAttribute(attr) !== null) : [];
    }
  };
  const context = {
    window,
    document,
    navigator: {},
    WebSocket: function (this: unknown) {
      socket = new FakeSocket();
      return socket;
    } as unknown,
    JSON,
    Object,
    String,
    Number
  };
  (context.WebSocket as { OPEN: number }).OPEN = 1;
  runInNewContext(i18n, context);
  options.patchStrings?.(window.VJSTER_PI_STRINGS as Parameters<NonNullable<LoadOptions["patchStrings"]>>[0]);
  if (options.suite) window.VJSTER_SUITE = { prefix: "com.jbrick2070.fadester-for-obs.vjster-", namespace: "vjster" };
  runInNewContext(js, context);
  const info = JSON.stringify({ application: { language } });
  const actionInfo = JSON.stringify({ action: `${options.suite ? "com.jbrick2070.fadester-for-obs.vjster-" : "com.jbrick2070.vjster."}${action}`, payload: { settings } });
  (window.connectElgatoStreamDeckSocket as (...a: unknown[]) => void)(1, "ctx", "registerPropertyInspector", info, actionInfo);
  const fields = all.find((e) => e.id === "fields")!;
  const toPage = (payload: Record<string, unknown>) => socket!.onmessage!({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
  const byId = (id: string) => all.find((e) => e.id === id)!;
  const fromDeck = (message: Record<string, unknown>) => socket!.onmessage!({ data: JSON.stringify(message) });
  return { root, fields, sent, toPage, fromDeck, byId, all, document };
}

/** Every text in the rendered fields, depth first. */
export function fieldTexts(e: FakeElement): string[] {
  const own = e.children.length === 0 && e.textContent ? [e.textContent] : [];
  return [...own, ...e.children.flatMap(fieldTexts)];
}
