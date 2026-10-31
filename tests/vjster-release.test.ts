// SPDX-License-Identifier: GPL-2.0-or-later
// VJster release files (docs/vjster/INSTALL.md, PLAN.md Phase 1 step 6): the
// extension zip holds every file the manifest names, the same build gives the
// same bytes, and an incomplete build is refused.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { ALSO_NEEDED, neededFiles, packExtension } from "../scripts/vjster/pack-extension.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The real extension manifest, so the fixture names what Chrome will look for. */
const MANIFEST = JSON.parse(readFileSync(join(__dirname, "..", "vjster-extension", "manifest.json"), "utf8")) as Record<string, unknown>;
const EXPECTED = [
  "background.js",
  "content-bridge.js",
  "content-main.js",
  "icons/icon128.png",
  "icons/icon16.png",
  "icons/icon48.png",
  "manifest.json",
  "options.html",
  "options.js"
];

function build(opts: { version?: unknown; skip?: string; reverse?: boolean; touch?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "vjster-ext-"));
  dirs.push(dir);
  mkdirSync(join(dir, "icons"));
  const names = [...EXPECTED].filter((n) => n !== opts.skip);
  if (opts.reverse) names.reverse();
  for (const name of names) {
    const body = name === "manifest.json" ? JSON.stringify({ ...MANIFEST, version: "version" in opts ? opts.version : "0.1.0" }) : `// ${name}`;
    writeFileSync(join(dir, name), body);
    if (opts.touch) utimesSync(join(dir, name), opts.touch, opts.touch);
  }
  writeFileSync(join(dir, "background.js.map"), "{}");
  writeFileSync(join(dir, "icons", "icon16.png.map"), "{}");
  return dir;
}

/** The names and contents in a zip, read from its central directory. */
function unzip(bytes: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let p = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(p + 10);
  p = bytes.readUInt32LE(p + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(p + 10);
    const size = bytes.readUInt32LE(p + 20);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extra = bytes.readUInt16LE(p + 30);
    const comment = bytes.readUInt16LE(p + 32);
    const local = bytes.readUInt32LE(p + 42);
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + size);
    out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("latin1"));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("the extension zip (step 6)", () => {
  it("needs every file the real manifest names, plus the options page's script", () => {
    expect(neededFiles(MANIFEST)).toEqual(EXPECTED);
    expect(ALSO_NEEDED).toEqual(["options.js"]);
  });

  it("holds those files at the root with forward slashes, and no source maps", () => {
    const { version, bytes, names } = packExtension(build());
    expect(version).toBe("0.1.0");
    expect([...names].sort()).toEqual(EXPECTED);
    const files = unzip(bytes);
    expect([...files.keys()].sort()).toEqual(EXPECTED);
    expect(files.get("content-main.js")).toBe("// content-main.js");
    expect(files.get("icons/icon48.png")).toBe("// icons/icon48.png");
  });

  it("gives the same bytes for the same build, whatever the order and times the files were written in", () => {
    const a = packExtension(build({ touch: 1_000_000_000 })).bytes;
    const b = packExtension(build({ reverse: true, touch: 1_700_000_000 })).bytes;
    expect(a.equals(b)).toBe(true);
  });

  it("refuses a build that lacks any needed file, a manifest, or a usable version", () => {
    for (const missing of EXPECTED.filter((n) => n !== "manifest.json")) expect(() => packExtension(build({ skip: missing }))).toThrow(missing);
    expect(() => packExtension(build({ skip: "manifest.json" }))).toThrow(/no manifest\.json/);
    for (const version of ["one", "1.2.3.4.5", "x1.0", "1.0x", 1, undefined]) expect(() => packExtension(build({ version }))).toThrow(/version/);
    expect(packExtension(build({ version: "1.2.3.4" })).version).toBe("1.2.3.4");
  });
});
