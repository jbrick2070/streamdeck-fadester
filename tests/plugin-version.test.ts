// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { displayVersion } from "../src/pi/plugin-version.js";
import { PLUGIN_DIR } from "./helpers/languages.js";

describe("The version every settings page shows", () => {
  it("drops only the manifest's fourth (build) part", () => {
    expect(displayVersion("0.12.1.0")).toBe("0.12.1");
    expect(displayVersion("0.13.0.0")).toBe("0.13.0");
    expect(displayVersion("1.0.0.0")).toBe("1.0.0");
    expect(displayVersion("0.13.0.7")).toBe("0.13.0");
    expect(displayVersion("0.13.0")).toBe("0.13.0");
    expect(displayVersion("")).toBe("");
  });

  it("is on every Fadester inspector page the manifest names", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "manifest.json"), "utf8")) as {
      Actions: Array<{ PropertyInspectorPath?: string }>;
    };
    const pages = [...new Set(manifest.Actions.map((action) => action.PropertyInspectorPath ?? ""))]
      .filter((page) => page.startsWith("ui/") && !page.startsWith("ui/vjster/"));
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      const html = readFileSync(join(PLUGIN_DIR, page), "utf8");
      expect(html, page).toContain('<script src="plugin-version.js"></script>');
    }
  });
});
