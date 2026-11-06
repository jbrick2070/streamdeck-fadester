// SPDX-License-Identifier: GPL-2.0-or-later
// VJster release files (docs/vjster/INSTALL.md, PLAN.md Phase 1 step 6): the
// extension zip holds every file the manifest names, the same build gives the
// same bytes, and an incomplete build is refused.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { ALSO_NEEDED, localesIn, neededFiles, packExtension, SOURCE_LOCALES, storeManifest } from "../scripts/vjster/pack-extension.js";
import { REQUIRED } from "./vjster-languages.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The real extension manifest, so the fixture names what Chrome will look for. */
const MANIFEST = JSON.parse(readFileSync(join(__dirname, "..", "vjster-extension", "manifest.json"), "utf8")) as Record<string, unknown>;
/** The real languages of the source, which every build must carry (PLAN.md 8.5). */
const LOCALES = localesIn(SOURCE_LOCALES);
const LOCALE_FILES = LOCALES.map((l) => `_locales/${l}/messages.json`);
const EXPECTED = [
  ...LOCALE_FILES,
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
    if (name.startsWith("_locales/")) {
      // The real language files, copied as the extension build copies them.
      mkdirSync(join(dir, name, ".."), { recursive: true });
      cpSync(join(SOURCE_LOCALES, name.slice("_locales/".length)), join(dir, name));
      if (opts.touch) utimesSync(join(dir, name), opts.touch, opts.touch);
      continue;
    }
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
  it("needs every file the real manifest names, plus the options page's script and every language", () => {
    expect(neededFiles(MANIFEST, LOCALES)).toEqual(EXPECTED);
    expect(neededFiles(MANIFEST)).toEqual(EXPECTED.filter((n) => !n.startsWith("_locales/") || n === "_locales/en/messages.json"));
    expect(MANIFEST.default_locale).toBe("en");
    expect(LOCALES).toEqual(expect.arrayContaining([...REQUIRED.chrome]));
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
    for (const f of LOCALE_FILES) expect(files.get(f)).toBe(readFileSync(join(SOURCE_LOCALES, f.slice("_locales/".length))).toString("latin1"));
  });

  it("carries the real languages in the real build, when one exists (vjster-extension/bin)", () => {
    const bin = join(__dirname, "..", "vjster-extension", "bin");
    if (!existsSync(join(bin, "manifest.json"))) return; // not built in this checkout; the release steps build it first
    expect(existsSync(join(bin, "_locales")), "vjster-extension/bin is stale: build the extension again").toBe(true);
    expect(readdirSync(join(bin, "_locales")).sort()).toEqual(LOCALES);
    for (const f of LOCALE_FILES) expect(readFileSync(join(bin, f)).equals(readFileSync(join(SOURCE_LOCALES, f.slice("_locales/".length)))), f).toBe(true);
    expect(packExtension(bin).names).toEqual(expect.arrayContaining(LOCALE_FILES));
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

describe("the Chrome Web Store zip", () => {
  const store = (): Record<string, unknown> => JSON.parse(unzip(packExtension(build(), LOCALES, { store: true }).bytes).get("manifest.json") as string) as Record<string, unknown>;

  it("is YouTube only: no all-sites permission, no scripting, and no key", () => {
    const manifest = store();
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.permissions).toEqual(["storage", "alarms"]);
    expect(manifest.host_permissions).toEqual(["*://*.youtube.com/*", "ws://127.0.0.1/*"]);
    expect(manifest.key).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("all_urls");
  });

  it("keeps everything else of the manifest, and the other files byte for byte", () => {
    const { optional_host_permissions: _o, permissions: _p, ...kept } = MANIFEST;
    const { permissions: _q, ...got } = store();
    expect(got).toEqual({ ...kept, version: "0.1.0" });
    const plain = unzip(packExtension(build()).bytes);
    const stored = unzip(packExtension(build(), LOCALES, { store: true }).bytes);
    for (const [name, body] of plain) if (name !== "manifest.json") expect(stored.get(name)).toBe(body);
    expect([...stored.keys()].sort()).toEqual(EXPECTED);
  });

  it("does not change the zip to load unpacked, and the same build gives the same store bytes", () => {
    expect(unzip(packExtension(build()).bytes).get("manifest.json")).toContain("optional_host_permissions");
    expect(packExtension(build({ touch: 1_000_000_000 }), LOCALES, { store: true }).bytes).toEqual(packExtension(build({ reverse: true, touch: 1_700_000_000 }), LOCALES, { store: true }).bytes);
  });

  it("storeManifest leaves a manifest without those fields as it was", () => {
    expect(storeManifest({ version: "1" })).toEqual({ version: "1" });
    expect(storeManifest({ permissions: ["storage"] })).toEqual({ permissions: ["storage"] });
  });
});
