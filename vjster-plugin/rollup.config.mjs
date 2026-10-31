// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the standalone VJster Stream Deck plugin (docs/vjster D-12) into
// com.jbrick2070.vjster.sdPlugin/bin/plugin.js. Run from the repository root:
//
//   npx rollup -c vjster-plugin/rollup.config.mjs

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default {
  input: join(root, "src/vjster/plugin/standalone.ts"),
  output: {
    file: join(root, "com.jbrick2070.vjster.sdPlugin/bin/plugin.js"),
    format: "esm",
    sourcemap: true,
    banner: "// SPDX-License-Identifier: GPL-2.0-or-later"
  },
  external: [/^node:/],
  plugins: [
    typescript({ tsconfig: join(root, "tsconfig.json"), include: [`${root}/src/vjster/**/*.ts`], noEmit: false }),
    nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
    commonjs()
  ]
};
