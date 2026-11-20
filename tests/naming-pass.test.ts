// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_CAPTIONS } from "../src/obs/preset-captions.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN_DIR = path.join(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin");
const LOCALE_CODES = ["en", "de", "es", "fr", "ja", "ko", "nl", "zh_CN", "zh_TW"] as const;

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function readLocaleJson(locale: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(PLUGIN_DIR, `${locale}.json`), "utf8")) as Record<string, any>;
}

describe("P1-7 suite naming invariants", () => {
  it("reserves Fadester Companion for the desktop app and calls the deck plugin Fadester for OBS", () => {
    const en = readLocaleJson("en");
    const pi = en.Localization.pi as Record<string, string>;
    const pluginRefKeys = [
      "scopeAllControls",
      "languageNote",
      "connHintRejected",
      "connHintSaved",
      "connHintShared",
      "sliderUnavailable",
      "connIntroMf",
      "passwordPlaceholderSavedAll",
      "passwordSavedAll",
      "tdBannerNeedsUpdate",
    ];
    for (const key of pluginRefKeys) {
      expect(pi[key], `en.json Localization.pi.${key}`).toContain("Fadester for OBS");
      expect(pi[key], `en.json Localization.pi.${key}`).not.toMatch(/Stream Deck Fadester|Stream Deck companion/i);
    }

    for (const locale of LOCALE_CODES) {
      const raw = readFileSync(path.join(PLUGIN_DIR, `${locale}.json`), "utf8");
      expect(raw, `${locale}.json`).not.toMatch(/Stream Deck Fadester|Stream Deck companion/i);
    }

    const panelText = readRepoFile("tourbox/panel/PanelText.cs");
    const panelExtra = readRepoFile("tourbox/panel/PanelExtraText.cs");
    const macPanel = readRepoFile("tourbox/macos/panel/Panel.swift");
    expect(panelText).toContain('"Fadester Companion · last action"');
    expect(panelText).not.toContain('"Fadester · last action"');
    expect(panelExtra).toContain('{ "lastAction", "Fadester Companion · ');
    expect(panelExtra).not.toContain('{ "lastAction", "Fadester · ');
    // The Mac panel takes the same words from the shared catalog (PanelText.cs, via PanelStrings.swift).
    expect(macPanel).toContain('panel.title = L("lastAction")');
    expect(macPanel).not.toContain('"Fadester · last action"');
  });

  it("uses Whole mix for the concept while keeping All OBS mixer inputs as the picker option", () => {
    const en = readLocaleJson("en");
    expect(en.Localization.mixAll).toBe("All OBS mixer inputs");
    expect(en.Localization.mixDisabled).toBe("Whole mix is off");
    expect(en.Localization.pi.mixAll).toBe("All OBS mixer inputs");

    const enRaw = readFileSync(path.join(PLUGIN_DIR, "en.json"), "utf8");
    expect(enRaw).not.toMatch(/Fadester mix master|Mix master/i);

    const mixServer = readRepoFile("tourbox/bridge/MixProtocolServer.cs");
    expect(mixServer).toContain("Fadester Companion setup.");
    expect(mixServer).toContain("Fadester Companion Activity log.");
    expect(mixServer).not.toMatch(/Fadester mix master|Mix master/i);
  });

  it("qualifies Restore as Restore visuals and Restore mix everywhere", () => {
    const en = readLocaleJson("en");
    const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8")) as {
      Actions: Array<{ UUID: string; Tooltip: string }>;
    };
    const panicAction = manifest.Actions.find((a) => a.UUID.endsWith(".visual-panic"));

    expect(en.Localization.vpRestore).toBe("Restore visuals");
    expect(en.Localization.vpLatchedHint).toBe("Hold Restore visuals");
    expect(en.Localization.filterLatched).toBe("Restore visuals first");
    expect(en.Localization.pi.vpOptRestore).toBe("Restore visuals (hold 0.8 s)");
    expect(en.Localization.mixRestore).toBe("Restore mix");
    expect(en.Localization.pi.mixRestore).toBe("Restore mix");
    expect(panicAction?.Tooltip).toContain("Restore visuals");
    expect(PRESET_CAPTIONS.panic.restore.shipped).toContain("Restore");
    expect(PRESET_CAPTIONS.panic.restore.legacy).toContain("Restore visuals");

    const mixDesk = readRepoFile("tourbox/bridge/MixDesk.cs");
    const bridgeProgram = readRepoFile("tourbox/bridge/Program.cs");
    expect(mixDesk).toContain("choose Restore mix to recover original levels");
    expect(bridgeProgram).toContain("Fadester Companion controls are already running");
  });

  it("unifies Clean to Clean FX on keys and Clean / All FX Off in long text", () => {
    const en = readLocaleJson("en");
    expect(en.Localization.cleanFxTitle).toBe("Clean FX");
    expect(en.Localization.cleanFxActiveTitle).toBe("Clean FX");
    expect(en.Localization.cleanFxIdleTitle).toBe("Clean FX");
    expect(en.Localization.pi.pressClean).toBe("Clean FX (0 %)");
    expect(en.Localization.pi.cleanAllFx).toBe("Clean / All FX Off");
    expect(en.Localization.pi.groupAllFx).toBe("Clean / All FX Off");
    expect(en.Localization.pi.allFxClean).toBe("Clean / All FX Off");

    const enRaw = readFileSync(path.join(PLUGIN_DIR, "en.json"), "utf8");
    expect(enRaw).not.toContain('"CLEAN FX"');
    expect(enRaw).not.toContain('"FX CLEAN"');
    expect(enRaw).not.toContain('"Clean (0 %)"');
    expect(enRaw).not.toContain("Clean All FX");
  });

  it("uses Layer 1 / Layer 2 for sources and Program / Preview for scenes", () => {
    const en = readLocaleJson("en");
    const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8")) as {
      Actions: Array<{ UUID: string; Tooltip: string }>;
    };
    const infobar = manifest.Actions.find((a) => a.UUID.endsWith(".obs-neo-infobar"));
    const obsFader = manifest.Actions.find((a) => a.UUID.endsWith(".obs-fader"));

    expect(en.Localization.pi.leftLayer).toBe("Layer 1");
    expect(en.Localization.pi.rightLayer).toBe("Layer 2");
    expect(en.Localization.mixerLive).toBe("PROGRAM");
    expect(en.Localization.mixerNext).toBe("PREVIEW");
    expect(en.Localization.mixerLiveScene).toBe("Program");
    expect(en.Localization.layerRoleLive).toBe("PROGRAM");
    expect(en.Localization.infobarLive).toBe("PROGRAM  {scene}");
    expect(en.Localization.mixerPressTake).toBe("Press: Preview to Program");
    expect(en.Localization.pi.controlTbar).toBe("Switch scenes (T-bar)");
    expect(infobar?.Tooltip).toContain("the Program scene and, in Studio Mode, the Preview scene");
    expect(obsFader?.Tooltip).toContain("fade Preview into Program");

    const enRaw = readFileSync(path.join(PLUGIN_DIR, "en.json"), "utf8");
    expect(enRaw).not.toMatch(/Program \(Live\)|take NEXT live|takes Next live/);
  });

  it("uses Cue to start for Tape Deck and Preview where Companion puts a scene in Preview", () => {
    const en = readLocaleJson("en");
    expect(en.Localization.tdOpCue).toBe("Cue to start");
    expect(en.Localization.pi.tdOptCue).toBe("Cue to start");

    const panelText = readRepoFile("tourbox/panel/PanelText.cs");
    const macPanel = readRepoFile("tourbox/macos/panel/Panel.swift");
    const deskActions = readRepoFile("tourbox/bridge/DeskActions.cs");
    expect(panelText).toContain('{ "cueTitle", new[] { "3   Try Preview"');
    expect(macPanel).toContain('heading(L("cueTitle")');
    expect(deskActions).toContain("Select another Preview scene first.");
    expect(deskActions).not.toContain("Cue another scene first.");
  });

  it("documents the canonical product and control terms in START-HERE.md", () => {
    const startHere = readRepoFile("docs/START-HERE.md");
    expect(startHere).toContain("## 4. Names");
    for (const term of [
      "Fadester for OBS",
      "Fadester Companion",
      "Whole mix",
      "All OBS mixer inputs",
      "Restore visuals",
      "Restore mix",
      "Clean FX",
      "Clean / All FX Off",
      "Layer 1 / Layer 2",
      "Program",
      "Preview",
      "Cue to start",
    ]) {
      expect(startHere).toContain(term);
    }
  });

  it("uses the canonical Program/Preview, Restore visuals/mix, and Fadester for OBS terms in README.md", () => {
    const readme = readRepoFile("README.md");
    // The T-bar's name in the Control list, as the settings page words it (pi.controlTbar).
    expect(readme).toContain("**Switch scenes (T-bar)**");
    expect(readme).toContain("PROGRAM and PREVIEW scenes");
    expect(readme).not.toContain("Blend Program into Preview");
    expect(readme).toContain("Restore mix returns each managed input");
    expect(readme).toContain("Restore visuals");
    expect(readme).toContain("Choose a different Preview");
    expect(readme).not.toContain("Blend Live into Next scene");
    expect(readme).not.toContain("Choose a different Next scene");
    expect(readme).not.toContain("Preview cueing");
    expect(readme).not.toContain("Hold **Restore** for 0.8 s");
  });

  it("never says \"take\" for the product's actions in the user's documents, and names thirteen languages", () => {
    // Sending Preview to Program is "Preview to Program", a fade or a cut; "take" stays an ordinary English verb
    // ("takes over the link port"). The action id `take` in the Companion's map is code, shown in backticks.
    const product = /\btak(e|es|ing|en)\b[^.|\n]{0,24}\b(Preview|Program|live|Next|scene)\b|\b(a|the|each|next|fallback|quantized) takes?\b|\*\*Take\*\*|\| Take\b/i;
    for (const file of ["README.md", "DECK-LAYOUTS.md", "docs/START-HERE.md", "docs/OPENDECK.md", "docs/SUITE.md",
      "docs/gamepad/README.md", "docs/ADD-YOUR-OWN-CONTROLLER.md", "profiles/README.md"]) {
      const text = readRepoFile(file);
      const hit = product.exec(text);
      expect(hit ? `${file}: ${hit[0]}` : "", file).toBe("");
      expect(text, file).not.toContain("starter layout");
      expect(text, file).not.toMatch(/\b(Scene & Transition|OBS Fader|OBS Filter)\b/);
    }
    const readme = readRepoFile("README.md");
    expect(readme).toContain("Thirteen languages.");
    expect(readme).toContain("speaks thirteen languages");
    for (const file of ["docs/vjster/README.md", "docs/vjster/INSTALL.md"]) expect(readRepoFile(file), file).toContain("thirteen languages");
  });
});
