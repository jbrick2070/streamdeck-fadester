// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from "vitest";
import {
  automaticInputLabel, migrateAutomaticInputSettings, resolveAutomaticInputName
} from "../src/obs/automatic-targets.js";

describe("automatic mixer targets", () => {
  it("prefers exact main-audio roles in order, case-insensitively", () => {
    const names = ["System Audio", "Desktop", "DESKTOP AUDIO", "mUsIc", "Mic/Aux"];
    expect(resolveAutomaticInputName("__audio_main__", names)).toBe("mUsIc");
    expect(resolveAutomaticInputName("__audio_main__", names.filter((name) => name !== "mUsIc")))
      .toBe("DESKTOP AUDIO");
    expect(resolveAutomaticInputName("__audio_main__", ["Desktop", "System Audio"]))
      .toBe("Desktop");
    expect(resolveAutomaticInputName("__audio_main__", ["Game", "System Audio"]))
      .toBe("System Audio");
  });

  it("finds named main audio before falling back to the first non-microphone input", () => {
    expect(resolveAutomaticInputName("__audio_main__", ["Game", "Background Music", "Mic/Aux"]))
      .toBe("Background Music");
    expect(resolveAutomaticInputName("__audio_main__", ["Game", "Desktop capture audio"]))
      .toBe("Desktop capture audio");
    expect(resolveAutomaticInputName("__audio_main__", ["USB Microphone", "Game", "Browser"]))
      .toBe("Game");
    expect(resolveAutomaticInputName("__audio_main__", ["Mic/Aux", "USB MICROPHONE"]))
      .toBe("");
    expect(resolveAutomaticInputName("__audio_main__", ["MicMix", "Game"]))
      .toBe("Game");
  });

  it("selects microphone roles without selecting arbitrary audio when none exists", () => {
    expect(resolveAutomaticInputName("__audio_mic__", ["Mic", "Microphone", "mIC/aUX"]))
      .toBe("mIC/aUX");
    expect(resolveAutomaticInputName("__audio_mic__", ["Mic", "MICROPHONE"]))
      .toBe("MICROPHONE");
    expect(resolveAutomaticInputName("__audio_mic__", ["Music", "USB Microphone", "Game"]))
      .toBe("USB Microphone");
    expect(resolveAutomaticInputName("__audio_mic__", ["Music", "Desktop Audio", "Game"]))
      .toBe("");
    expect(resolveAutomaticInputName("__audio_mic__", ["Music", "MicMix", "Game"]))
      .toBe("MicMix");
  });

  it("resolves zero-based input positions without wrapping or substituting a role", () => {
    const names = ["Game", "Mic/Aux", "Music"];
    expect(resolveAutomaticInputName("__audio_input_0__", names)).toBe("Game");
    expect(resolveAutomaticInputName("__audio_input_1__", names)).toBe("Mic/Aux");
    expect(resolveAutomaticInputName("__audio_input_2__", names)).toBe("Music");
    expect(resolveAutomaticInputName("__audio_input_3__", names)).toBe("");
    expect(resolveAutomaticInputName("__audio_input_-1__", names)).toBe("");
  });

  it("gives Aux a distinct spare input regardless of where Main and Mic occur", () => {
    const names = ["Game", "Desktop Audio", "Mic/Aux"];
    expect(resolveAutomaticInputName("__audio_aux__", names)).toBe("Game");
    expect(resolveAutomaticInputName("__audio_input_2__", names)).toBe("Mic/Aux");
    expect(resolveAutomaticInputName("__audio_aux__", ["Music", "Mic/Aux", "Browser"])).toBe("Browser");
    expect(resolveAutomaticInputName("__audio_aux__", ["Music", "Mic/Aux"])).toBe("");
    expect(resolveAutomaticInputName("__audio_aux__", ["Game"])).toBe("");
    expect(resolveAutomaticInputName("__audio_aux__", [])).toBe("");
  });

  it("preserves explicit names only while present and never migrates blank targets", () => {
    const names = ["Music", "Mic/Aux"];
    expect(resolveAutomaticInputName("Music", names)).toBe("Music");
    expect(resolveAutomaticInputName("music", names)).toBe("");
    expect(resolveAutomaticInputName("Removed source", names)).toBe("");
    expect(resolveAutomaticInputName("", names)).toBe("");
    for (const target of ["__audio_main__", "__audio_mic__", "__audio_input_0__"]) {
      expect(resolveAutomaticInputName(target, [])).toBe("");
    }
  });

  it("describes automatic targets without relabeling explicit names", () => {
    expect(automaticInputLabel("__audio_main__")).toBe("Main audio (automatic)");
    expect(automaticInputLabel("__audio_mic__")).toBe("Microphone (automatic)");
    expect(automaticInputLabel("__audio_aux__")).toBe("Aux audio (automatic)");
    expect(automaticInputLabel("__audio_input_0__")).toBe("Audio input 1 (automatic)");
    expect(automaticInputLabel("__audio_input_2__")).toBe("Audio input 3 (automatic)");
    expect(automaticInputLabel("Music")).toBeUndefined();
    expect(automaticInputLabel("")).toBeUndefined();
  });
});

describe("shipped audio placeholder migration", () => {
  it.each([
    ["Music", "__audio_main__"], ["Music down", "__audio_main__"], ["Music up", "__audio_main__"],
    ["Desktop", "__audio_main__"], ["Desktop down", "__audio_main__"], ["Desktop up", "__audio_main__"],
    ["Audio", "__audio_main__"], ["Audio down", "__audio_main__"], ["Audio up", "__audio_main__"],
    ["Mic", "__audio_mic__"], ["Mic down", "__audio_mic__"], ["Mic up", "__audio_mic__"],
    ["Aux", "__audio_input_2__"], ["Aux down", "__audio_input_2__"], ["Aux up", "__audio_input_2__"]
  ])("upgrades the unbound %s preset control", (labelOverride, inputName) => {
    const raw = { inputName: "", labelOverride, target: "input_volume", step: 0.1 };
    expect(migrateAutomaticInputSettings(raw)).toEqual({ ...raw, inputName, presetBindingsVersion: 1 });
    expect(raw.inputName).toBe("");
  });

  it("allows whitespace and case differences without matching partial custom labels", () => {
    expect(migrateAutomaticInputSettings({ inputName: "  ", labelOverride: "  mIC UP  " }))
      .toMatchObject({ inputName: "__audio_mic__", presetBindingsVersion: 1 });
    for (const labelOverride of ["Music custom", "Custom Mic", "Mic mute", "", "Auxiliary"]) {
      const raw = { inputName: "", labelOverride };
      expect(migrateAutomaticInputSettings(raw)).toBe(raw);
    }
  });

  it("preserves explicit bindings, unknown controls, and intentional clears after migration", () => {
    const explicit = { inputName: "My music source", labelOverride: "Music" };
    expect(migrateAutomaticInputSettings(explicit)).toEqual({ ...explicit, presetBindingsVersion: 1 });
    const automatic = { inputName: "__audio_input_0__", labelOverride: "Mic" };
    expect(migrateAutomaticInputSettings(automatic)).toEqual({ ...automatic, presetBindingsVersion: 1 });
    const unrelated = { labelOverride: "Custom control", otherSetting: true };
    expect(migrateAutomaticInputSettings(unrelated)).toBe(unrelated);
    const cleared = { inputName: "", labelOverride: "Mic", presetBindingsVersion: 1 };
    expect(migrateAutomaticInputSettings(cleared)).toBe(cleared);
    const upgraded = migrateAutomaticInputSettings({ labelOverride: "Music" });
    expect(migrateAutomaticInputSettings(upgraded)).toBe(upgraded);
  });

  it("marks newly bound presets before a later intentional clear", () => {
    const initial = { inputName: "__audio_main__", labelOverride: "Music" };
    const firstAppearance = migrateAutomaticInputSettings(initial);
    expect(firstAppearance).toEqual({ ...initial, presetBindingsVersion: 1 });
    const cleared = { ...firstAppearance, inputName: "" };
    expect(migrateAutomaticInputSettings(cleared)).toBe(cleared);
    expect(cleared.inputName).toBe("");
    expect(initial).not.toHaveProperty("presetBindingsVersion");
  });
});
