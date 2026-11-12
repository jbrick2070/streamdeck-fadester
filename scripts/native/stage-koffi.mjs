// SPDX-License-Identifier: GPL-2.0-or-later
// Stages koffi's JavaScript loader and prebuilt Windows + macOS N-API binaries (win32-x64, win32-arm64, darwin-x64,
// darwin-arm64) at fixed paths inside io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/node_modules/koffi, verified
// against package-lock.json. Runs identically on Windows and macOS without a compiler or optionalDependencies filters.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const KOFFI_JS_FILES = [
  "package.json",
  "LICENSE.txt",
  "index.js",
  "index.cjs",
  "indirect.js",
  "indirect.cjs",
  "src/koffi/index.js",
  "src/koffi/indirect.js",
  "src/koffi/src/static.js"
];

const NATIVE_TARGETS = [
  { platform: "win32", arch: "x64", triplet: "win32_x64", format: "pe", outKey: "win32X64Node" },
  { platform: "win32", arch: "arm64", triplet: "win32_arm64", format: "pe", outKey: "win32Arm64Node" },
  { platform: "darwin", arch: "x64", triplet: "darwin_x64", format: "macho64", outKey: "darwinX64Node" },
  { platform: "darwin", arch: "arm64", triplet: "darwin_arm64", format: "macho64", outKey: "darwinArm64Node" }
];

function isValidNativeAddon(bytes, format) {
  if (bytes.length < 65536) return false;
  if (format === "pe") return bytes[0] === 0x4d && bytes[1] === 0x5a;
  if (format === "macho64") {
    return bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe;
  }
  return false;
}

/** Extracts one regular file from a gzipped POSIX/USTAR tar archive. */
export function extractTarGzEntry(tgzBytes, entryPath) {
  const tar = gunzipSync(tgzBytes);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const fullName = prefix ? `${prefix}/${rawName}` : rawName;
    const sizeOctal = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeOctal || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`Malformed tar size for ${fullName}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error(`Truncated tar entry ${fullName}`);
    const typeFlag = header[156];
    if ((typeFlag === 0 || typeFlag === 48) && fullName === entryPath) {
      return Buffer.from(tar.subarray(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Missing ${entryPath} in vendored koffi archive`);
}

/** Stages koffi and its Windows + macOS N-API binaries into `<pluginDir>/bin/node_modules/koffi`. */
export function stageKoffi(
  root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  outBinDir = join(root, "io.github.jbrick2070.fadester-for-obs.sdPlugin", "bin")
) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const packages = lock.packages ?? {};
  const koffiPkg = packages["node_modules/koffi"];
  if (!koffiPkg?.version) throw new Error("koffi is missing from package-lock.json");

  const koffiSrc = join(root, "node_modules", "koffi");
  if (!existsSync(join(koffiSrc, "package.json"))) {
    throw new Error("node_modules/koffi is missing; run npm ci first");
  }

  const binDir = outBinDir;
  // Keep the old standalone FadesterNativeSlider.exe unbundled.
  rmSync(join(binDir, "native"), { recursive: true, force: true });

  const destRoot = join(binDir, "node_modules", "koffi");
  rmSync(destRoot, { recursive: true, force: true });

  for (const rel of KOFFI_JS_FILES) {
    const from = join(koffiSrc, rel);
    const to = join(destRoot, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }

  const stagedAddons = {};
  for (const { platform, arch, triplet, format, outKey } of NATIVE_TARGETS) {
    const lockKey = `node_modules/@koromix/koffi-${platform}-${arch}`;
    const lockEntry = packages[lockKey];
    if (!lockEntry?.version || !lockEntry.integrity) {
      throw new Error(`Missing version or integrity for ${lockKey} in package-lock.json`);
    }
    if (lockEntry.version !== koffiPkg.version) {
      throw new Error(`Version mismatch: koffi@${koffiPkg.version} vs ${lockKey}@${lockEntry.version}`);
    }
    const tarballPath = join(root, "vendor", "koffi", `koffi-${platform}-${arch}-${lockEntry.version}.tgz`);
    if (!existsSync(tarballPath)) {
      throw new Error(`Missing vendored prebuilt archive: ${tarballPath}`);
    }
    const tgzBytes = readFileSync(tarballPath);
    const actualIntegrity = `sha512-${createHash("sha512").update(tgzBytes).digest("base64")}`;
    if (actualIntegrity !== lockEntry.integrity) {
      throw new Error(`Integrity mismatch for ${tarballPath}: expected ${lockEntry.integrity}, got ${actualIntegrity}`);
    }
    const addonBytes = extractTarGzEntry(tgzBytes, `package/${triplet}/koffi.node`);
    if (!isValidNativeAddon(addonBytes, format)) {
      throw new Error(`Extracted ${triplet}/koffi.node is not a valid ${format} binary`);
    }
    const addonOut = join(destRoot, "build", "koffi", triplet, "koffi.node");
    mkdirSync(dirname(addonOut), { recursive: true });
    writeFileSync(addonOut, addonBytes, { mode: 0o755 });
    stagedAddons[outKey] = addonOut;
  }

  copyFileSync(join(root, "vendor", "koffi", "LICENSE.txt"), join(destRoot, "LICENSE.txt"));
  if (process.platform === "darwin" && existsSync("/usr/bin/xattr")) {
    spawnSync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", destRoot], { stdio: "ignore" });
  }
  return {
    koffiDir: destRoot,
    win32X64Node: stagedAddons.win32X64Node,
    win32Arm64Node: stagedAddons.win32Arm64Node,
    darwinX64Node: stagedAddons.darwinX64Node,
    darwinArm64Node: stagedAddons.darwinArm64Node
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const staged = stageKoffi();
  console.log(`Staged koffi (win32-x64, win32-arm64, darwin-x64, darwin-arm64) to ${staged.koffiDir}`);
}
