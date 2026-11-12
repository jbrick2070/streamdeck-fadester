// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the Windows helper that moves OBS's own T-bar slider (src/obs/native-tbar.ts) into the plugin's bin/native.
// It is the Fadester Companion helper (tourbox/native), built with MSVC; elsewhere the plugin works without it.
//   node --import tsx scripts/native/build-native.ts          builds on Windows, skips with a note elsewhere
//   FADESTER_REQUIRE_NATIVE=1 ...                             fails instead of skipping (release candidates)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const NATIVE_HELPER = join(root, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "bin", "native", "FadesterNativeSlider.exe");
const SOURCES = ["tourbox/native/NativeSlider.cpp", "tourbox/native/NativeSlider.vcxproj", "tourbox/native/build.ps1"];

/** True when the helper is in place; `required` turns a skip or a failed build into an error. */
export function buildNative(required = process.env.FADESTER_REQUIRE_NATIVE === "1"): boolean {
  if (process.platform !== "win32") {
    if (required) throw new Error("The Windows T-bar helper can only be built on Windows.");
    console.log("Windows T-bar helper: skipped (built on Windows only); the plugin keeps the obs-websocket T-bar.");
    return false;
  }
  const newest = Math.max(...SOURCES.map((source) => statSync(join(root, source)).mtimeMs));
  if (existsSync(NATIVE_HELPER) && statSync(NATIVE_HELPER).mtimeMs >= newest) {
    console.log("Windows T-bar helper: up to date.");
    return true;
  }
  mkdirSync(dirname(NATIVE_HELPER), { recursive: true });
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "tourbox", "native", "build.ps1"), "-OutputPath", NATIVE_HELPER],
    { stdio: "inherit", windowsHide: true }
  );
  if (result.status !== 0 || !existsSync(NATIVE_HELPER)) {
    const why = "Windows T-bar helper: build failed (needs Visual Studio 2022 or later with C++ and a Windows SDK).";
    if (required) throw new Error(why);
    console.warn(`${why} The plugin keeps the obs-websocket T-bar.`);
    return false;
  }
  console.log(`Windows T-bar helper: built ${NATIVE_HELPER}`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    buildNative();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
