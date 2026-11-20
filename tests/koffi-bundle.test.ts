// SPDX-License-Identifier: GPL-2.0-or-later
// koffi must stay outside every bundle. Bundled into bin/fadester.js, koffi's loader looks for its native addon
// relative to bin/ instead of bin/node_modules/koffi, finds nothing and the plugin stops at start with
// "Cannot find the native Koffi module" (Fadester for OBS 0.12.0 to 0.12.15). The unit tests import the TypeScript
// sources, so only a look at the build config and the built files catches it. In CI the plugin is built before the
// tests run, so the built files must be there; locally the checks of built files run only after a build.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const BIN = resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "bin");
const KOFFI = resolve(BIN, "node_modules", "koffi");
const IN_CI = process.env.CI === "true";
const built = (file: string) => IN_CI || existsSync(file);

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

  it("the setup checklist loads koffi only when a probe needs it, never at import", () => {
    const source = readFileSync(resolve(ROOT, "src", "obs", "setup-checklist.ts"), "utf8");
    expect(source).not.toMatch(/^import koffi from "koffi";/m);
    expect(source).toMatch(/function loadKoffi\(\)/);
  });

  for (const name of ["fadester.js", "uia-worker.js", "ax-worker.js"]) {
    const file = resolve(BIN, name);
    it.runIf(built(file))(`built bin/${name} does not carry koffi's loader`, () => {
      expect(existsSync(file), `${file} is built`).toBe(true);
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("Cannot find the native Koffi module");
      expect(text).not.toMatch(/function loadDynamic\(dirname/);
    });
  }

  it.runIf(built(resolve(BIN, "fadester.js")))("koffi is staged with its loader and its Windows and Mac addons", () => {
    for (const file of ["package.json", "index.js", "index.cjs"]) {
      expect(existsSync(resolve(KOFFI, file)), file).toBe(true);
    }
    for (const triplet of ["win32_x64", "win32_arm64", "darwin_x64", "darwin_arm64"]) {
      expect(existsSync(resolve(KOFFI, "build", "koffi", triplet, "koffi.node")), triplet).toBe(true);
    }
  });
});

// G-01: the setup checklist loads koffi with createRequire(...)("koffi"), which takes package.json's "require" entry,
// index.cjs. That file is one line, `require("./src/koffi/index.cjs")`; with only the ES module files staged the
// packaged plugin could not load koffi that way, and three checklist probes always answered "unknown".
describe("koffi's CommonJS side is staged too", () => {
  const temp: string[] = [];
  afterAll(() => { for (const dir of temp) rmSync(dir, { recursive: true, force: true }); });
  const stage = async (): Promise<string> => {
    const { stageKoffi } = (await import(pathToFileURL(resolve(ROOT, "scripts", "native", "stage-koffi.mjs")).href)) as {
      stageKoffi: (root?: string, outBinDir?: string) => { koffiDir: string };
    };
    const bin = mkdtempSync(join(tmpdir(), "fadester-staged-koffi-"));
    temp.push(bin);
    return stageKoffi(undefined, bin).koffiDir;
  };
  const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

  it("every file a staged .cjs file requires by path is staged", async () => {
    const koffiDir = await stage();
    const main = (JSON.parse(readFileSync(join(koffiDir, "package.json"), "utf8")) as { exports: Record<string, { require: string }> }).exports;
    const scripts = filesUnder(koffiDir).filter((file) => file.endsWith(".cjs"));
    expect(scripts.map((file) => file.slice(koffiDir.length + 1).replace(/\\/g, "/")).sort()).toEqual(
      ["index.cjs", "indirect.cjs", "src/koffi/index.cjs", "src/koffi/indirect.cjs", "src/koffi/src/static.cjs"]);
    for (const entry of [main["."].require, main["./indirect"].require]) {
      expect(existsSync(join(koffiDir, entry)), entry).toBe(true);
    }
    for (const script of scripts) {
      for (const [, relative] of readFileSync(script, "utf8").matchAll(/\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
        expect(existsSync(resolve(dirname(script), relative)), `${script} requires ${relative}`).toBe(true);
      }
    }
  });

  // As setup-checklist.ts loadKoffi does, from a folder with no other node_modules above it. In a process of its own:
  // this one may already hold the repository's koffi. Only where koffi has an addon staged (Windows and macOS).
  it.runIf(process.platform === "win32" || process.platform === "darwin")(
    "createRequire(\"koffi\") loads from the staged tree, as the setup checklist does", async () => {
      const koffiDir = await stage();
      const bin = resolve(koffiDir, "..", "..");
      const script = [
        "const { createRequire } = require('node:module');",
        "const { pathToFileURL } = require('node:url');",
        "const nativeRequire = createRequire(pathToFileURL(process.argv[1]).href);",
        "const koffi = nativeRequire('koffi');",
        "process.stdout.write(JSON.stringify({ from: nativeRequire.resolve('koffi'), load: typeof koffi.load, errno: typeof koffi.errno }));"
      ].join("\n");
      const run = spawnSync(process.execPath, ["-e", script, join(bin, "fadester.js")], { cwd: bin, encoding: "utf8", timeout: 20_000 });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const loaded = JSON.parse(run.stdout) as { from: string; load: string; errno: string };
      expect(resolve(loaded.from)).toBe(resolve(koffiDir, "index.cjs"));
      expect(loaded).toMatchObject({ load: "function", errno: "function" });
    });
});
