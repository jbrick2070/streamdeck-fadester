// SPDX-License-Identifier: GPL-2.0-or-later
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { stageKoffi } from "./scripts/native/stage-koffi.mjs";

const sharedExternal = [
  /^node:/
];

function sharedPlugins(extraPlugins = []) {
  return [
    typescript({
      tsconfig: "./tsconfig.json",
      include: ["src/**/*.ts", "packages/**/*.ts"]
    }),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true
    }),
    commonjs(),
    ...extraPlugins
  ];
}

export default [
  {
    input: "src/plugin.ts",
    output: {
      file: "io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/fadester.js",
      format: "esm",
      sourcemap: true
    },
    external: sharedExternal,
    plugins: sharedPlugins()
  },
  {
    input: "src/obs/uia/uia-worker.ts",
    output: {
      file: "io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/uia-worker.js",
      format: "esm",
      sourcemap: true,
      inlineDynamicImports: true
    },
    external: [...sharedExternal, "koffi"],
    plugins: sharedPlugins([
      {
        name: "stage-koffi",
        writeBundle() {
          stageKoffi();
        }
      }
    ])
  }
];
