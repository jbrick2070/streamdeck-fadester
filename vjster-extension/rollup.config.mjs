// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the VJster Chrome extension into vjster-extension/bin, the folder
// Chrome loads unpacked (docs/vjster/PLAN.md 3.1, Phase 1 step 4). Run from the
// repository root:
//
//   npx rollup -c vjster-extension/rollup.config.mjs
//
// A small inline plugin copies the manifest, the options page and the icons
// next to the bundles; no copy plugin is added (docs/vjster R-STD-3).

import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "bin");
const banner = "// SPDX-License-Identifier: GPL-2.0-or-later";

function copyStatic() {
  return {
    name: "vjster-copy-static",
    writeBundle() {
      mkdirSync(join(out, "icons"), { recursive: true });
      for (const file of ["manifest.json", "options.html"]) copyFileSync(join(here, file), join(out, file));
      for (const file of readdirSync(join(here, "icons"))) {
        if (file.endsWith(".png")) copyFileSync(join(here, "icons", file), join(out, "icons", file));
      }
    }
  };
}

const plugins = () => [
  typescript({ tsconfig: resolve(here, "tsconfig.json"), noEmit: false, include: [`${here}/src/**/*.ts`, `${resolve(here, "../src/vjster/shared")}/**/*.ts`] }),
  nodeResolve({ browser: true, preferBuiltins: false }),
  commonjs()
];

const bundle = (name, format, extra = []) => ({
  input: join(here, "src", `${name}.ts`),
  output: { file: join(out, `${name}.js`), format, banner, sourcemap: false },
  plugins: [...plugins(), ...extra]
});

export default [
  bundle("background", "es"),
  bundle("content-main", "iife"),
  bundle("content-bridge", "iife"),
  bundle("options", "iife", [copyStatic()])
];
