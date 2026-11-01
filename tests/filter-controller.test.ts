// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import { FilterController, FilterTarget } from "../src/control/filter-controller.js";
import { isDeniedSetting, listUniformNames, resolveRange, restValue, slewStep, writableValue } from "../src/obs/filter-ranges.js";
import {
  COLOR_FILTER_KIND,
  FakeObsFilter,
  FakeObsServer,
  FakeObsServerOptions,
  VS_MODULATOR_KIND,
  VS_SHADER_KIND
} from "./helpers/fake-obs-server.js";

/**
 * The filter controller's safety rules (PLAN.md 10.2, R-RIG-2..5), against the
 * fake OBS: range and slew, one write in flight, merged patches, fresh reads,
 * ownership, identity, the deny list, lifecycle and the panic latch.
 */
describe("filter controller", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  async function setup(options: FakeObsServerOptions = {}, prepare?: (server: FakeObsServer, sceneUuid: string) => void): Promise<{
    server: FakeObsServer; client: DirectObsClient; filters: FilterController; sceneUuid: string; aura: FakeObsFilter;
  }> {
    const server = new FakeObsServer({ missingPlugin: true, ...options });
    const sceneUuid = server.sceneUuidFor("Scene Live");
    const aura = server.addFilter(sceneUuid, { filterName: "Aura", filterKind: VS_SHADER_KIND, filterSettings: { vs_effect_mix_pct: 40 } });
    prepare?.(server, sceneUuid);
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    const filters = new FilterController(client, { settleReadMs: 5000 });
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return { server, client, filters, sceneUuid, aura };
  }

  const mix = (sceneUuid: string, extra: Partial<FilterTarget> = {}): FilterTarget => ({
    sourceUuid: sceneUuid, filterName: "Aura", filterKind: VS_SHADER_KIND, setting: "vs_effect_mix_pct", ...extra
  });
  const writesTo = (server: FakeObsServer, setting: string): number[] =>
    server.filterWriteLog.filter((entry) => setting in entry.filterSettings).map((entry) => entry.filterSettings[setting] as number);

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  afterEach(async () => {
    for (const step of cleanup.splice(0)) await step();
  });

  it("keeps every write in range and within the slew cap, one in flight per filter, and lands the last value", async () => {
    const { server, filters, sceneUuid, aura } = await setup({ filterWriteDelayMs: 120 });
    // A fast flick asks for far more than one write may move: the drain carries the rest at 10 % per write,
    // and turns that land while a write is in flight wait for its reply.
    await filters.nudge(mix(sceneUuid), 0.3, 1000);
    await sleep(20);
    await filters.nudge(mix(sceneUuid), 0.3, 1020);
    await sleep(60);
    await filters.nudge(mix(sceneUuid), 0.3, 1080);
    await vi.waitFor(() => expect(filters.getState(mix(sceneUuid)).value).toBe(100), { timeout: 4000 });
    expect(aura.filterSettings.vs_effect_mix_pct).toBe(100);
    const values = writesTo(server, "vs_effect_mix_pct");
    let previous = 40;
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(Math.abs(value - previous)).toBeLessThanOrEqual(10 + 1e-9);
      previous = value;
    }
    expect(values.at(-1)).toBe(100);
    expect(server.maxFilterWritesInFlight).toBe(1);
    expect(filters.getState(mix(sceneUuid))).toMatchObject({ availability: "ok", value: 100, range: { min: 0, max: 100 } });
    // Pinned at the rail, further turns send nothing.
    const writes = server.filterWriteLog.length;
    await filters.nudge(mix(sceneUuid), 0.1, 1100);
    await sleep(150);
    expect(server.filterWriteLog).toHaveLength(writes);
  });

  it("keeps writes 50 ms apart over all filters (20 a second) and 200 ms apart for an Audio Modulator", async () => {
    let grade: FakeObsFilter | undefined;
    let pulse: FakeObsFilter | undefined;
    const { server, filters, sceneUuid, aura } = await setup({}, (fake, uuid) => {
      grade = fake.addFilter(uuid, { filterName: "Grade", filterKind: COLOR_FILTER_KIND });
      pulse = fake.addFilter(uuid, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterSettings: { slot_2_amount_pct: 0 } });
    });
    const opacity: FilterTarget = { sourceUuid: sceneUuid, filterName: "Grade", filterKind: COLOR_FILTER_KIND, setting: "opacity" };
    const amount: FilterTarget = { sourceUuid: sceneUuid, filterName: "Pulse", filterKind: VS_MODULATOR_KIND, setting: "slot_2_amount_pct", rangeMin: 0, rangeMax: 100 };
    await Promise.all([filters.glideTo(mix(sceneUuid), 0, 0), filters.glideTo(opacity, 0.6, 0), filters.glideTo(amount, 40, 0)]);
    await vi.waitFor(() => {
      expect(aura.filterSettings.vs_effect_mix_pct).toBe(0);
      expect(grade!.filterSettings.opacity).toBe(0.6);
      expect(pulse!.filterSettings.slot_2_amount_pct).toBe(40);
    }, { timeout: 4000 });
    const all = server.filterWriteLog.map((entry) => entry.at);
    expect(all.length).toBe(4 + 4 + 4);
    for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!, `write ${i}`).toBeGreaterThanOrEqual(45);
    const modulator = server.filterWriteLog.filter((entry) => entry.filterName === "Pulse").map((entry) => entry.at);
    for (let i = 1; i < modulator.length; i++) expect(modulator[i]! - modulator[i - 1]!, `modulator write ${i}`).toBeGreaterThanOrEqual(190);
  });

  it("moves a whole-number setting at least one per write and arrives", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    aura.filterSettings = { ...aura.filterSettings, pattern_steps: 2 };
    const steps = mix(sceneUuid, { setting: "pattern_steps", rangeMin: 0, rangeMax: 4, integer: true });
    await filters.nudge(steps, 0.05, 1000);
    await filters.nudge(steps, 0.05, 1010);
    await filters.nudge(steps, 0.05, 1020);
    await filters.nudge(steps, 0.05, 1030);
    await filters.nudge(steps, 0.05, 1040);
    await vi.waitFor(() => expect(filters.getState(steps).value).toBe(3));
    expect(server.filterWriteLog.map((entry) => entry.filterSettings.pattern_steps)).toEqual([3]);
  });

  it("lands two settings of one filter in one merged patch per write", async () => {
    const { server, filters, sceneUuid, aura } = await setup({ filterWriteDelayMs: 60 });
    const react = mix(sceneUuid, { setting: "vs_audio_reactivity_pct" });
    // Two gestures on two dials of one filter (Effect mix and Reactivity on PERFORM).
    await filters.nudge(mix(sceneUuid), -0.01, 1000);
    await filters.nudge(react, -0.01, 1000);
    await vi.waitFor(() => expect([aura.filterSettings.vs_effect_mix_pct, aura.filterSettings.vs_audio_reactivity_pct]).toEqual([39, 99]));
    const start = server.filterWriteLog.length;
    void filters.nudge(mix(sceneUuid), -0.19, 1010);
    void filters.nudge(react, -0.29, 1010);
    await vi.waitFor(() => {
      expect(aura.filterSettings.vs_effect_mix_pct).toBe(20);
      expect(aura.filterSettings.vs_audio_reactivity_pct).toBe(70);
    }, { timeout: 3000 });
    // Both moved in the same writes: the newest values merge per filter, never one setting dropping the other.
    expect(server.filterWriteLog.slice(start).map((entry) => entry.filterSettings)).toEqual([
      { vs_effect_mix_pct: 29, vs_audio_reactivity_pct: 89 },
      { vs_effect_mix_pct: 20, vs_audio_reactivity_pct: 79 },
      { vs_audio_reactivity_pct: 70 }
    ]);
    expect(server.maxFilterWritesInFlight).toBe(1);
    for (const entry of server.filterRequestLog.filter((item) => item.requestType === "SetSourceFilterSettings")) {
      expect(entry.requestData.overlay).toBe(true);
    }
  });

  it("starts each gesture from a fresh read and ignores the cached value", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    const release = filters.watch(mix(sceneUuid));
    cleanup.push(release);
    await vi.waitFor(() => expect(filters.getState(mix(sceneUuid)).value).toBe(40));
    // OBS changes the value behind the deck's back (no Filters events are subscribed).
    aura.filterSettings.vs_effect_mix_pct = 80;
    const reads = server.filterRequestLog.filter((entry) => entry.requestType === "GetSourceFilter").length;
    await filters.nudge(mix(sceneUuid), 0.05, Date.now());
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(85));
    expect(server.filterRequestLog.filter((entry) => entry.requestType === "GetSourceFilter").length).toBe(reads + 1);
    // Within the gesture no read: the wanted value carries on.
    await filters.nudge(mix(sceneUuid), 0.05, Date.now());
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(90));
    expect(server.filterRequestLog.filter((entry) => entry.requestType === "GetSourceFilter").length).toBe(reads + 1);
  });

  it("refuses a setting a sibling Audio Modulator targets, also when it is disabled, seen between gestures", async () => {
    let pulse: FakeObsFilter | undefined;
    const { server, filters, sceneUuid, aura } = await setup({}, (fake, uuid) => {
      pulse = fake.addFilter(uuid, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterEnabled: false });
    });
    await filters.nudge(mix(sceneUuid), 0.1, 1000);
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(50));
    // The operator points the (disabled) modulator's slot 1 at Effect mix in OBS: slot 1 is enabled by default.
    pulse!.filterSettings = { slot_1_target_filter: "Aura", slot_1_target_setting: "vs_effect_mix_pct" };
    const writes = server.filterWriteLog.length;
    await expect(filters.nudge(mix(sceneUuid), 0.1, 5000)).rejects.toThrow(/Driven by Pulse/);
    // A refused gesture sends no further reads for the idle time.
    const reads = server.filterRequestLog.length;
    await expect(filters.nudge(mix(sceneUuid), 0.1, 5050)).rejects.toThrow(/Driven by Pulse/);
    expect(server.filterRequestLog).toHaveLength(reads);
    expect(filters.getState(mix(sceneUuid))).toMatchObject({ availability: "owned", owner: { kind: "modulator", filterName: "Pulse" } });
    await expect(filters.glideTo(mix(sceneUuid), 0, 200)).rejects.toThrow(/Driven by Pulse/);
    // A slot that leaves the target frees it again (re-read before the glide).
    pulse!.filterSettings = { slot_3_target_filter: "Aura", slot_3_target_setting: "vs_audio_reactivity_pct" };
    await expect(filters.glideTo(mix(sceneUuid), 30, 0)).resolves.toBe("done");
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(30));
    expect(server.filterWriteLog.slice(writes).every((entry) => entry.filterSettings.vs_effect_mix_pct !== undefined)).toBe(true);
    await expect(filters.nudge(mix(sceneUuid, { setting: "vs_audio_reactivity_pct" }), 0.1, 9000)).rejects.toThrow(/Driven by Pulse/);
  });

  it("refuses a uniform its own Parameter Fader binds", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    aura.filterSettings = { glow_amount: 0.5, param_fader_2_target: "glow_amount", param_fader_2_slot: 3 };
    const glow = mix(sceneUuid, { setting: "glow_amount", rangeMin: 0, rangeMax: 1 });
    await expect(filters.nudge(glow, 0.1, 1000)).rejects.toThrow(/Driven by its fader/);
    aura.filterSettings.param_fader_2_slot = -1;
    await filters.nudge(glow, 0.1, 5000);
    await vi.waitFor(() => expect(aura.filterSettings.glow_amount).toBe(0.6));
    expect(server.filterWriteLog).toHaveLength(1);
  });

  it("refuses a filter of another kind and a missing one, and never writes either", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    // Same name, a newer versioned kind with the same setting: not the filter the control was bound to.
    aura.filterKind = `${VS_SHADER_KIND}_v2`;
    await expect(filters.nudge(mix(sceneUuid), 0.1, 1000)).rejects.toThrow(/Filter kind changed/);
    expect(filters.getState(mix(sceneUuid)).availability).toBe("wrong_kind");
    await expect(filters.toggleEnabled(mix(sceneUuid))).rejects.toThrow(/Filter kind changed/);
    aura.filterKind = VS_SHADER_KIND;
    aura.filterName = "Aura renamed";
    await expect(filters.nudge(mix(sceneUuid), 0.1, 5000)).rejects.toThrow(/Filter not found/);
    expect(filters.getState(mix(sceneUuid)).availability).toBe("missing");
    expect(server.filterWriteLog).toEqual([]);
    expect(server.directCallLog.filter((call) => call.requestType === "SetSourceFilterEnabled")).toEqual([]);
  });

  it("never writes a denied setting, needs a range off the table, and allows the custom band", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    aura.filterSettings = { ...aura.filterSettings, max_flash_rate_hz: 3, onset_threshold: 0.4, custom_low_hz: 60 };
    for (const setting of ["max_flash_rate_hz", "onset_threshold", "preset_shader", "shader_text", "override_entire_effect",
      "slot_2_rate_divider", "mix_fader_slot", "param_fader_1_slot", "custom_mode", "color_multiply"]) {
      expect(isDeniedSetting(setting), setting).toBe(true);
      await expect(filters.nudge(mix(sceneUuid, { setting, rangeMin: 0, rangeMax: 10 }), 0.1, 1000), setting).rejects.toThrow(/Not writable here/);
    }
    expect(server.filterRequestLog).toEqual([]);
    expect(isDeniedSetting("custom_low_hz")).toBe(false);
    expect(isDeniedSetting("custom_high_hz")).toBe(false);
    await expect(filters.nudge(mix(sceneUuid, { setting: "custom_low_hz" }), 0.1, 1000)).rejects.toThrow(/Set a range first/);
    await filters.nudge(mix(sceneUuid, { setting: "custom_low_hz", rangeMin: 20, rangeMax: 200, integer: true }), 0.1, 1000);
    await vi.waitFor(() => expect(aura.filterSettings.custom_low_hz).toBe(78));
    expect(writesTo(server, "max_flash_rate_hz")).toEqual([]);
    // The table's ranges, and the modulator amount only with an explicit range inside -100..100.
    expect(resolveRange(COLOR_FILTER_KIND, "opacity")).toMatchObject({ ok: true, range: { min: 0, max: 1, unit: "fraction" } });
    expect(resolveRange(VS_MODULATOR_KIND, "slot_4_amount_pct")).toEqual({ ok: false, reason: "needs_range" });
    expect(resolveRange(VS_MODULATOR_KIND, "slot_4_amount_pct", { rangeMin: -100, rangeMax: 0 })).toMatchObject({ ok: true, range: { min: -100, max: 0 } });
    expect(resolveRange(VS_MODULATOR_KIND, "slot_4_amount_pct", { rangeMin: -200, rangeMax: 0 })).toEqual({ ok: false, reason: "needs_range" });
  });

  it("drops a bipolar modulator amount to 0 and returns it; a unipolar range drops to its rest", async () => {
    let pulse: FakeObsFilter | undefined;
    const { filters, sceneUuid } = await setup({}, (fake, uuid) => {
      pulse = fake.addFilter(uuid, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterSettings: { slot_2_amount_pct: -60 } });
    });
    const amount: FilterTarget = { sourceUuid: sceneUuid, filterName: "Pulse", filterKind: VS_MODULATOR_KIND, setting: "slot_2_amount_pct", rangeMin: -100, rangeMax: 100 };
    expect(restValue({ min: -100, max: 100, integer: false, unit: "percent" })).toBe(0);
    expect(restValue({ min: -100, max: 0, integer: false, unit: "percent" })).toBe(0);
    expect(restValue({ min: 20, max: 80, integer: false, unit: "number" })).toBe(20);
    await expect(filters.dropStart(amount, 100)).resolves.toBe("done");
    await vi.waitFor(() => expect(pulse!.filterSettings.slot_2_amount_pct).toBe(0), { timeout: 3000 });
    expect(filters.isDropped(amount)).toBe(true);
    await expect(filters.dropReturn(amount, 100)).resolves.toBe("done");
    await vi.waitFor(() => expect(pulse!.filterSettings.slot_2_amount_pct).toBe(-60), { timeout: 3000 });
    expect(filters.isDropped(amount)).toBe(false);
    // Two quick drops: the second, while the first returns, keeps the value saved first.
    await filters.dropStart(amount, 100);
    const returning = filters.dropReturn(amount, 600);
    await sleep(250);
    await filters.dropStart(amount, 100);
    await expect(returning).resolves.toBe("cancelled");
    await filters.dropReturn(amount, 100);
    await vi.waitFor(() => expect(pulse!.filterSettings.slot_2_amount_pct).toBe(-60), { timeout: 3000 });
    // A turn cancels a drop: nothing to return to afterwards.
    await filters.dropStart(amount, 100);
    await filters.nudge(amount, 0.05, Date.now());
    await expect(filters.dropReturn(amount)).resolves.toBe("cancelled");
  });

  it("cancels glides, queued values and replies in flight on a collection change and on a disconnect", async () => {
    const { server, client, filters, sceneUuid, aura } = await setup();
    const release = filters.watch(mix(sceneUuid));
    cleanup.push(release);
    const glide = filters.glideTo(mix(sceneUuid), 100, 3000);
    await vi.waitFor(() => expect(server.filterWriteLog.length).toBeGreaterThan(0));
    server.emitObsEvent("CurrentSceneCollectionChanging", {});
    await expect(glide).resolves.toBe("cancelled");
    // A write already on the wire may still land; nothing after it.
    await sleep(50);
    const writes = server.filterWriteLog.length;
    await sleep(250);
    expect(server.filterWriteLog).toHaveLength(writes);
    server.emitObsEvent("CurrentSceneCollectionChanged", {});
    await vi.waitFor(() => expect(client.getCatalog().scenes.length).toBeGreaterThan(0));
    // A watched control reads its filter again after the change.
    await vi.waitFor(() => expect(filters.getState(mix(sceneUuid)).availability).toBe("ok"));

    // A gesture whose fresh read lands after the change writes nothing.
    server.filterReadDelayMs = 150;
    const nudge = filters.nudge(mix(sceneUuid), 0.2, Date.now());
    await sleep(40);
    server.emitObsEvent("CurrentSceneCollectionChanging", {});
    server.emitObsEvent("CurrentSceneCollectionChanged", {});
    await expect(nudge).rejects.toThrow(/changed/);
    await sleep(200);
    expect(server.filterWriteLog).toHaveLength(writes);
    server.filterReadDelayMs = 0;

    const second = filters.glideTo(mix(sceneUuid), 0, 3000);
    await vi.waitFor(() => expect(server.filterWriteLog.length).toBeGreaterThan(writes));
    client.reconnectNow();
    await expect(second).resolves.toBe("cancelled");
    await sleep(50);
    const value = aura.filterSettings.vs_effect_mix_pct;
    await sleep(250);
    expect(aura.filterSettings.vs_effect_mix_pct).toBe(value);
  });

  it("refuses and stops Visual Sidechain writes and toggles while Panic is latched, other filters unaffected", async () => {
    let grade: FakeObsFilter | undefined;
    const { server, filters, sceneUuid, aura } = await setup({}, (fake, uuid) => {
      grade = fake.addFilter(uuid, { filterName: "Grade", filterKind: COLOR_FILTER_KIND });
    });
    const glide = filters.glideTo(mix(sceneUuid), 100, 3000);
    await vi.waitFor(() => expect(server.filterWriteLog.length).toBeGreaterThan(0));
    filters.setPanicLatched(true);
    await expect(glide).resolves.toBe("cancelled");
    await sleep(50);
    const writes = server.filterWriteLog.length;
    const requests = server.filterRequestLog.length;
    await expect(filters.nudge(mix(sceneUuid), 0.1, 5000)).rejects.toThrow(/Restore first/);
    // Refused before any read: nothing goes to OBS for a latched Visual Sidechain filter.
    expect(server.filterRequestLog).toHaveLength(requests);
    await expect(filters.dropStart(mix(sceneUuid))).rejects.toThrow(/Restore first/);
    await expect(filters.toggleEnabled(mix(sceneUuid))).rejects.toThrow(/Restore first/);
    expect(filters.getState(mix(sceneUuid)).latched).toBe(true);
    expect(server.directCallLog.filter((call) => call.requestType === "SetSourceFilterEnabled")).toEqual([]);
    expect(server.filterWriteLog).toHaveLength(writes);
    // Color Correction is not a Visual Sidechain filter.
    const opacity: FilterTarget = { sourceUuid: sceneUuid, filterName: "Grade", filterKind: COLOR_FILTER_KIND, setting: "opacity" };
    await expect(filters.glideTo(opacity, 0.5, 0)).resolves.toBe("done");
    await vi.waitFor(() => expect(grade!.filterSettings.opacity).toBe(0.5), { timeout: 3000 });
    expect(filters.getState(opacity).latched).toBe(false);
    filters.setPanicLatched(false);
    const before = aura.filterSettings.vs_effect_mix_pct as number;
    await filters.nudge(mix(sceneUuid), -0.05, 9000);
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct as number).toBeCloseTo(before - 5, 6));
  });

  it("refuses a value OBS holds outside the range instead of pulling it to the range's edge", async () => {
    let pulse: FakeObsFilter | undefined;
    const { server, filters, sceneUuid } = await setup({}, (fake, uuid) => {
      // An inverted modulation, under a 0..100 range.
      pulse = fake.addFilter(uuid, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterSettings: { slot_2_amount_pct: -60 } });
    });
    const amount: FilterTarget = { sourceUuid: sceneUuid, filterName: "Pulse", filterKind: VS_MODULATOR_KIND, setting: "slot_2_amount_pct", rangeMin: 0, rangeMax: 100 };
    await expect(filters.nudge(amount, -0.02, 1000)).rejects.toThrow(/Out of range/);
    await expect(filters.nudge(amount, 0.02, 5000)).rejects.toThrow(/Out of range/);
    await expect(filters.step(amount, 0.1)).rejects.toThrow(/Out of range/);
    await expect(filters.glideTo(amount, 50, 0)).rejects.toThrow(/Out of range/);
    await expect(filters.dropStart(amount, 0)).rejects.toThrow(/Out of range/);
    await expect(filters.dropReturn(amount, 0)).resolves.toBe("cancelled");
    await sleep(300);
    expect(server.filterWriteLog).toEqual([]);
    expect(pulse!.filterSettings.slot_2_amount_pct).toBe(-60);
    expect(filters.getState(amount)).toMatchObject({ availability: "out_of_range", value: -60 });
    // The bipolar range holds it: it rides as usual, within the slew cap.
    const bipolar = { ...amount, rangeMin: -100, rangeMax: 100 };
    await filters.nudge(bipolar, 0.05, 9000);
    await vi.waitFor(() => expect(pulse!.filterSettings.slot_2_amount_pct).toBe(-50), { timeout: 3000 });
    expect(writesTo(server, "slot_2_amount_pct")).toEqual([-50]);
  });

  it("keeps a whole-number setting inside the range's whole numbers and its slew cap", () => {
    expect(writableValue(2.5, { min: 0, max: 2.5, integer: true, unit: "number" })).toBe(2);
    expect(writableValue(0.4, { min: 0.4, max: 3, integer: true, unit: "number" })).toBe(1);
    expect(resolveRange(VS_SHADER_KIND, "pattern_steps", { rangeMin: 0.4, rangeMax: 0.6, integer: true })).toEqual({ ok: false, reason: "needs_range" });
    expect(resolveRange(VS_SHADER_KIND, "pattern_steps", { rangeMin: 0.4, rangeMax: 0.6 })).toMatchObject({ ok: true });
    // 10 % of 0..105 is 10.5: a whole-number write moves 10, never a rounded 11.
    expect(slewStep({ min: 0, max: 105, integer: true, unit: "number" })).toBe(10);
    expect(slewStep({ min: 0, max: 4, integer: true, unit: "number" })).toBe(1);
  });

  it("never writes a list uniform its shader's own text declares, whatever range is typed", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    const shaderText = [
      'uniform int pattern < string label = "Pattern"; string widget_type = "select"; string option_0 = "A"; >;',
      'uniform int cells < string widget_type = "slider"; int minimum = 1; int maximum = 8; >;',
      'uniform float glow < string widget_type = "slider"; >;'
    ].join("\n");
    expect([...listUniformNames(shaderText)]).toEqual(["pattern"]);
    aura.filterSettings = { ...aura.filterSettings, shader_text: shaderText, pattern: 1, cells: 2 };
    const pattern = mix(sceneUuid, { setting: "pattern", rangeMin: 0, rangeMax: 10, integer: true });
    await expect(filters.nudge(pattern, 0.1, 1000)).rejects.toThrow(/Not writable here/);
    await expect(filters.glideTo(pattern, 3, 0)).rejects.toThrow(/Not writable here/);
    expect(filters.getState(pattern).availability).toBe("denied");
    // An int slider of the same shader rides.
    await filters.nudge(mix(sceneUuid, { setting: "cells", rangeMin: 1, rangeMax: 8, integer: true }), 0.15, 1000);
    await vi.waitFor(() => expect(aura.filterSettings.cells).toBe(3));
    expect(writesTo(server, "pattern")).toEqual([]);
  });

  it("keeps one control's glide when another control binds the same filter under another kind", async () => {
    const { filters, sceneUuid, aura } = await setup();
    // A second control still bound to the filter's old kind (Color Correction) reads and is refused...
    const stale: FilterTarget = { sourceUuid: sceneUuid, filterName: "Aura", filterKind: COLOR_FILTER_KIND, setting: "opacity" };
    const glide = filters.glideTo(mix(sceneUuid), 100, 600);
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct as number).toBeGreaterThan(40));
    const release = filters.watch(stale);
    cleanup.push(release);
    await filters.refresh(stale);
    expect(filters.getState(stale).availability).toBe("wrong_kind");
    // ...and never cancels the other control's glide or empties its record.
    await expect(glide).resolves.toBe("done");
    await vi.waitFor(() => expect(aura.filterSettings.vs_effect_mix_pct).toBe(100), { timeout: 3000 });
    expect(filters.getState(mix(sceneUuid))).toMatchObject({ availability: "ok", value: 100 });
  });

  it("drops a setting's queued values on cancel: after a retarget only a write in flight lands", async () => {
    const { server, filters, sceneUuid, aura } = await setup({ filterWriteDelayMs: 40 });
    // A step of half the range lands in the queue at once; the drain carries it at 10 % per write.
    await expect(filters.step(mix(sceneUuid), 0.5)).resolves.toBe("done");
    await vi.waitFor(() => expect(server.filterWriteLog.length).toBeGreaterThan(0));
    expect(filters.cancel(mix(sceneUuid))).toBe(true);
    const writes = server.filterWriteLog.length;
    await sleep(500);
    expect(server.filterWriteLog.length).toBeLessThanOrEqual(writes + 1);
    expect(aura.filterSettings.vs_effect_mix_pct as number).toBeLessThan(80);
  });

  it("re-checks the latch after a toggle's fresh read: Panic during the read stops the write", async () => {
    const { server, filters, sceneUuid } = await setup();
    server.filterReadDelayMs = 150;
    const toggle = filters.toggleEnabled(mix(sceneUuid));
    await sleep(40);
    filters.setPanicLatched(true);
    await expect(toggle).rejects.toThrow(/Restore first/);
    expect(server.directCallLog.filter((call) => call.requestType === "SetSourceFilterEnabled")).toEqual([]);
    // Latched before the press: refused before any read.
    const reads = server.filterRequestLog.length;
    await expect(filters.toggleEnabled(mix(sceneUuid))).rejects.toThrow(/Restore first/);
    expect(server.filterRequestLog).toHaveLength(reads);
  });

  it("toggles the filter from a fresh read of its enabled state", async () => {
    const { server, filters, sceneUuid, aura } = await setup();
    const release = filters.watch(mix(sceneUuid, { setting: "" }));
    cleanup.push(release);
    await vi.waitFor(() => expect(filters.getState(mix(sceneUuid, { setting: "" })).enabled).toBe(true));
    aura.filterEnabled = false;
    await expect(filters.toggleEnabled(mix(sceneUuid))).resolves.toBe(true);
    expect(aura.filterEnabled).toBe(true);
    await expect(filters.toggleEnabled(mix(sceneUuid))).resolves.toBe(false);
    expect(aura.filterEnabled).toBe(false);
    expect(server.directCallLog.filter((call) => call.requestType === "SetSourceFilterEnabled")
      .map((call) => call.requestData?.filterEnabled)).toEqual([true, false]);
  });
});
