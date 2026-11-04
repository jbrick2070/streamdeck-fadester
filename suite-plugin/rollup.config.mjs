// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the suite plugin's launcher (docs/SUITE.md) into io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/plugin.js; the
// Fadester plugin is bin/fadester.js (rollup.config.mjs) and VJster's is copied to bin/vjster/ (scripts/suite/copy-vjster.ts).
// Run from the repository root:
//
//   npx rollup -c suite-plugin/rollup.config.mjs

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default {
  input: join(root, "src/suite/launcher.ts"),
  output: {
    file: join(root, "io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/plugin.js"),
    format: "esm",
    sourcemap: true,
    banner: "// SPDX-License-Identifier: GPL-2.0-or-later"
  },
  external: [/^node:/],
  plugins: [
    typescript({ tsconfig: join(root, "tsconfig.json"), include: [`${root}/src/suite/**/*.ts`], noEmit: false }),
    nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
    commonjs()
  ]
};
