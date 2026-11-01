// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { DirectObsClient } from "../src/obs/direct-obs-client.js";
import {
  COLOR_FILTER_KIND,
  FakeObsServer,
  VS_MODULATOR_KIND,
  VS_SHADER_KIND
} from "./helpers/fake-obs-server.js";

/**
 * The client's filter and hotkey requests and the scene and group UUIDs
 * (PLAN.md 10.1, R-RIG-2), against the fake OBS.
 */
describe("filter and hotkey requests", () => {
  const cleanup: Array<() => void | Promise<void>> = [];

  async function connect(prepare?: (server: FakeObsServer) => void): Promise<{ server: FakeObsServer; client: DirectObsClient }> {
    const server = new FakeObsServer({ missingPlugin: true });
    prepare?.(server);
    const port = await server.start();
    const client = new DirectObsClient({ host: "127.0.0.1", port, password: "" });
    cleanup.push(() => client.stop(), () => server.stop());
    const connected = once(client, "statusChanged", { signal: AbortSignal.timeout(2000) });
    client.start();
    await connected;
    return { server, client };
  }

  afterEach(async () => {
    for (const step of cleanup.splice(0)) await step();
  });

  it("reads filters by sourceUuid, merges an overlay patch and answers 600 for a missing filter", async () => {
    const { server, client } = await connect();
    const sceneUuid = server.sceneUuidFor("Scene Live");
    const input = server.inputList()[0]!;
    server.addFilter(sceneUuid, { filterName: "Aura", filterKind: VS_SHADER_KIND, filterSettings: { vs_effect_mix_pct: 40, vs_audio_reactivity_pct: 70 } });
    server.addFilter(sceneUuid, { filterName: "Pulse", filterKind: VS_MODULATOR_KIND, filterEnabled: false });
    server.addFilter(input.inputUuid, { filterName: "Grade", filterKind: COLOR_FILTER_KIND });

    const list = await client.getSourceFilterList(sceneUuid);
    expect(list.map((filter) => [filter.filterName, filter.filterKind, filter.filterEnabled, filter.filterIndex]))
      .toEqual([["Aura", VS_SHADER_KIND, true, 0], ["Pulse", VS_MODULATOR_KIND, false, 1]]);
    expect(list[0]!.filterSettings).toEqual({ vs_effect_mix_pct: 40, vs_audio_reactivity_pct: 70 });
    expect((await client.getSourceFilterList(input.inputUuid)).map((filter) => filter.filterName)).toEqual(["Grade"]);

    // Only changed values come back; the kind's static defaults fill the rest.
    expect((await client.getSourceFilter(input.inputUuid, "Grade")).filterSettings).toEqual({});
    const defaults = await client.getSourceFilterDefaultSettings(COLOR_FILTER_KIND);
    expect(defaults.opacity).toBe(1);
    expect((await client.getSourceFilterDefaultSettings(VS_MODULATOR_KIND)).slot_1_enabled).toBe(true);
    // Defaults are read once per connection.
    await client.getSourceFilterDefaultSettings(COLOR_FILTER_KIND);
    expect(server.filterRequestLog.filter((entry) => entry.requestType === "GetSourceFilterDefaultSettings")).toHaveLength(2);

    // One setting written; the other keeps its value (overlay).
    await client.setSourceFilterSettings(sceneUuid, "Aura", { vs_effect_mix_pct: 55 });
    expect(server.findFilter(sceneUuid, "Aura")!.filterSettings).toEqual({ vs_effect_mix_pct: 55, vs_audio_reactivity_pct: 70 });
    expect((await client.getSourceFilter(sceneUuid, "Aura")).filterSettings).toEqual({ vs_effect_mix_pct: 55, vs_audio_reactivity_pct: 70 });
    await client.setSourceFilterEnabled(sceneUuid, "Pulse", true);
    expect(server.findFilter(sceneUuid, "Pulse")!.filterEnabled).toBe(true);

    // A renamed or removed filter is missing (600), never another one.
    await expect(client.getSourceFilter(sceneUuid, "Aura 2")).rejects.toMatchObject({ code: 600 });
    await expect(client.setSourceFilterSettings(sceneUuid, "Gone", { vs_effect_mix_pct: 1 })).rejects.toMatchObject({ code: 600 });
    await expect(client.getSourceFilterList("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: 600 });
    await expect(client.getSourceFilterDefaultSettings("no_such_kind")).rejects.toMatchObject({ code: 607 });
    // A failed read is not kept: the next call asks again.
    await expect(client.getSourceFilterDefaultSettings("no_such_kind")).rejects.toMatchObject({ code: 607 });
    expect(server.filterRequestLog.filter((entry) => entry.requestData.filterKind === "no_such_kind")).toHaveLength(2);
    // Unbound sends nothing.
    const before = server.filterRequestLog.length;
    await expect(client.getSourceFilter("", "Aura")).rejects.toThrow(/Choose a source and a filter/);
    await expect(client.setSourceFilterSettings(sceneUuid, "", { vs_effect_mix_pct: 1 })).rejects.toThrow(/Choose a source/);
    expect(server.filterRequestLog).toHaveLength(before);

    // Every filter request addressed its source by UUID alone, and every write was an overlay.
    for (const entry of server.filterRequestLog.filter((item) => item.requestType !== "GetSourceFilterDefaultSettings")) {
      expect(typeof entry.requestData.sourceUuid, entry.requestType).toBe("string");
      expect(entry.requestData).not.toHaveProperty("sourceName");
    }
    const writes = server.filterRequestLog.filter((item) => item.requestType === "SetSourceFilterSettings");
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.requestData.overlay).toBe(true);

    // A new connection reads the defaults again.
    client.reconnectNow();
    await vi.waitFor(() => expect(client.isConnected()).toBe(true), { timeout: 3000 });
    await client.getSourceFilterDefaultSettings(COLOR_FILTER_KIND);
    expect(server.filterRequestLog.filter((entry) => entry.requestData.filterKind === COLOR_FILTER_KIND)).toHaveLength(2);
  });

  it("lists hotkeys it knows, records a trigger and answers 600 for an unknown name", async () => {
    const { server, client } = await connect();
    const listed = await client.sendObsRequest("GetHotkeyList");
    expect(listed.hotkeys).toContain("visual_sidechain_panic");
    expect(listed.hotkeys).toContain("visual_sidechain_restore");
    await client.triggerHotkeyByName("visual_sidechain_panic");
    await client.triggerHotkeyByName("visual_sidechain_panic");
    expect(server.hotkeyTriggerLog.map((entry) => entry.hotkeyName)).toEqual(["visual_sidechain_panic", "visual_sidechain_panic"]);
    server.hotkeyNames = server.hotkeyNames.filter((name) => !name.startsWith("visual_sidechain_"));
    await expect(client.triggerHotkeyByName("visual_sidechain_restore")).rejects.toMatchObject({ code: 600 });
    server.hotkeyFailNext = "Hotkey failed.";
    await expect(client.triggerHotkeyByName("OBSBasic.Transition")).rejects.toMatchObject({ code: 500 });
    expect(server.hotkeyTriggerAttempts).toBe(4);
    expect(server.hotkeyTriggerLog).toHaveLength(2);
  });

  it("carries scene and group UUIDs in the catalog and drops them on a collection change", async () => {
    const { server, client } = await connect((fake) => {
      fake.addGroup("Overlay Group", "Scene Preview");
      fake.addGroup("Camera Group", "Scene 3");
    });
    const catalog = client.getCatalog();
    expect(catalog.sceneDetails).toEqual(server.sceneNames.map((sceneName) => ({ sceneName, sceneUuid: server.sceneUuidFor(sceneName) })));
    expect(catalog.sceneDetails.map((scene) => scene.sceneName)).toEqual(catalog.scenes);
    expect(catalog.groupDetails).toEqual(server.groups.map((group) => ({ groupName: group.groupName, groupUuid: group.groupUuid })));
    // A copy, not the client's own lists.
    catalog.sceneDetails[0]!.sceneUuid = "changed";
    expect(client.getCatalog().sceneDetails[0]!.sceneUuid).toBe(server.sceneUuidFor(server.sceneNames[0]!));
    // A filter on a group is addressed by the group's UUID.
    server.addFilter(server.groups[0]!.groupUuid, { filterName: "Grade", filterKind: COLOR_FILTER_KIND });
    expect((await client.getSourceFilterList(server.groups[0]!.groupUuid)).map((filter) => filter.filterName)).toEqual(["Grade"]);

    server.emitObsEvent("CurrentSceneCollectionChanging", {});
    await vi.waitFor(() => expect(client.getCatalog().sceneDetails).toEqual([]));
    expect(client.getCatalog().groupDetails).toEqual([]);
    await expect(client.getSourceFilterList(server.groups[0]!.groupUuid)).rejects.toThrow(/changed/);
    server.groups.splice(0);
    server.sceneNames = ["Fresh"];
    server.programSceneName = "Fresh";
    server.previewSceneName = "Fresh";
    server.emitObsEvent("CurrentSceneCollectionChanged", { sceneCollectionName: "Next" });
    await vi.waitFor(() => expect(client.getCatalog().sceneDetails).toEqual([{ sceneName: "Fresh", sceneUuid: server.sceneUuidFor("Fresh") }]));
    expect(client.getCatalog().groupDetails).toEqual([]);
  });
});
