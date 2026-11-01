// SPDX-License-Identifier: GPL-2.0-or-later
// The Suite Demo Kit's install-check (demo-kit/check-kit.py, kit_check.py) and zip
// (kit_package.py) are Python; their unit tests are demo-kit/test_check_kit.py, standard library
// only. This runs them inside vitest so the gate and the mutation runner see them; they are
// skipped, with the reason, only when no Python 3.10+ is on this machine. It also checks the
// speed run's deck layout (scripts/kit-speed-run.ts) against demo-kit/kit-layouts.json. No OBS
// is started; the live rows are run by hand (demo-kit/TESTING.md).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kitSpeedLayout } from "../scripts/kit-speed-run.js";

const ROOT = process.cwd();
const PYTHON = process.env.PYTHON ?? "python";

const probe = spawnSync(PYTHON, ["-B", "-c", "import sys; assert sys.version_info >= (3, 10)"], { encoding: "utf8" });
const pythonReady = probe.status === 0;
if (!pythonReady) {
  console.warn(`demo-kit check tests skipped: ${PYTHON} 3.10+ not found (${probe.error?.message ?? probe.stderr})`);
}

describe("demo-kit install-check and zip (check-kit.py, kit_check.py, kit_package.py)", () => {
  it.skipIf(!pythonReady)("passes its Python unit tests", () => {
    const run = spawnSync(PYTHON, ["-B", "-W", "error::ResourceWarning", join(ROOT, "demo-kit", "test_check_kit.py")], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" }
    });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    expect(run.status, output).toBe(0);
    expect(output).toMatch(/Ran \d+ tests/);
    if (process.platform === "win32") expect(output).not.toMatch(/skipped/);
  }, 60_000);
});

describe("the speed run's deck (scripts/kit-speed-run.ts)", () => {
  const layout = JSON.parse(readFileSync(join(ROOT, "demo-kit", "kit-layouts.json"), "utf8")).vjster as {
    keys: Array<{ kind: string; at: [number, number]; settings: Record<string, unknown> }>;
    encoders: Array<{ kind: string; at: [number, number]; settings: Record<string, unknown> }>;
  };

  it("places the kit's Speed + keys and dial where the profile does, with their settings", () => {
    const placed = kitSpeedLayout();
    expect(placed).toHaveLength(layout.keys.length + layout.encoders.length);
    for (const k of layout.keys) {
      expect(placed).toContainEqual({
        context: `key-${k.at[0]}-${k.at[1]}`,
        action: `com.jbrick2070.vjster.${k.kind}`,
        controller: "Keypad",
        column: k.at[0],
        row: k.at[1],
        settings: k.settings
      });
    }
    expect(placed.find((p) => p.controller === "Encoder")).toEqual({
      context: "dial-0",
      action: "com.jbrick2070.vjster.speed",
      controller: "Encoder",
      column: 0,
      row: 0,
      settings: layout.encoders[0].settings
    });
    expect(placed.every((p) => p.settings.target === "obs")).toBe(true);
  });

  it("has the presses the run makes: two speed steps, the 0.5x, 1x and 2x presets and play / pause", () => {
    const placed = kitSpeedLayout();
    const has = (kind: string, settings: Record<string, unknown>) =>
      placed.some((p) => p.action === `com.jbrick2070.vjster.${kind}` && Object.entries(settings).every(([k, v]) => p.settings[k] === v));
    expect(has("speed-step", { direction: 1, step: 0.25 })).toBe(true);
    expect(has("speed-step", { direction: -1, step: 0.25 })).toBe(true);
    for (const rate of [0.5, 1, 2]) expect(has("speed-preset", { rate })).toBe(true);
    expect(has("transport", {})).toBe(true);
  });
});
