// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { inspectorPageScript } from "./helpers/inspector-scripts.js";

type Item = { value: string; text: string };
type Fill = { items: Item[]; selected: string; placeholder: string };

/** Runs the shipped Playlister inspector's inline callback with an observed OBS state (PLAN.md 9.4). */
function inspector() {
  const html = readFileSync("com.jbrick2070.fadester-for-obs.sdPlugin/ui/playlister-transport-key.html", "utf8");
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", className: "", style: {} as Record<string, string>,
    onchange: undefined as (() => void) | undefined, onclick: undefined as (() => void) | undefined
  }]));
  const fills = new Map<string, Fill>();
  const saved: Array<Record<string, unknown>> = [];
  let refreshes = 0;
  let render!: (settings: Record<string, unknown>, save: (patch: Record<string, unknown>) => void, state: Record<string, unknown>) => void;
  runInNewContext(inspectorPageScript(html), {
    document: { activeElement: null, getElementById: (id: string) => elements.get(id) },
    window: {
      initDirectObsPropertyInspector: (callback: typeof render) => { render = callback; },
      directObsFillSelect: (element: { value: string }, items: Item[], selected: string, placeholder: string) => {
        const id = [...elements].find(([, entry]) => entry === element)?.[0] ?? "";
        element.value = selected;
        fills.set(id, { items, selected, placeholder });
      },
      directObsRefresh: () => { refreshes++; }
    }
  });
  return {
    render: (settings: Record<string, unknown>, state: Record<string, unknown>) => render(settings, (patch) => saved.push(patch), state),
    fill: (id: string) => fills.get(id)!,
    text: (id: string) => elements.get(id)!.textContent,
    shown: (id: string) => elements.get(id)!.style.display !== "none",
    className: (id: string) => elements.get(id)!.className,
    value: (id: string) => elements.get(id)!.value,
    change: (id: string, value: string) => { const element = elements.get(id)!; element.value = value; element.onchange?.(); },
    click: (id: string) => elements.get(id)!.onclick?.(),
    saved, refreshes: () => refreshes
  };
}

const desktop = { inputUuid: "uuid-desktop", inputName: "Desktop Audio", inputKind: "wasapi_output_capture", unversionedInputKind: "wasapi_output_capture" };
const reel = { inputUuid: "uuid-reel", inputName: "Reel", inputKind: "obs_playlister_source", unversionedInputKind: "obs_playlister_source" };
// An older listing without unversionedInputKind: the versioned kind decides, either way.
const old = { inputUuid: "uuid-old", inputName: "Old reel", inputKind: "obs_playlister_source_v2" };
const oldMedia = { inputUuid: "uuid-old-media", inputName: "Old clip", inputKind: "ffmpeg_source_v2" };
const connected = (inputDetails: unknown[], mediaCapability = "ok"): Record<string, unknown> =>
  ({ status: { kind: "connected" }, catalog: { inputDetails }, mediaCapability });

describe("Playlister transport inspector", () => {
  it("lists only Playlister sources by UUID with names for display, saves operation and inputUuid, and shows each banner", () => {
    const h = inspector();
    // Before the first state arrives the page renders without throwing and promises nothing.
    h.render({}, null as never);
    expect(h.fill("playlister-source").items).toEqual([]);
    expect(h.shown("playlister-status")).toBe(true);
    h.render({ inputUuid: "uuid-reel", inputName: "Reel" }, null as never);
    expect(h.fill("playlister-source").items).toEqual([{ value: "uuid-reel", text: "Reel (not in OBS now)" }]);
    expect(h.shown("playlister-status")).toBe(false);

    const state = connected([desktop, reel, old, oldMedia]);
    h.render({}, state);
    expect(h.fill("playlister-source")).toEqual({
      items: [{ value: "uuid-reel", text: "Reel" }, { value: "uuid-old", text: "Old reel" }],
      selected: "", placeholder: "Choose a Playlister"
    });
    expect(h.value("playlister-operation")).toBe("playpause");
    expect(h.shown("playlister-status")).toBe(true);
    expect(h.text("playlister-status")).toBe("Choose a Playlister source to control.");
    expect(h.className("playlister-status")).toBe("status-banner status-info");

    h.render({ inputUuid: "uuid-reel", inputName: "Reel", operation: "next" }, state);
    expect(h.fill("playlister-source").selected).toBe("uuid-reel");
    expect(h.value("playlister-operation")).toBe("next");
    expect(h.shown("playlister-status")).toBe(false);
    h.change("playlister-operation", "stop");
    expect(h.saved.at(-1)).toEqual({ operation: "stop" });
    h.change("playlister-source", "uuid-old");
    expect(h.saved.at(-1)).toEqual({ inputUuid: "uuid-old", inputName: "Old reel" });
    h.change("playlister-label", " Intro ");
    expect(h.saved.at(-1)).toEqual({ labelOverride: "Intro" });
    h.click("playlister-refresh");
    expect(h.refreshes()).toBe(1);

    // Missing: the stored name hint, never the UUID; wrong kind: the live name and its banner.
    h.render({ inputUuid: "uuid-gone", inputName: "Yesterday's reel" }, state);
    expect(h.fill("playlister-source").items.at(-1)).toEqual({ value: "uuid-gone", text: "Yesterday's reel (not in OBS now)" });
    expect(h.fill("playlister-source").items.some((item) => item.text.includes("uuid-gone"))).toBe(false);
    expect(h.text("playlister-status")).toContain("not in OBS now");
    expect(h.className("playlister-status")).toContain("status-warn");
    h.render({ inputUuid: "uuid-gone" }, state);
    expect(h.fill("playlister-source").items.at(-1)).toEqual({ value: "uuid-gone", text: "Unknown Playlister (not in OBS now)" });
    h.render({ inputUuid: "uuid-desktop", inputName: "Desktop Audio" }, state);
    expect(h.fill("playlister-source").items.at(-1)).toEqual({ value: "uuid-desktop", text: "Desktop Audio" });
    expect(h.text("playlister-status")).toBe("The chosen source is not a Playlister. Choose a Playlister source.");

    // No Playlister in OBS, an OBS without the media requests, and no connection.
    h.render({}, connected([desktop]));
    expect(h.text("playlister-status")).toBe("No Playlister source in OBS. Add one to a scene first.");
    expect(h.className("playlister-status")).toBe("status-banner status-info");
    h.render({ inputUuid: "uuid-reel" }, connected([desktop, reel], "unsupported"));
    expect(h.text("playlister-status")).toContain("Update OBS");
    expect(h.className("playlister-status")).toContain("status-err");
    // Unsupported outranks a missing target: nothing can be driven anyway.
    h.render({ inputUuid: "uuid-gone", inputName: "Reel" }, connected([desktop], "unsupported"));
    expect(h.text("playlister-status")).toContain("Update OBS");
    h.render({ inputUuid: "uuid-gone", inputName: "Reel" }, { status: { kind: "obs_unreachable" }, catalog: {}, mediaCapability: "unknown" });
    expect(h.shown("playlister-status")).toBe(false);
    expect(h.fill("playlister-source").items).toEqual([{ value: "uuid-gone", text: "Reel (not in OBS now)" }]);
  });
});
