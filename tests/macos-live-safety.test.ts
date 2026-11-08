// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import { checkedCall, liveConfig, MAC_COLOR_FIXTURE, ObsRequestFailure, removable, removeOwnedInput, requireExpectedView, requireIdle, requireOnlyFixtureInputs, requireUnchangedFixtures, silentWav, type ObsCall } from "../scripts/macos/live-safety.js";

describe("Mac-only live harness safety", () => {
  const env = { FADESTER_MAC_LIVE: "1", FADESTER_MAC_OBS_PORT: "4455", FADESTER_MAC_OBS_PASSWORD: "test-only-secret" };
  it("refuses Windows before any live setup can begin", () => {
    expect(() => liveConfig("win32", env)).toThrow(/only on macOS/);
    expect(() => liveConfig("darwin", {})).toThrow(/opt into/);
    expect(() => liveConfig("darwin", { ...env, FADESTER_MAC_OBS_PASSWORD: "" })).toThrow(/required/);
    expect(liveConfig("darwin", env)).toMatchObject({ port: 4455, mix: false });
  });
  it.each(["GetStreamStatus", "GetRecordStatus", "GetReplayBufferStatus", "GetVirtualCamStatus"])("rejects an active %s", async (active) => {
    await expect(requireIdle(async (type) => ({ outputActive: type === active }))).rejects.toThrow(/active or unknown/);
  });
  it("fails closed for unknown output state", async () => {
    await expect(requireIdle(async () => ({}))).rejects.toThrow(/unknown/);
    await expect(requireIdle(async () => ({ outputActive: false }))).resolves.toBeUndefined();
  });
  it("accepts only Replay Buffer's typed 604 absent-output response", async () => {
    await expect(requireIdle(async (type) => {
      if (type === "GetReplayBufferStatus") throw new ObsRequestFailure(type, 604);
      return { outputActive: false };
    })).resolves.toBeUndefined();
    for (const error of [new ObsRequestFailure("GetStreamStatus", 604), new ObsRequestFailure("GetReplayBufferStatus", 500), new Error("OBS GetReplayBufferStatus failed (604)")]) {
      await expect(requireIdle(async () => { throw error; })).rejects.toThrow();
    }
  });
  it("rejects a hazard arriving during an awaited guard read before continuing", async () => {
    let hazard = false, requests = 0;
    const call = checkedCall(async () => { requests++; await Promise.resolve(); hazard = true; return { outputActive: false }; }, () => { if (hazard) throw new Error("output started"); });
    await expect(requireIdle(call)).rejects.toThrow("output started");
    expect(requests).toBe(1);
  });
  it("preserves an external Preview or Studio Mode change even when Program is still a fixture", () => {
    const expected = { studio: true, program: ["fixture-program"], preview: ["fixture-preview"] };
    expect(() => requireExpectedView({ studio: true, program: "fixture-program", preview: "operator-preview" }, expected)).toThrow(/preserving operator/);
    expect(() => requireExpectedView({ studio: false, program: "fixture-program", preview: "" }, expected)).toThrow(/preserving operator/);
    expect(() => requireExpectedView({ studio: true, program: "fixture-program", preview: "fixture-preview" }, expected)).not.toThrow();
  });
  it("preflights every fixture and parent contents before any deletion", () => {
    const prefix = "Fadester Mac Test 12345678 ";
    const scene = { name: prefix + "Blue", uuid: "scene" }, input = { name: prefix + "Color", uuid: "input" };
    const item = { sceneUuid: scene.uuid, itemId: 1, sourceUuid: input.uuid, sourceName: input.name };
    const validate = (inputs = [input], items = [item]) => requireUnchangedFixtures([scene], [input], [item], [scene], inputs, items, prefix);
    expect(() => validate()).not.toThrow();
    expect(() => validate([{ ...input, name: "Operator rename" }])).toThrow(/renamed/);
    expect(() => validate([{ ...input, uuid: "replacement" }])).toThrow(/replaced/);
    expect(() => validate([input], [item, { ...item, itemId: 2, sourceUuid: "operator-source", sourceName: "New content" }])).toThrow(/contents changed/);
    expect(() => validate([input], [{ ...item, sourceUuid: "replacement", sourceName: "Replacement" }])).toThrow(/contents changed/);
    expect(() => validate([input], [item, { ...item, sceneUuid: "operator-group", itemId: 99 }])).toThrow(/referenced elsewhere/);
    expect(() => validate([input], [item, { sceneUuid: "operator-scene", itemId: 3, sourceUuid: scene.uuid, sourceName: scene.name }])).toThrow(/referenced elsewhere/);
  });
  it("deletes only this run's exact name and UUID, never replacements or operator-renamed sources", () => {
    const prefix = "Fadester Mac Test a1b2c3d4 ";
    const own = { name: prefix + "Blue", uuid: "owned-uuid" };
    expect(removable([own], [own], prefix)).toEqual([own]);
    expect(removable([own], [{ ...own, uuid: "replacement" }], prefix)).toEqual([]);
    expect(removable([own], [{ ...own, name: "Operator renamed" }], prefix)).toEqual([]);
    expect(removable([{ name: "Unrelated", uuid: "other" }], [{ name: "Unrelated", uuid: "other" }], prefix)).toEqual([]);
  });
  it("allows auto-destruction only after the input's final owned item was detached", () => {
    const prefix = "Fadester Mac Test 12345678 ";
    const scene = { name: prefix + "Blue", uuid: "scene" }, input = { name: prefix + "Color", uuid: "input" };
    const item = { sceneUuid: scene.uuid, itemId: 1, sourceUuid: input.uuid, sourceName: input.name };
    const detached = new Set([input.uuid]);
    expect(() => requireUnchangedFixtures([scene], [input], [item], [scene], [], [item], prefix, detached)).toThrow(/removed/);
    expect(() => requireUnchangedFixtures([scene], [input], [], [scene], [], [], prefix, detached)).not.toThrow();
    for (const replacement of [{ ...input, name: "Operator rename" }, { ...input, uuid: "replacement" }]) {
      expect(() => requireUnchangedFixtures([scene], [input], [], [scene], [replacement], [], prefix, detached)).toThrow(/renamed or replaced/);
    }
    expect(() => requireUnchangedFixtures([scene], [input], [], [scene], [input], [{ ...item, sceneUuid: "operator-scene" }], prefix, detached)).toThrow(/referenced elsewhere/);
  });
  describe("inactive OBS source cleanup", () => {
    function model(mode: "retained" | "automatic" | "late" | "unproven" | "uncertain" | "external") {
      const prefix = "Fadester Mac Test 12345678 ";
      const scene = { name: prefix + "Blue", uuid: "scene" }, input = { name: prefix + "Color", uuid: "input" };
      const item = { sceneUuid: scene.uuid, itemId: 1, sourceUuid: input.uuid, sourceName: input.name };
      let actualItems = [item], plannedItems = [item], present = true, markedRemoved = false;
      const detachedInputs = new Set<string>(), writes: string[] = [];
      const preflight = async (): Promise<void> => requireUnchangedFixtures([scene], [input], plannedItems, [scene], present ? [input] : [], actualItems, prefix, detachedInputs);
      const write: ObsCall = async (type, data) => {
        writes.push(type);
        if (type === "RemoveSceneItem") {
          expect(data).toEqual({ sceneUuid: scene.uuid, sceneItemId: item.itemId });
          if (mode === "uncertain") throw new Error("Response lost");
          actualItems = [];
          if (mode === "automatic") present = false;
          if (mode === "external") actualItems.push({ ...item, sceneUuid: "operator-scene" });
        } else if (type === "RemoveInput") {
          expect(data).toEqual({ inputUuid: input.uuid });
          if (mode === "late") { present = false; throw new ObsRequestFailure(type, 600); }
          if (mode === "unproven") throw new ObsRequestFailure(type, 600);
          // OBS 33 marks the source removed, but inactive scene references keep it alive.
          // No rendering is simulated: the test would hang/fail with input-first cleanup.
          markedRemoved = true;
          if (actualItems.length === 0) present = false;
        } else throw new Error(`Unexpected write ${type}`);
        return {};
      };
      const run = (): Promise<void> => removeOwnedInput(input, [item], {
        preflight, write,
        inputs: async () => present ? [input] : [],
        detached: () => { plannedItems = []; detachedInputs.add(input.uuid); },
        waitAbsent: async () => { await preflight(); if (present) throw new Error("Input still retained by inactive scene"); }
      });
      return { run, writes, state: () => ({ present, markedRemoved, plannedItems: plannedItems.length, actualItems: actualItems.length }) };
    }
    it("releases inactive item references before marking/removing a retained input", async () => {
      const obs = model("retained");
      await obs.run();
      expect(obs.writes).toEqual(["RemoveSceneItem", "RemoveInput"]);
      expect(obs.state()).toEqual({ present: false, markedRemoved: true, plannedItems: 0, actualItems: 0 });
    });
    it("skips RemoveInput when detaching the last item already destroys it", async () => {
      const obs = model("automatic");
      await obs.run();
      expect(obs.writes).toEqual(["RemoveSceneItem"]);
      expect(obs.state().present).toBe(false);
    });
    it("proves absence after a late auto-destruction response without retrying the mutation", async () => {
      const obs = model("late");
      await obs.run();
      expect(obs.writes).toEqual(["RemoveSceneItem", "RemoveInput"]);
      expect(obs.state().present).toBe(false);
    });
    it("does not advance ownership or retry after an uncertain item-removal response", async () => {
      const obs = model("uncertain");
      await expect(obs.run()).rejects.toThrow("Response lost");
      expect(obs.writes).toEqual(["RemoveSceneItem"]);
      expect(obs.state()).toMatchObject({ present: true, plannedItems: 1 });
    });
    it("does not accept a not-found response without actual absence proof", async () => {
      const obs = model("unproven");
      await expect(obs.run()).rejects.toThrow("Input still retained");
      expect(obs.writes).toEqual(["RemoveSceneItem", "RemoveInput"]);
    });
    it("preserves an input newly referenced by an operator scene after detachment", async () => {
      const obs = model("external");
      await expect(obs.run()).rejects.toThrow(/referenced elsewhere/);
      expect(obs.writes).toEqual(["RemoveSceneItem"]);
      expect(obs.state().present).toBe(true);
    });
  });
  it("refuses whole-mix writes with any unrelated/global input", () => {
    const own = { name: "Fixture", uuid: "own" };
    expect(() => requireOnlyFixtureInputs([own], [own])).not.toThrow();
    expect(() => requireOnlyFixtureInputs([own, { name: "Desktop audio", uuid: "other" }], [own])).toThrow(/only this run/);
    expect(() => requireOnlyFixtureInputs([], [own])).toThrow(/only this run/);
  });
  it("requires separate mix and fixed-Color opt-ins", () => {
    expect(liveConfig("darwin", env).allowColorFixture).toBe(false);
    expect(() => liveConfig("darwin", { ...env, FADESTER_MAC_MIX_ALLOW_COLOR_FIXTURE: "1" })).toThrow(/requires/);
    expect(liveConfig("darwin", { ...env, FADESTER_MAC_MIX: "1", FADESTER_MAC_MIX_ALLOW_COLOR_FIXTURE: "1" }).allowColorFixture).toBe(true);
    expect(() => requireOnlyFixtureInputs([MAC_COLOR_FIXTURE], [])).toThrow(/only this run/);
    expect(() => requireOnlyFixtureInputs([MAC_COLOR_FIXTURE], [], true)).not.toThrow();
  });
  it("allows the exact non-audio Color alongside owned inputs and rechecks its identity", () => {
    const own = { name: "Fixture audio", uuid: "own", kind: "ffmpeg_source", caps: 2 };
    expect(() => requireOnlyFixtureInputs([MAC_COLOR_FIXTURE, own], [own], true)).not.toThrow();
    for (const change of [{ uuid: "replacement" }, { name: "Renamed" }, { kind: "browser_source" }]) {
      expect(() => requireOnlyFixtureInputs([{ ...MAC_COLOR_FIXTURE, ...change }, own], [own], true)).toThrow(/Color fixture changed/);
    }
    expect(() => requireOnlyFixtureInputs([own], [own], true)).toThrow(/Color fixture changed/);
    expect(() => requireOnlyFixtureInputs([MAC_COLOR_FIXTURE, MAC_COLOR_FIXTURE, own], [own], true)).toThrow(/Color fixture changed/);
  });
  it.each([undefined, null, "32777", NaN, -1, 32777.5, 32779, 32841, 1, 0, 98313])("rejects unknown, audio, composite or changed Color capabilities (%s)", (caps) => {
    expect(() => requireOnlyFixtureInputs([{ ...MAC_COLOR_FIXTURE, caps }], [], true)).toThrow(/capabilities/);
  });
  it("never widens the Color exception to another non-fixture input", () => {
    for (const other of [
      { ...MAC_COLOR_FIXTURE, uuid: "another-color", name: "Another color" },
      { uuid: "mic", name: "Mic", kind: "coreaudio_input_capture", caps: 2 },
      { uuid: "composite", name: "Composite", kind: "custom", caps: 64 },
      { uuid: "unknown", name: "Unknown" }
    ]) expect(() => requireOnlyFixtureInputs([MAC_COLOR_FIXTURE, other], [], true)).toThrow(/only this run/);
  });
  it("uses a silent local PCM fixture rather than capture or remote media", () => {
    const wav = silentWav();
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(wav.subarray(44).every((byte) => byte === 0)).toBe(true);
  });
});
