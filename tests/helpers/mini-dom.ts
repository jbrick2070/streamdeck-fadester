// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A small DOM for the vm tests that run a whole settings page: its markup
 * (parsed, `innerHTML` included), `getElementById`, attribute selectors,
 * `textContent`, form values, `<details open>` and `<html lang>`. Enough for
 * the shipped inspectors; not a browser.
 */

const VOID = new Set(["input", "meta", "link", "br", "img", "hr"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name] ?? whole;
  });
}

export class MiniText {
  public parent?: MiniElement;
  public constructor(public data: string) {}
  get textContent(): string { return this.data; }
}

type Child = MiniElement | MiniText;

export class MiniElement {
  public parent?: MiniElement;
  public childNodes: Child[] = [];
  public style: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public onchange?: () => void;
  public onclick?: () => void;
  public oninput?: () => void;
  public disabled = false;
  public checked = false;
  public open = false;
  private attrs = new Map<string, string>();
  private ownValue?: string;
  private selectedFlag?: boolean;

  public constructor(public readonly tag: string) {}

  get tagName(): string { return this.tag.toUpperCase(); }
  get children(): MiniElement[] { return this.childNodes.filter((node): node is MiniElement => node instanceof MiniElement); }
  get firstChild(): Child | undefined { return this.childNodes[0]; }

  getAttribute(name: string): string | null { return this.attrs.has(name) ? this.attrs.get(name)! : null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
    if (name === "open") this.open = true;
  }

  get id(): string { return this.getAttribute("id") ?? ""; }
  get className(): string { return this.getAttribute("class") ?? ""; }
  set className(value: string) { this.setAttribute("class", value); }
  get lang(): string { return this.getAttribute("lang") ?? ""; }
  set lang(value: string) { this.setAttribute("lang", value); }
  get placeholder(): string { return this.getAttribute("placeholder") ?? ""; }
  set placeholder(value: string) { this.setAttribute("placeholder", value); }

  appendChild<T extends Child>(child: T): T {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: Child): Child {
    this.childNodes = this.childNodes.filter((node) => node !== child);
    child.parent = undefined;
    return child;
  }

  get textContent(): string { return this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(value: string) {
    for (const node of this.childNodes) node.parent = undefined;
    this.childNodes = [];
    if (value !== "") this.appendChild(new MiniText(String(value)));
  }
  set innerHTML(html: string) {
    this.textContent = "";
    parseInto(this, html);
  }

  descendants(): MiniElement[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector: string): MiniElement[] {
    const match = /^([a-z0-9]*)(?:\[([a-z0-9-]+)(?:="([^"]*)")?\])?$/i.exec(selector.trim());
    if (!match) throw new Error(`mini-dom: unsupported selector ${selector}`);
    const [, tag, attribute, value] = match;
    return this.descendants().filter((node) => (!tag || node.tag === tag.toLowerCase())
      && (!attribute || (node.hasAttribute(attribute) && (value === undefined || node.getAttribute(attribute) === value))));
  }
  querySelector(selector: string): MiniElement | null { return this.querySelectorAll(selector)[0] ?? null; }

  get options(): MiniElement[] { return this.descendants().filter((node) => node.tag === "option"); }
  get selected(): boolean {
    if (this.selectedFlag !== undefined) return this.selectedFlag;
    return this.hasAttribute("selected");
  }
  set selected(value: boolean) {
    const select = this.ancestor("select");
    if (value && select) for (const option of select.options) option.selectedFlag = false;
    this.selectedFlag = value;
  }
  get value(): string {
    if (this.tag === "select") {
      const options = this.options;
      const chosen = options.find((option) => option.selected);
      if (chosen) return chosen.value;
      return options.some((option) => option.selectedFlag === false) && options.every((option) => option.selectedFlag === false)
        ? "" : options[0]?.value ?? "";
    }
    if (this.tag === "option") return this.getAttribute("value") ?? this.textContent;
    return this.ownValue ?? this.getAttribute("value") ?? "";
  }
  set value(value: string) {
    const text = String(value);
    if (this.tag === "select") {
      for (const option of this.options) option.selectedFlag = option.value === text;
      return;
    }
    if (this.tag === "option") {
      this.setAttribute("value", text);
      return;
    }
    this.ownValue = text;
  }
  /** The text of the chosen option of a `<select>`, as the operator sees it. */
  get shownText(): string {
    return this.options.find((option) => option.selected)?.textContent ?? "";
  }
  private ancestor(tag: string): MiniElement | undefined {
    let node = this.parent;
    while (node && node.tag !== tag) node = node.parent;
    return node;
  }
}

function parseAttributes(element: MiniElement, source: string): void {
  for (const match of source.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) {
    element.setAttribute(match[1], decode(match[2] ?? ""));
  }
}

/** Parses markup (no scripts, styles or comments expected inside) into `parent`. */
export function parseInto(parent: MiniElement, html: string): void {
  let current = parent;
  for (const match of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    const [, closing, name, attributes, text] = match;
    if (text !== undefined) {
      current.appendChild(new MiniText(decode(text)));
      continue;
    }
    const tag = name.toLowerCase();
    if (closing) {
      let node: MiniElement | undefined = current;
      while (node && node !== parent && node.tag !== tag) node = node.parent;
      if (node && node !== parent) current = node.parent!;
      continue;
    }
    const element = new MiniElement(tag);
    parseAttributes(element, attributes.replace(/\/\s*$/, ""));
    current.appendChild(element);
    if (!VOID.has(tag) && !/\/\s*$/.test(attributes)) current = element;
  }
}

export interface MiniDocument {
  documentElement: MiniElement;
  body: MiniElement;
  activeElement: MiniElement | null;
  getElementById(id: string): MiniElement | null;
  querySelectorAll(selector: string): MiniElement[];
  querySelector(selector: string): MiniElement | null;
  createElement(tag: string): MiniElement;
  createTextNode(text: string): MiniText;
}

/** A document from a whole page: `<html lang>` and the body's markup, with comments and scripts left out. */
export function documentFromPage(html: string): MiniDocument {
  const documentElement = new MiniElement("html");
  documentElement.lang = /<html[^>]*\blang="([^"]*)"/.exec(html)?.[1] ?? "";
  const body = documentElement.appendChild(new MiniElement("body"));
  const inner = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  parseInto(body, inner.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, ""));
  return {
    documentElement,
    body,
    activeElement: null,
    getElementById: (id) => documentElement.descendants().find((node) => node.id === id) ?? null,
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    querySelector: (selector) => documentElement.querySelector(selector),
    createElement: (tag) => new MiniElement(tag.toLowerCase()),
    createTextNode: (text) => new MiniText(text)
  };
}
