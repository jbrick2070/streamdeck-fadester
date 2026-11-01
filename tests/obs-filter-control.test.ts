// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FilterController } from "../src/control/filter-controller.js";
import { ObsFilterControlAction, ObsFilterInstanceController } from "../src/actions/obs-filter-control.js";
import { renderDirectDialSvg, renderDirectKeySvg, renderVisualPanicKeySvg } from "../src/gfx/direct-obs-renderer.js";
import { ObsFilterSettings } from "../src/types/settings.js";
import { setLanguage } from "../src/i18n/strings.js";
import { FakeObsFilter, FakeObsServer, VS_MODULATOR_KIND, VS_SHADER_KIND } from "./helpers/fake-obs-server.js";
import { deckTable } from "./helpers/languages.js";

/**
 * The OBS Filter action (PLAN.md 10.4, R-RIG-1, R-RIG-8): what its dial and
 * keys send through the filter controller and what they draw.
 */
describe("OBS Filter control", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  async function setup(): Promise<{ server: FakeObsServer; client: DirectObsClient; filters: FilterController; sceneUuid: string; aura: FakeObsFilter }> {
    const server = new FakeObsServer({ missingPlugin: true });
    const sceneUuid = server.sceneUuidFor("Scene Live");
    const aura = server.addFilter(sceneUuid, { filterName: "Aura", filterKind: VS_SHADER_KIND, filterSettings: { vs_effect_mix_pct: 40 } });
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client);
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return { server, client, filters, sceneUuid, aura };
  }

  function sink() {
    const images: string[] = [];
    let alerts = 0;
    return {
      sink: { render: async (svg: string) => { images.push(svg); }, showAlert: async () => { alerts++; } },
      alerts: (): number => alerts,
      last: (): string => images.at(-1) ?? "",
      waitImage: (predicate: (svg: string) => boolean): Promise<void> =>
        vi.waitFor(() => expect(predicate(images.at(-1) ?? ""), images.at(-1)).toBe(true), { timeout: 3000 })
    };
  }

  function control(filters: FilterController, dial: boolean, settings: ObsFilterSettings) {
    const view = sink();
    const controller = new ObsFilterInstanceController(filters, view.sink, dial, settings, 10);
    cleanup.unshift(() => controller.disappear());
    controller.appear();
    return { controller, ...view };
  }

  const hash = (svg: string): string => createHash("sha256").update(svg).digest("hex").slice(0, 16);

  afterEach(async () => {
    setLanguage("en", null);
    for (const step of cleanup.splice(0)) await step();
  });

  it("routes no touch tap: a tap on the strip never moves a filter", () => {
    expect(ObsFilterControlAction.prototype.onTouchTap).toBeUndefined();
    for (const handler of ["onDialRotate", "onDialDown", "onDialUp", "onKeyDown"] as const) {
      expect(typeof ObsFilterControlAction.prototype[handler], handler).toBe("function");
    }
  });

  it("drops to the rest value on dial down, returns on dial up, and returns when the page is hidden", async () => {
    const { filters, sceneUuid, aura } = await setup();
    const settings: ObsFilterSettings = { sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "vs_effect_mix_pct", dialPress: "drop_return" };
    const dial = control(filters, true, settings);
    await dial.waitImage((svg) => svg.includes(">40%<") && svg.includes(">Effect mix · Aura<") && svg.includes(">Press: drop and return<"));
    await dial.controller.dialDown();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(0), { timeout: 3000 });
    await dial.controller.dialUp();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(40), { timeout: 3000 });
    // Dropped, then the page changes: the return still runs.
    await dial.controller.dialDown();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(0), { timeout: 3000 });
    dial.controller.disappear();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(40), { timeout: 3000 });
    expect(dial.alerts()).toBe(0);
  });

  it("toggles from a fresh read of the filter's state and draws ON or OFF", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    const key = control(filters, false, { sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, keyOperation: "toggle", labelOverride: "Look 1" });
    // "Look 1" is the rig's shipped caption, so the key draws the filter's own name.
    await key.waitImage((svg) => svg.includes(">Aura<") && !svg.includes("Look 1") && svg.includes(">ON<") && svg.includes('data-icon="look-on"'));
    // Turned off in OBS behind the deck's back: the press reads first, so it turns the filter on.
    aura.filterEnabled = false;
    await key.controller.keyDown();
    expect(aura.filterEnabled).toBe(true);
    await key.controller.keyDown();
    expect(aura.filterEnabled).toBe(false);
    await key.waitImage((svg) => svg.includes(">OFF<") && svg.includes('data-icon="look-off"'));
    expect(server.directCallLog.filter((call) => call.requestType === "SetSourceFilterEnabled")
      .map((call) => call.requestData?.filterEnabled)).toEqual([true, false]);
  });

  it("sets a value over a time and steps by a share of the range", async () => {
    const { filters, sceneUuid, aura } = await setup();
    const base = { sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "vs_effect_mix_pct" };
    const still = control(filters, false, { ...base, keyOperation: "set", value: 0, durationMs: 200 });
    await still.waitImage((svg) => svg.includes(">Effect mix<") && svg.includes(">To 0% in 0.2 s<") && svg.includes('data-icon="still"'));
    await still.controller.keyDown();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(0), { timeout: 3000 });
    const up = control(filters, false, { ...base, keyOperation: "step_up", stepPct: 10 });
    await up.waitImage((svg) => svg.includes(">Effect mix up<") && svg.includes('data-icon="wave-up"'));
    await up.controller.keyDown();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(10), { timeout: 3000 });
    const full = control(filters, false, { ...base, keyOperation: "set", value: 100, durationMs: 0 });
    await full.waitImage((svg) => svg.includes('data-icon="full-react"'));
  });

  it("draws the value or the problem, never a blank control", async () => {
    const { server, client, filters, sceneUuid, aura } = await setup();
    const unboundDial = control(filters, true, {});
    await unboundDial.waitImage((svg) => svg.includes(">Choose OBS control<") && svg.includes(">Open its inspector<"));
    const unboundKey = control(filters, false, { keyOperation: "toggle" });
    await unboundKey.waitImage((svg) => svg.includes(">Filter on/off<") && svg.includes(">Choose a filter<"));
    await unboundKey.controller.keyDown();
    expect(unboundKey.alerts()).toBe(1);

    const settings: ObsFilterSettings = { sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "vs_effect_mix_pct" };
    const dial = control(filters, true, settings);
    await dial.waitImage((svg) => svg.includes(">40%<"));
    // A sibling Audio Modulator drives it: refused on the next turn, and said.
    server.addFilter(sceneUuid, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterSettings: { slot_1_target_filter: "Aura", slot_1_target_setting: "vs_effect_mix_pct" } });
    await dial.controller.rotate(1, Date.now());
    await dial.waitImage((svg) => svg.includes(">Driven by Pulse<"));
    expect(dial.alerts()).toBe(1);
    // A dial with no setting chosen says so.
    const noSetting = control(filters, true, { ...settings, setting: "" });
    await noSetting.waitImage((svg) => svg.includes(">Choose a setting<"));
    // Latched by Panic: "Restore first".
    server.sourceFilters.get(sceneUuid)!.splice(1);
    filters.setPanicLatched(true);
    await dial.waitImage((svg) => svg.includes(">Restore first<"));
    filters.setPanicLatched(false);
    // The modulator is gone: the next read clears the refusal.
    await filters.refresh({ sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "vs_effect_mix_pct" });
    await dial.waitImage((svg) => svg.includes(">40%<") && !svg.includes("Driven by"));
    // Renamed in OBS: missing, never another filter.
    aura.filterName = "Aura 2";
    await dial.controller.rotate(1, Date.now() + 5000);
    await dial.waitImage((svg) => svg.includes(">Filter not found<"));
    // Disconnected: the connection's own reason.
    const offline = once(client, "statusChanged", { signal: AbortSignal.timeout(3000) });
    await server.stop();
    await offline;
    await dial.waitImage((svg) => svg.includes(">OBS is not running or websocket is off<") || svg.includes("not running"));

    // German words on the deck.
    setLanguage("de", deckTable("de"));
    const german = control(filters, false, { keyOperation: "toggle" });
    await german.waitImage((svg) => svg.includes(">Filter an/aus<") && svg.includes(">Filter wählen<"));
  });

  it("cancels its glide visibly when retargeted, leaving the value where it stands", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    server.addFilter(sceneUuid, { filterName: "Aura B", filterKind: VS_SHADER_KIND });
    const settings: ObsFilterSettings = { sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "vs_effect_mix_pct", keyOperation: "set", value: 100, durationMs: 3000 };
    const key = control(filters, false, settings);
    await key.waitImage((svg) => svg.includes(">Effect mix<"));
    void key.controller.keyDown();
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBeGreaterThan(40));
    key.controller.updateSettings({ ...settings, filterName: "Aura B" });
    await key.waitImage((svg) => svg.includes(">Glide cancelled<"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const value = aura.filterSettings.vs_effect_mix_pct;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(aura.filterSettings.vs_effect_mix_pct).toBe(value);
    expect(value).toBeLessThan(100);
  });

  it("draws today's SVG byte for byte with the default accent, and the page accent otherwise", () => {
    const key = { connected: true, reason: "", title: "Next scene", subtitle: "Preview: Opening", configured: true, icon: "next" as const };
    const dial = { connected: true, reason: "", label: "Music", value: 0.4, configured: true, target: "input_volume" as const, pressHint: "Press: show / hide" };
    const mixer = { connected: true, reason: "", label: "", value: 0.5, configured: true, target: "tbar" as const, studioMode: true, programSceneName: "A", previewSceneName: "B" };
    const restore = { operation: "restore" as const, connected: true, reason: "", latched: false, holdSeconds: 0.8 };
    // Hashes of the drawings before the accent existed (PLAN.md 10.4).
    for (const accent of [undefined, "default" as const]) {
      expect(hash(renderDirectKeySvg({ ...key, accent }))).toBe("c919c6bf82fae337");
      expect(hash(renderDirectKeySvg({ ...key, problem: "Missing", accent }))).toBe("fe176bfb49987539");
      expect(hash(renderDirectDialSvg({ ...dial, accent }))).toBe("99d7d9fcdb04c07f");
      expect(hash(renderDirectDialSvg({ ...mixer, accent }))).toBe("1f55a3a08fcf35d7");
      expect(hash(renderVisualPanicKeySvg({ ...restore, accent }))).toBe("fbd7bf228a783d94");
    }
    const brass = renderDirectKeySvg({ ...key, accent: "brass" });
    expect(brass).toContain('stroke="#F5B841" stroke-width="3"/>');
    expect(brass).not.toContain("#9146FF");
    expect(renderDirectDialSvg({ ...dial, accent: "teal" })).toContain('fill="#2DD4BF"');
    expect(renderVisualPanicKeySvg({ ...restore, accent: "magenta" })).toContain("#E879F9");
    // Panic stays red whatever the page's accent.
    expect(renderVisualPanicKeySvg({ operation: "panic", connected: true, reason: "", latched: false })).toContain('fill="#EF4444"');
  });
});
