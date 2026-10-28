// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// A small DOM model executes the shipped inspector script, including delayed
// callbacks and bubbling form events. It needs no browser or OBS process.
class Element {
  id = "";
  type = "";
  className = "";
  htmlFor = "";
  checked = false;
  disabled = false;
  selected = false;
  open = true;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  checkbox?: Element;
  parent?: Element;
  children: Element[] = [];
  listeners = new Map<string, Array<() => void>>();
  private text = "";
  private rawValue = "";

  constructor(public tag: string) {}
  appendChild(child: Element): Element {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  set innerHTML(_value: string) { this.children = []; this.text = ""; }
  set textContent(value: string) { this.text = value; this.children = []; }
  get textContent(): string { return this.text + this.children.map((x) => x.textContent).join(""); }
  get options(): Element[] { return this.descendants().filter((x) => x.tag === "option"); }
  get value(): string {
    return this.tag === "select"
      ? (this.options.find((x) => x.selected) ?? this.options[0])?.value ?? ""
      : this.rawValue;
  }
  set value(value: string) {
    this.rawValue = String(value);
    if (this.tag === "select") this.options.forEach((x) => { x.selected = x.value === this.rawValue; });
  }
  descendants(): Element[] { return this.children.flatMap((x) => [x, ...x.descendants()]); }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]);
  }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
    if (type === "input" || type === "change") this.parent?.fire(type);
  }
}

type RecordValue = Record<string, any>;
const overview = {
  filter_hosts: [{ source: "A", filter_count: 1 }, { source: "B", filter_count: 1 }],
  scenes: [], audio_sources: []
};
function detail(source: string): RecordValue {
  return { filters: [{ name: `${source} Filter`, enabled: true, properties: [
    { name: "amount", label: "Amount", min: 0, max: 100, suffix: "%", current: 40 }
  ] }] };
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((r) => { resolve = r; }), resolve: (value) => resolve(value) };
}
async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

function harness() {
  const root = new Element("body");
  const add = (id: string, tag = "div", parent = root): Element => {
    const el = new Element(tag); el.id = id; parent.appendChild(el); return el;
  };
  const editor = add("assign-editor", "details");
  add("assign-mode", "select", editor);
  add("assign-fields", "div", editor);
  add("assign-result", "div", editor);
  add("assign-draft", "div", editor);
  add("assign-apply", "button", editor);
  add("assign-refresh", "button", editor);
  add("assign-discard", "button", editor);
  add("assign-sentence");
  add("ctrl-status");
  add("profile-select", "select");
  add("profile-load", "button");
  add("profile-result");
  const document = {
    activeElement: null as Element | null,
    createElement: (tag: string) => new Element(tag),
    getElementById: (id: string) => root.descendants().find((x) => x.id === id) ?? null
  };
  const window: RecordValue = {};
  const source = readFileSync("com.jbrick2070.fadester-for-obs.sdPlugin/ui/pi-common.js", "utf8");
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.testApi = { renderModeFields, collectSetSlotFields, validateFields, refreshCatalog,
      refreshEditor, bindEditor, bindControllerPanel, updateControllerPanel, markEditorDirty,
      applyState, applySlotValue, resetEditorContext,
      configure(state, slot, catalog) { lastState = state; currentSettings = { slot }; overviewCatalog = catalog; },
      requestWith(fn) { request = fn; },
      isDirty() { return editorDirty; }
    };
  })();`);
  runInNewContext(instrumented, { window, document, setTimeout, clearTimeout });
  const state: RecordValue = {
    status: { kind: "connected" }, connection: { host: "127.0.0.1", port: 4455 }, capabilities: { catalog: true },
    profile: { slug: "apc40mk2" }, device: {}, studioMode: true,
    knownProfiles: [{ slug: "apc40mk2", displayName: "APC40", tierLabel: "Verified" },
      { slug: "midimix", displayName: "MIDImix", tierLabel: "Beta" }],
    targetModes: [{ id: "filter_param", label: "Filter setting" }], curves: [],
    slots: ["fx_1", "fx_2"].map((id) => ({
      id, enabled: true, target_mode: "filter_param", source_a: "A",
      filter_name: "A Filter", filter_prop: "amount", from_val: 10, to_val: 80,
      bypass_at_zero: true, cal_min: 0, cal_max: 127
    }))
  };
  const api = window.testApi;
  api.configure(state, "fx_1", overview);
  api.requestWith(async (msg: RecordValue) => ({ data: msg.source ? detail(msg.source) : overview }));
  api.bindEditor();
  api.bindControllerPanel();
  api.refreshEditor(state);
  const el = (id: string): Element => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing test element '${id}'.`);
    return found;
  };
  const change = (id: string, value: string): void => { el(id).value = value; el(id).fire("input"); el(id).fire("change"); };
  return { api, state, el, change, document };
}

describe("Property Inspector DOM behavior", () => {
  it("preserves a single entered bound and sends explicit full-range values", async () => {
    const h = harness(); await flush();
    h.change("af-from", "25"); h.change("af-to", "");
    let fields = h.api.collectSetSlotFields("filter_param");
    expect(fields.from_val).toBe(25);
    expect(fields).not.toHaveProperty("to_val");
    expect(h.api.validateFields("filter_param", fields)).toBe("");
    h.el("af-full-range").fire("click");
    fields = h.api.collectSetSlotFields("filter_param");
    expect(fields).toMatchObject({ from_val: 0, to_val: 100 });
    expect(h.el("af-range-hint").textContent).toContain("Blank bounds keep the existing range");
  });

  it("ignores obsolete source responses and displays catalog errors beside the picker", async () => {
    const h = harness();
    const a = deferred<RecordValue>(); const b = deferred<RecordValue>();
    h.api.requestWith((msg: RecordValue) => msg.source === "A" ? a.promise : b.promise);
    h.api.renderModeFields("filter_param");
    h.change("af-source-a", "B");
    b.resolve({ data: detail("B") }); await flush();
    a.resolve({ data: detail("A") }); await flush();
    expect(h.el("af-filter").options.map((x) => x.value)).toEqual(["", "B Filter"]);
    h.api.requestWith(async () => ({ error: "No reply from the plugin after 6 s." }));
    h.change("af-source-a", "A"); await flush();
    expect(h.el("af-catalog-error").textContent).toBe("No reply from the plugin after 6 s.");
    expect(h.el("af-filter").options.map((x) => x.value)).toEqual(["", "B Filter"]);
  });

  it("retains edits when a delayed overview arrives and when lists refresh", async () => {
    const h = harness(); await flush();
    const reply = deferred<RecordValue>();
    h.api.requestWith((msg: RecordValue) => msg.source ? Promise.resolve({ data: detail(msg.source) }) : reply.promise);
    const pending = h.api.refreshCatalog(true);
    h.change("af-from", "27");
    reply.resolve({ data: overview }); await pending; await flush();
    expect(h.el("af-from").value).toBe("27");
    expect(h.api.isDirty()).toBe(true);
    h.api.applyState(h.state);
    expect(h.el("af-from").value).toBe("27");
  });

  it("does not clear newer edits or a different slot draft on delayed apply replies", async () => {
    const h = harness(); await flush();
    const reply = deferred<RecordValue>(); h.api.requestWith(() => reply.promise);
    h.change("af-from", "25"); h.el("assign-apply").fire("click");
    h.change("af-from", "30");
    reply.resolve({ ok: true, label: "Applied earlier value" }); await flush();
    expect(h.el("af-from").value).toBe("30");
    expect(h.api.isDirty()).toBe(true);
    const oldReply = deferred<RecordValue>(); h.api.requestWith(() => oldReply.promise);
    h.el("assign-apply").fire("click");
    h.api.configure(h.state, "fx_2", overview); h.api.resetEditorContext(); h.api.refreshEditor(h.state);
    h.change("af-from", "45");
    oldReply.resolve({ ok: true, label: "Wrong slot" }); await flush();
    expect(h.el("af-from").value).toBe("45");
    expect(h.el("assign-result").textContent).not.toContain("Wrong slot");
    expect(h.api.isDirty()).toBe(true);
  });

  it("preserves a pending profile selection on state broadcasts and during load", async () => {
    const h = harness(); await flush();
    h.api.updateControllerPanel(h.state);
    h.change("profile-select", "midimix");
    h.api.updateControllerPanel(h.state);
    expect(h.el("profile-select").value).toBe("midimix");
    const reply = deferred<RecordValue>(); h.api.requestWith(() => reply.promise);
    h.el("profile-load").fire("click"); h.api.updateControllerPanel(h.state);
    expect(h.el("profile-load").disabled).toBe(true);
    reply.resolve({ ok: true, loaded: "midimix" }); await flush();
  });

  it("refreshes the live sentence without replacing an unsaved field", async () => {
    const h = harness(); await flush();
    h.change("af-from", "29");
    const field = h.el("af-from");
    h.api.applySlotValue({ slot: "fx_1", value: 0.63, display_value: "63 %" });
    expect(h.el("assign-sentence").textContent).toContain("now 63 %");
    expect(h.el("af-from")).toBe(field);
    expect(field.value).toBe("29");
    expect(h.api.isDirty()).toBe(true);
  });

  it("sends only enabled for an unchanged unavailable binding and labels the checkbox input", async () => {
    const h = harness(); await flush();
    h.el("af-enabled").checkbox!.checked = false;
    expect(h.api.collectSetSlotFields("filter_param")).toEqual({ enabled: false });
    expect(h.api.validateFields("filter_param", { enabled: false })).toBe("");
    const row = h.el("af-bypass").parent!;
    expect(row.children[0].htmlFor).toBe(h.el("af-bypass").checkbox!.id);
    expect(h.api.validateFields("filter_param", { cal_min: 127, cal_max: 0 })).toBe("Calibration maximum must be greater than minimum.");
  });

  it("preserves a disabled slot when changing its target mode", async () => {
    const h = harness(); await flush();
    const disabled = structuredClone(h.state);
    disabled.slots[0].enabled = false;
    h.api.configure(disabled, "fx_1", overview);
    h.api.resetEditorContext();
    h.api.refreshEditor(disabled); await flush();
    h.api.renderModeFields("unassigned");
    expect(h.el("af-enabled").checkbox!.checked).toBe(false);
    expect(h.api.collectSetSlotFields("unassigned")).toEqual({ target_mode: "unassigned", enabled: false });
  });

  it("can disable an existing filter while its overview is missing or fails to load", async () => {
    const h = harness(); await flush();
    const reply = deferred<RecordValue>();
    h.api.configure(h.state, "fx_1", null);
    h.api.requestWith(() => reply.promise);
    h.api.refreshEditor(h.state);
    expect(h.document.getElementById("af-filter")).toBeNull();
    h.el("af-enabled").checkbox!.checked = false;
    h.el("af-enabled").checkbox!.fire("input");
    expect(h.api.collectSetSlotFields("filter_param")).toEqual({ enabled: false });
    reply.resolve({ error: "OBS did not return a catalog." }); await flush();
    expect(h.api.collectSetSlotFields("filter_param")).toEqual({ enabled: false });
    expect(h.api.validateFields("filter_param", { enabled: false })).toBe("");
    expect(h.el("assign-result").textContent).toBe("OBS did not return a catalog.");
    expect(h.el("assign-result").attributes).toMatchObject({ role: "status", "aria-live": "polite" });
  });

  it("does not resend calibration widened elsewhere during an unrelated range edit", async () => {
    const h = harness(); await flush();
    h.change("af-from", "25");
    const widened = structuredClone(h.state);
    widened.slots[0].cal_max = 16383;
    h.api.applyState(widened);
    expect(h.el("af-cal-max").value).toBe("127");
    expect(h.api.collectSetSlotFields("filter_param")).toEqual({ from_val: 25 });
    expect(h.el("assign-apply").disabled).toBe(false);
    const rebound = structuredClone(widened);
    rebound.slots[0].source_a = "B";
    h.api.applyState(rebound);
    expect(h.el("assign-apply").disabled).toBe(true);
    expect(h.el("assign-result").textContent).toContain("assignment changed on another surface");
    expect(h.el("af-from").value).toBe("25");
  });

  it("invalidates cached catalogs and old replies on endpoint switches and reconnects", async () => {
    const h = harness(); await flush();
    h.change("af-from", "27");
    const oldReply = deferred<RecordValue>();
    h.api.requestWith(() => oldReply.promise);
    const oldRefresh = h.api.refreshCatalog(true);
    const calls: RecordValue[] = [];
    const newOverview = { ...overview, filter_hosts: [{ source: "A", filter_count: 1 }] };
    h.api.requestWith(async (msg: RecordValue) => {
      calls.push(msg);
      return { data: msg.source ? detail("New server") : newOverview };
    });
    const next = structuredClone(h.state); next.connection.port = 4456;
    h.api.applyState(next); await flush(); await flush();
    expect(calls.filter((x) => !x.source)).toHaveLength(1);
    expect(calls.filter((x) => x.source === "A")).toHaveLength(1);
    expect(h.el("af-filter").options.map((x) => x.value)).toContain("New server Filter");
    expect(h.el("af-from").value).toBe("27");
    oldReply.resolve({ data: overview }); await oldRefresh; await flush();
    expect(h.el("af-filter").options.map((x) => x.value)).toContain("New server Filter");
    const offline = structuredClone(next); offline.status.kind = "disconnected";
    h.api.applyState(offline); await flush();
    expect(calls.filter((x) => !x.source)).toHaveLength(1);
    h.api.applyState(next); await flush(); await flush();
    expect(calls.filter((x) => !x.source)).toHaveLength(2);
    expect(calls.filter((x) => x.source === "A")).toHaveLength(2);
  });
});
