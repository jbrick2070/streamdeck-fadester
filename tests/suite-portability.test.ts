// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPortablePlugin } from "../scripts/suite/package-candidate.js";

const temps: string[] = [];
afterEach(() => {
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(change: Record<string, unknown> = {}): string {
  const path = mkdtempSync(join(tmpdir(), "fadester-package-portability-"));
  temps.push(path);
  mkdirSync(join(path, "bin"));
  mkdirSync(join(path, "ui"));
  writeFileSync(join(path, "bin", "plugin.js"), "export {};\n");
  writeFileSync(join(path, "ui", "settings.html"), "<!doctype html>\n");
  writeFileSync(join(path, "manifest.json"), JSON.stringify({
    UUID: "test.fadester", Version: "0.10.0.0", CodePath: "bin/plugin.js", Nodejs: { Version: "24" },
    OS: [{ Platform: "mac", MinimumVersion: "13.5" }, { Platform: "windows", MinimumVersion: "10" }],
    Actions: [{ UUID: "test.fadester.action", PropertyInspectorPath: "ui/settings.html" }],
    ...change
  }));
  return path;
}

describe("one Stream Deck package for Windows and macOS", () => {
  it("accepts one shared Node entry point and paths with exact case", () => {
    expect(checkPortablePlugin(fixture()).UUID).toBe("test.fadester");
  });

  it("catches missing macOS support before a candidate is shipped", () => {
    expect(() => checkPortablePlugin(fixture({ OS: [{ Platform: "windows", MinimumVersion: "10" }] }))).toThrow(/same manifest/);
  });

  it("rejects settings page case errors even on a Windows builder", () => {
    expect(() => checkPortablePlugin(fixture({ Actions: [{ UUID: "test.fadester.action", PropertyInspectorPath: "UI/settings.html" }] }))).toThrow(/case-mismatched/);
  });

  it("catches an action still hidden on one platform", () => {
    expect(() => checkPortablePlugin(fixture({ Actions: [{ UUID: "test.fadester.action", OS: ["windows"] }] }))).toThrow(/both platforms/);
  });

  it("allows optional platform assets without mistaking them for the shared entry point", () => {
    const path = fixture();
    writeFileSync(join(path, "bin", "optional-windows-helper.exe"), "optional asset");
    expect(checkPortablePlugin(path).CodePath).toBe("bin/plugin.js");
  });

  it("does not accept a separate Windows executable override", () => {
    expect(() => checkPortablePlugin(fixture({ CodePathWin: "bin/helper.exe" }))).toThrow(/shared Node/);
  });
});
