// SPDX-License-Identifier: GPL-2.0-or-later
// koffi must stay outside every bundle. Bundled into bin/fadester.js, koffi's loader looks for its native addon
// relative to bin/ instead of bin/node_modules/koffi, finds nothing and the plugin stops at start with
// "Cannot find the native Koffi module" (Fadester for OBS 0.12.0 to 0.12.15 on Windows). The unit tests import the
// TypeScript sources, so only a look at the build config and the built bundle catches it.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const BIN = resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "bin");

describe("koffi stays outside the bundles", () => {
  it("every rollup entry lists koffi as external", async () => {
    const mod = (await import(pathToFileURL(resolve(ROOT, "rollup.config.mjs")).href)) as {
      default: Array<{ input: string; external?: unknown }>;
    };
    const config = mod.default;
    expect(config.length).toBeGreaterThan(0);
    for (const entry of config) {
      const external = Array.isArray(entry.external) ? entry.external : [];
      expect(external, `${entry.input} must keep koffi external`).toContain("koffi");
    }
  });

  for (const name of ["fadester.js", "uia-worker.js", "ax-worker.js"]) {
    const file = resolve(BIN, name);
    it.runIf(existsSync(file))(`built bin/${name} imports koffi instead of carrying its loader`, () => {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("Cannot find the native Koffi module");
      expect(text).not.toMatch(/function loadDynamic\(dirname/);
    });
  }

  it.runIf(existsSync(resolve(BIN, "fadester.js")))("the staged koffi ships its Windows and Mac addons", () => {
    for (const triplet of ["win32_x64", "win32_arm64", "darwin_x64", "darwin_arm64"]) {
      expect(existsSync(resolve(BIN, "node_modules", "koffi", "build", "koffi", triplet, "koffi.node")), triplet).toBe(true);
    }
  });
});
