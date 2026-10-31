// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the VJster OBS page into the standalone plugin's bin/obs folder, from
// where the plugin serves it at http://127.0.0.1:<port>/obs (docs/vjster/PLAN.md
// Phase 2). Run from the repository root:
//
//   npx rollup -c vjster-page/rollup.config.mjs
//
// A small inline plugin copies player.html next to the bundle (R-STD-3: no copy plugin).

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../com.jbrick2070.vjster.sdPlugin/bin/obs");

function copyPage() {
  return {
    name: "vjster-copy-page",
    writeBundle() {
      mkdirSync(out, { recursive: true });
      copyFileSync(join(here, "player.html"), join(out, "player.html"));
    }
  };
}

export default {
  input: join(here, "src", "player-page.ts"),
  output: { file: join(out, "player.js"), format: "iife", banner: "// SPDX-License-Identifier: GPL-2.0-or-later", sourcemap: false },
  plugins: [
    typescript({
      tsconfig: resolve(here, "tsconfig.json"),
      noEmit: false,
      include: [`${here}/src/**/*.ts`, `${resolve(here, "../src/vjster/shared")}/**/*.ts`, `${resolve(here, "../vjster-extension/src")}/**/*.ts`]
    }),
    nodeResolve({ browser: true, preferBuiltins: false }),
    copyPage()
  ]
};
