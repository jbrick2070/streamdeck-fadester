// SPDX-License-Identifier: GPL-2.0-or-later
// OBS 33's Studio Mode T-bar on macOS, moved in-process from a dedicated worker thread via macOS Accessibility
// (AXUIElement / CoreFoundation / libproc through koffi). Matches the discovery and safety rules of
// tourbox/macos/native/AXSlider.swift and src/obs/uia/uia-slider.ts: exact local listener PID via libproc, verified
// com.obsproject.obs-studio bundle and executable, one-time Accessibility trust check (never prompting per tick),
// ~80 ms AX messaging timeouts, non-dock unminimised OBS window, one horizontal enabled writable AXSlider with
// identifier OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll and range 0..1023, expected-value
// check before writing, readback after writing, and uncertain-write quarantine until a fresh read succeeds.
import { realpathSync } from "node:fs";
import koffi from "koffi";

export const AX_TBAR_MAX = 1023;

export type AxRefusalReason = "refused" | "moved" | "minimised" | "permission" | "unavailable";

/** Nothing was written: OBS is as it was. `moved` says the slider was not where the caller left it. */
export class AxRefusal extends Error {
  public constructor(message: string, public readonly reason: AxRefusalReason = "refused") {
    super(message);
  }
}

/** A write may have landed on OBS's slider; no further write is allowed until a fresh read succeeds. */
export class AxUncertain extends Error {}

const OBS_BUNDLE_ID = "com.obsproject.obs-studio";
const SLIDER_ID = "OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll";

const kCFStringEncodingUTF8 = 0x08000100;
const kCFNumberSInt32Type = 3;
const kCFNumberFloat64Type = 6;
const kCFURLPOSIXPathStyle = 0;

const kAXErrorSuccess = 0;
const kAXErrorAPIDisabled = -25211;
const kAXErrorAttributeUnsupported = -25205;
const kAXErrorNoValue = -25212;

const AX_MESSAGING_TIMEOUT_SECONDS = 0.08;
const AX_TRAVERSAL_BUDGET_MS = 1500;
const AX_NODE_LIMIT = 3000;
const AX_DEPTH_LIMIT = 30;
const AX_CHILDREN_PER_NODE_LIMIT = 1024;
const AX_WINDOWS_LIMIT = 16;

// XNU <sys/proc_info.h> and <sys/socket.h> constants (verified on arm64 and x86_64 MacOSX.sdk).
const PROC_PIDLISTFDS = 1;
const PROC_PIDTBSDINFO = 3;
const PROC_PIDFDSOCKETINFO = 3;
const PROX_FDTYPE_SOCKET = 2;
const STRUCT_PROC_FDINFO_SIZE = 8;
const STRUCT_PROC_BSDINFO_SIZE = 136;
const STRUCT_SOCKET_FDINFO_SIZE = 792;
const PBI_STATUS_SZOMB = 5;
const SOCKINFO_TCP = 2;
const TSI_S_LISTEN = 1;
const INI_IPV4 = 1;
const AF_INET = 2;
const AF_INET6 = 30;
const PROC_PIDPATHINFO_MAXSIZE = 4096;

type Ptr = bigint;

function toPtr(raw: number | bigint): Ptr {
  return BigInt(raw);
}

const cf = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
const appServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const libSystem = koffi.load("/usr/lib/libSystem.B.dylib");

const proc_listallpids = libSystem.func("proc_listallpids", "int32", ["void *", "int32"]);
const proc_pidinfo = libSystem.func("proc_pidinfo", "int32", ["int32", "int32", "uint64", "void *", "int32"]);
const proc_pidfdinfo = libSystem.func("proc_pidfdinfo", "int32", ["int32", "int32", "int32", "void *", "int32"]);
const proc_pidpath = libSystem.func("proc_pidpath", "int32", ["int32", "void *", "uint32"]);

const CFRetain = cf.func("CFRetain", "uint64", ["uint64"]);
const CFRelease = cf.func("CFRelease", "void", ["uint64"]);
const CFEqual = cf.func("CFEqual", "uint8", ["uint64", "uint64"]);
const CFHash = cf.func("CFHash", "uint64", ["uint64"]);
const CFGetTypeID = cf.func("CFGetTypeID", "uint64", ["uint64"]);
const CFStringGetTypeID = cf.func("CFStringGetTypeID", "uint64", []);
const CFBooleanGetTypeID = cf.func("CFBooleanGetTypeID", "uint64", []);
const CFNumberGetTypeID = cf.func("CFNumberGetTypeID", "uint64", []);
const CFArrayGetTypeID = cf.func("CFArrayGetTypeID", "uint64", []);
const CFBooleanGetValue = cf.func("CFBooleanGetValue", "uint8", ["uint64"]);
const CFStringCreateWithCString = cf.func("CFStringCreateWithCString", "uint64", ["uint64", "str", "uint32"]);
const CFStringGetLength = cf.func("CFStringGetLength", "int64", ["uint64"]);
const CFStringGetMaximumSizeForEncoding = cf.func("CFStringGetMaximumSizeForEncoding", "int64", ["int64", "uint32"]);
const CFStringGetCString = cf.func("CFStringGetCString", "uint8", ["uint64", "void *", "int64", "uint32"]);
const CFNumberCreate = cf.func("CFNumberCreate", "uint64", ["uint64", "int64", "void *"]);
const CFNumberGetValue = cf.func("CFNumberGetValue", "uint8", ["uint64", "int64", "void *"]);
const CFArrayGetCount = cf.func("CFArrayGetCount", "int64", ["uint64"]);
const CFArrayGetValueAtIndex = cf.func("CFArrayGetValueAtIndex", "uint64", ["uint64", "int64"]);
const CFDictionaryCreate = cf.func("CFDictionaryCreate", "uint64", [
  "uint64",
  "void *",
  "void *",
  "int64",
  "uint64",
  "uint64"
]);
const CFURLCreateWithFileSystemPath = cf.func("CFURLCreateWithFileSystemPath", "uint64", [
  "uint64",
  "uint64",
  "int64",
  "uint8"
]);
const CFURLCopyAbsoluteURL = cf.func("CFURLCopyAbsoluteURL", "uint64", ["uint64"]);
const CFURLCopyFileSystemPath = cf.func("CFURLCopyFileSystemPath", "uint64", ["uint64", "int64"]);
const CFBundleCreate = cf.func("CFBundleCreate", "uint64", ["uint64", "uint64"]);
const CFBundleGetIdentifier = cf.func("CFBundleGetIdentifier", "uint64", ["uint64"]);
const CFBundleCopyExecutableURL = cf.func("CFBundleCopyExecutableURL", "uint64", ["uint64"]);

const AXIsProcessTrusted = appServices.func("AXIsProcessTrusted", "uint8", []);
const AXIsProcessTrustedWithOptions = appServices.func("AXIsProcessTrustedWithOptions", "uint8", ["uint64"]);
const AXUIElementCreateApplication = appServices.func("AXUIElementCreateApplication", "uint64", ["int32"]);
const AXUIElementGetPid = appServices.func("AXUIElementGetPid", "int32", ["uint64", "void *"]);
const AXUIElementSetMessagingTimeout = appServices.func("AXUIElementSetMessagingTimeout", "int32", ["uint64", "float"]);
const AXUIElementCopyAttributeValue = appServices.func("AXUIElementCopyAttributeValue", "int32", [
  "uint64",
  "uint64",
  "void *"
]);
const AXUIElementGetAttributeValueCount = appServices.func("AXUIElementGetAttributeValueCount", "int32", [
  "uint64",
  "uint64",
  "void *"
]);
const AXUIElementCopyAttributeValues = appServices.func("AXUIElementCopyAttributeValues", "int32", [
  "uint64",
  "uint64",
  "int64",
  "int64",
  "void *"
]);
const AXUIElementIsAttributeSettable = appServices.func("AXUIElementIsAttributeSettable", "int32", [
  "uint64",
  "uint64",
  "void *"
]);
const AXUIElementSetAttributeValue = appServices.func("AXUIElementSetAttributeValue", "int32", [
  "uint64",
  "uint64",
  "uint64"
]);

const kCFBooleanTrue = toPtr(koffi.decode(cf.symbol("kCFBooleanTrue", "uint64"), "uint64") as number | bigint);
const kCFTypeDictionaryKeyCallBacks = toPtr(
  koffi.address(cf.symbol("kCFTypeDictionaryKeyCallBacks", "uint8")) as number | bigint
);
const kCFTypeDictionaryValueCallBacks = toPtr(
  koffi.address(cf.symbol("kCFTypeDictionaryValueCallBacks", "uint8")) as number | bigint
);
const kAXTrustedCheckOptionPrompt = toPtr(
  koffi.decode(appServices.symbol("kAXTrustedCheckOptionPrompt", "uint64"), "uint64") as number | bigint
);

const CF_STRING_TYPE_ID = toPtr(CFStringGetTypeID() as number | bigint);
const CF_BOOLEAN_TYPE_ID = toPtr(CFBooleanGetTypeID() as number | bigint);
const CF_NUMBER_TYPE_ID = toPtr(CFNumberGetTypeID() as number | bigint);
const CF_ARRAY_TYPE_ID = toPtr(CFArrayGetTypeID() as number | bigint);

const cachedStrings = new Map<string, Ptr>();

function cfRelease(ref: Ptr | null | undefined): void {
  if (ref && ref !== 0n) CFRelease(ref);
}

function cfRetain(ref: Ptr): Ptr {
  return ref === 0n ? 0n : toPtr(CFRetain(ref) as number | bigint);
}

/** Interned CFStringRef for fixed attribute names so steady-state reads and writes allocate zero CFStrings. */
function cfConstString(text: string): Ptr {
  const existing = cachedStrings.get(text);
  if (existing && existing !== 0n) return existing;
  const created = toPtr(CFStringCreateWithCString(0n, text, kCFStringEncodingUTF8) as number | bigint);
  if (created === 0n) throw new AxRefusal("out of memory");
  cachedStrings.set(text, created);
  return created;
}

export function disposeAxConstants(): void {
  for (const ptr of cachedStrings.values()) cfRelease(ptr);
  cachedStrings.clear();
}

function cfStringToJs(ref: Ptr): string | undefined {
  if (ref === 0n || toPtr(CFGetTypeID(ref) as number | bigint) !== CF_STRING_TYPE_ID) return undefined;
  const length = Number(CFStringGetLength(ref) as number | bigint);
  if (length <= 0) return "";
  if (length > 16384) return undefined;
  const maxBytes = Number(CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) as number | bigint) + 1;
  const buf = Buffer.alloc(Math.max(16, maxBytes));
  const ok = CFStringGetCString(ref, buf, buf.length, kCFStringEncodingUTF8) as number;
  if (!ok) return undefined;
  const nul = buf.indexOf(0);
  return buf.subarray(0, nul >= 0 ? nul : buf.length).toString("utf8");
}

let promptedForTrust = false;

function promptAccessibilityTrustOnce(): void {
  if (promptedForTrust || process.env.FADESTER_NO_AX_PROMPT === "1") return;
  promptedForTrust = true;
  if (kAXTrustedCheckOptionPrompt === 0n || kCFBooleanTrue === 0n) return;
  const keys = Buffer.alloc(8);
  const values = Buffer.alloc(8);
  keys.writeBigUInt64LE(kAXTrustedCheckOptionPrompt, 0);
  values.writeBigUInt64LE(kCFBooleanTrue, 0);
  const options = toPtr(
    CFDictionaryCreate(0n, keys, values, 1, kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks) as
      | number
      | bigint
  );
  if (options === 0n) return;
  try {
    AXIsProcessTrustedWithOptions(options);
  } finally {
    cfRelease(options);
  }
}

/** Checks macOS Accessibility trust; optionally requests the system consent dialog at most once per worker lifetime. */
export function ensureAccessibilityTrusted(allowPrompt = false): void {
  if ((AXIsProcessTrusted() as number) !== 0) return;
  if (allowPrompt) promptAccessibilityTrustOnce();
  throw new AxRefusal(
    "Allow Stream Deck (or OpenDeck) in macOS System Settings -> Privacy & Security -> Accessibility.",
    "permission"
  );
}

function isLocalListeningSocket(sockBuf: Buffer, port: number): boolean {
  const family = sockBuf.readInt32LE(184);
  if (family !== AF_INET && family !== AF_INET6) return false;
  if (sockBuf.readInt32LE(256) !== SOCKINFO_TCP) return false;
  if (sockBuf.readInt32LE(344) !== TSI_S_LISTEN) return false;
  if (sockBuf.readUInt16BE(268) !== port) return false;
  const vflag = sockBuf.readUInt8(288);
  // On XNU, IPv4 sockets and IPv4-mapped AF_INET6 sockets (::ffff:127.0.0.1) set insi_vflag === INI_IPV4 and store the
  // 4-byte address in insi_laddr.ina_46.i46a_addr4 (324..328). Dual-stack :: sets vflag === INI_IPV4 | INI_IPV6 (3).
  if (family === AF_INET || vflag === INI_IPV4) {
    const addr4 = sockBuf.subarray(324, 328);
    return addr4.readUInt32BE(0) === 0 || addr4[0] === 127;
  }
  const addr6 = sockBuf.subarray(312, 328);
  const allZero = addr6.every((byte) => byte === 0);
  if (allZero) return true;
  const isLoopback6 = addr6.subarray(0, 15).every((byte) => byte === 0) && addr6[15] === 1;
  if (isLoopback6) return true;
  const isV4Mapped =
    addr6.subarray(0, 10).every((byte) => byte === 0) && addr6[10] === 0xff && addr6[11] === 0xff;
  if (isV4Mapped) {
    return addr6.readUInt32BE(12) === 0 || addr6[12] === 127;
  }
  return false;
}

/** Finds the unique local process listening on `port` on loopback or wildcard via libproc (no child process). */
export function listenerPid(port: number): number {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new AxRefusal("invalid OBS WebSocket port");
  }
  const estimated = proc_listallpids(null, 0) as number;
  if (estimated <= 0) throw new AxRefusal("Couldn't list local processes.");
  const pidBuf = Buffer.alloc((estimated + 128) * 4);
  const count = proc_listallpids(pidBuf, pidBuf.length) as number;
  if (count <= 0) throw new AxRefusal("Couldn't list local processes.");

  const owners = new Set<number>();
  const sockBuf = Buffer.alloc(STRUCT_SOCKET_FDINFO_SIZE);
  let fdBuf = Buffer.alloc(256 * STRUCT_PROC_FDINFO_SIZE);

  for (let i = 0; i < count && i * 4 + 4 <= pidBuf.length; i++) {
    const pid = pidBuf.readInt32LE(i * 4);
    if (pid <= 0) continue;
    const needed = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, null, 0) as number;
    if (needed <= 0) continue;
    if (fdBuf.length < needed + 32 * STRUCT_PROC_FDINFO_SIZE) {
      fdBuf = Buffer.alloc(needed + 64 * STRUCT_PROC_FDINFO_SIZE);
    }
    const bytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fdBuf, fdBuf.length) as number;
    if (bytes <= 0) continue;
    for (let off = 0; off + STRUCT_PROC_FDINFO_SIZE <= bytes; off += STRUCT_PROC_FDINFO_SIZE) {
      if (fdBuf.readUInt32LE(off + 4) !== PROX_FDTYPE_SOCKET) continue;
      const fd = fdBuf.readInt32LE(off);
      const got = proc_pidfdinfo(pid, fd, PROC_PIDFDSOCKETINFO, sockBuf, STRUCT_SOCKET_FDINFO_SIZE) as number;
      if (got < STRUCT_SOCKET_FDINFO_SIZE) continue;
      if (isLocalListeningSocket(sockBuf, port)) {
        owners.add(pid);
        break;
      }
    }
  }

  if (owners.size !== 1) {
    throw new AxRefusal("Could not match the WebSocket port to exactly one local OBS process.");
  }
  return [...owners][0]!;
}

interface PinnedProcessInfo {
  startSec: bigint;
  startUsec: bigint;
}

function readProcessStart(pid: number): PinnedProcessInfo | undefined {
  const bsdBuf = Buffer.alloc(STRUCT_PROC_BSDINFO_SIZE);
  const got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, bsdBuf, STRUCT_PROC_BSDINFO_SIZE) as number;
  if (got !== STRUCT_PROC_BSDINFO_SIZE) return undefined;
  const status = bsdBuf.readUInt32LE(4);
  if (status === PBI_STATUS_SZOMB) return undefined;
  return {
    startSec: bsdBuf.readBigUInt64LE(120),
    startUsec: bsdBuf.readBigUInt64LE(128)
  };
}

function verifyObsBundleExecutable(pid: number): void {
  const pathBuf = Buffer.alloc(PROC_PIDPATHINFO_MAXSIZE);
  const len = proc_pidpath(pid, pathBuf, PROC_PIDPATHINFO_MAXSIZE) as number;
  if (len <= 0) throw new AxRefusal("target OBS process unavailable");
  let execPath: string;
  try {
    execPath = realpathSync(pathBuf.subarray(0, len).toString("utf8"));
  } catch {
    throw new AxRefusal("target OBS process unavailable");
  }
  const match = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  if (!match) throw new AxRefusal("target is not the OBS process");
  const bundlePath = match[1]!;

  let cfBundlePath: Ptr = 0n;
  let bundleUrl: Ptr = 0n;
  let bundle: Ptr = 0n;
  let relExecUrl: Ptr = 0n;
  let absExecUrl: Ptr = 0n;
  let execCfPath: Ptr = 0n;
  try {
    cfBundlePath = toPtr(CFStringCreateWithCString(0n, bundlePath, kCFStringEncodingUTF8) as number | bigint);
    if (cfBundlePath === 0n) throw new AxRefusal("out of memory");
    bundleUrl = toPtr(CFURLCreateWithFileSystemPath(0n, cfBundlePath, kCFURLPOSIXPathStyle, 1) as number | bigint);
    if (bundleUrl === 0n) throw new AxRefusal("target is not the OBS process");
    bundle = toPtr(CFBundleCreate(0n, bundleUrl) as number | bigint);
    if (bundle === 0n) throw new AxRefusal("target is not the OBS process");
    const idRef = toPtr(CFBundleGetIdentifier(bundle) as number | bigint);
    if (cfStringToJs(idRef) !== OBS_BUNDLE_ID) {
      throw new AxRefusal("target is not the OBS process");
    }
    relExecUrl = toPtr(CFBundleCopyExecutableURL(bundle) as number | bigint);
    if (relExecUrl === 0n) throw new AxRefusal("target is not the OBS process");
    absExecUrl = toPtr(CFURLCopyAbsoluteURL(relExecUrl) as number | bigint);
    if (absExecUrl === 0n) throw new AxRefusal("target is not the OBS process");
    execCfPath = toPtr(CFURLCopyFileSystemPath(absExecUrl, kCFURLPOSIXPathStyle) as number | bigint);
    const rawBundleExec = cfStringToJs(execCfPath);
    if (!rawBundleExec) throw new AxRefusal("target is not the OBS process");
    let bundleExecPath: string;
    try {
      bundleExecPath = realpathSync(rawBundleExec);
    } catch {
      throw new AxRefusal("target is not the OBS process");
    }
    if (bundleExecPath !== execPath) {
      throw new AxRefusal("target is not the OBS process");
    }
  } finally {
    cfRelease(execCfPath);
    cfRelease(absExecUrl);
    cfRelease(relExecUrl);
    cfRelease(bundle);
    cfRelease(bundleUrl);
    cfRelease(cfBundlePath);
  }
}

function copyAttr(element: Ptr, attrName: string): { err: number; value: Ptr } {
  const out = Buffer.alloc(8);
  const err = AXUIElementCopyAttributeValue(element, cfConstString(attrName), out) as number;
  if (err === kAXErrorAPIDisabled) {
    throw new AxRefusal(
      "Allow Stream Deck (or OpenDeck) in macOS System Settings -> Privacy & Security -> Accessibility.",
      "permission"
    );
  }
  const value = err === kAXErrorSuccess ? out.readBigUInt64LE(0) : 0n;
  return { err, value };
}

function attrStringOpt(element: Ptr, attrName: string): string | undefined {
  const { value } = copyAttr(element, attrName);
  if (value === 0n) return undefined;
  try {
    return cfStringToJs(value);
  } finally {
    cfRelease(value);
  }
}

function attrBoolOpt(element: Ptr, attrName: string): boolean | undefined {
  const { value } = copyAttr(element, attrName);
  if (value === 0n) return undefined;
  try {
    if (toPtr(CFGetTypeID(value) as number | bigint) === CF_BOOLEAN_TYPE_ID) {
      return (CFBooleanGetValue(value) as number) !== 0;
    }
    if (toPtr(CFGetTypeID(value) as number | bigint) === CF_NUMBER_TYPE_ID) {
      const out = Buffer.alloc(8);
      CFNumberGetValue(value, kCFNumberFloat64Type, out);
      return out.readDoubleLE(0) !== 0;
    }
    return undefined;
  } finally {
    cfRelease(value);
  }
}

/** Qt's Cocoa accessibility provider can expose numeric attributes as either CFNumber or CFString. */
function attrNumberOpt(element: Ptr, attrName: string): number | undefined {
  const { value } = copyAttr(element, attrName);
  if (value === 0n) return undefined;
  try {
    const typeId = toPtr(CFGetTypeID(value) as number | bigint);
    let parsed: number | undefined;
    if (typeId === CF_NUMBER_TYPE_ID) {
      const out = Buffer.alloc(8);
      CFNumberGetValue(value, kCFNumberFloat64Type, out);
      parsed = out.readDoubleLE(0);
    } else if (typeId === CF_STRING_TYPE_ID) {
      const text = cfStringToJs(value)?.trim();
      if (text && text.length > 0) parsed = Number(text);
    }
    return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
  } finally {
    cfRelease(value);
  }
}

function isSettable(element: Ptr, attrName: string): boolean {
  const out = Buffer.alloc(4);
  const err = AXUIElementIsAttributeSettable(element, cfConstString(attrName), out) as number;
  if (err === kAXErrorAPIDisabled) {
    throw new AxRefusal(
      "Allow Stream Deck (or OpenDeck) in macOS System Settings -> Privacy & Security -> Accessibility.",
      "permission"
    );
  }
  return err === kAXErrorSuccess && out.readUInt8(0) !== 0;
}

/** OBS's Studio Mode T-bar for one local OBS process on macOS, accessed via AXUIElement on the worker thread. */
export class AxSlider {
  private readonly startSec: bigint;
  private readonly startUsec: bigint;
  private pinnedWindow: Ptr = 0n;
  private pinnedSlider: Ptr = 0n;
  private uncertain = false;

  public constructor(public readonly pid: number) {
    const start = readProcessStart(pid);
    if (!start) throw new AxRefusal("target OBS process unavailable");
    this.startSec = start.startSec;
    this.startUsec = start.startUsec;
    verifyObsBundleExecutable(pid);
    if (!this.running()) throw new AxRefusal("target OBS process unavailable");
  }

  public get isRunning(): boolean {
    return this.running();
  }

  public get located(): boolean {
    return this.pinnedSlider !== 0n;
  }

  /** Reads OBS's slider position (0..1023). A successful read clears any uncertain-write quarantine. */
  public read(allowPrompt = false): number {
    const value = this.readChecked(allowPrompt);
    this.uncertain = false;
    return value;
  }

  /** Moves OBS's slider from `expected` to `desired`, refusing without writing if it moved elsewhere. */
  public move(expected: number, desired: number): number {
    if (
      !Number.isInteger(expected) ||
      !Number.isInteger(desired) ||
      expected < 0 ||
      desired < 0 ||
      expected > AX_TBAR_MAX ||
      desired > AX_TBAR_MAX
    ) {
      throw new AxRefusal("expected two integers 0..1023");
    }
    if (this.uncertain) throw new AxRefusal("prior write unconfirmed; read first");
    const before = this.readChecked(false);
    if (before !== expected) throw new AxRefusal(`T-bar moved; actual ${before}`, "moved");
    if (before === desired) return before;

    const numBuf = Buffer.alloc(4);
    numBuf.writeInt32LE(desired, 0);
    const cfNum = toPtr(CFNumberCreate(0n, kCFNumberSInt32Type, numBuf) as number | bigint);
    if (cfNum === 0n) throw new AxRefusal("out of memory");

    try {
      const setErr = AXUIElementSetAttributeValue(this.pinnedSlider, cfConstString("AXValue"), cfNum) as number;
      if (setErr !== kAXErrorSuccess) {
        throw new Error(`native slider setter failed (${setErr})`);
      }
      const actual = this.value();
      if (actual !== desired) {
        throw new Error("native slider readback mismatch");
      }
      return actual;
    } catch (error) {
      this.uncertain = true;
      this.forget();
      throw new AxUncertain(`write unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      cfRelease(cfNum);
    }
  }

  /** Releases cached window and slider AXUIElement handles so the next call locates the T-bar afresh. */
  public forget(): void {
    cfRelease(this.pinnedSlider);
    cfRelease(this.pinnedWindow);
    this.pinnedSlider = 0n;
    this.pinnedWindow = 0n;
  }

  public dispose(): void {
    this.forget();
  }

  private running(): boolean {
    const current = readProcessStart(this.pid);
    return (
      current !== undefined &&
      current.startSec === this.startSec &&
      current.startUsec === this.startUsec
    );
  }

  private owned(element: Ptr): boolean {
    if (element === 0n) return false;
    const owner = Buffer.alloc(4);
    const err = AXUIElementGetPid(element, owner) as number;
    if (err === kAXErrorAPIDisabled) {
      throw new AxRefusal(
        "Allow Stream Deck (or OpenDeck) in macOS System Settings -> Privacy & Security -> Accessibility.",
        "permission"
      );
    }
    if (err !== kAXErrorSuccess || owner.readInt32LE(0) !== this.pid) return false;
    const timeoutErr = AXUIElementSetMessagingTimeout(element, AX_MESSAGING_TIMEOUT_SECONDS) as number;
    return timeoutErr === kAXErrorSuccess;
  }

  private children(element: Ptr, attrName: string, limit: number, pool: Ptr[], strict: boolean): Ptr[] {
    if (limit <= 0) return [];
    const countBuf = Buffer.alloc(8);
    const attr = cfConstString(attrName);
    const countErr = AXUIElementGetAttributeValueCount(element, attr, countBuf) as number;
    if (countErr === kAXErrorAPIDisabled) {
      throw new AxRefusal(
        "Allow Stream Deck (or OpenDeck) in macOS System Settings -> Privacy & Security -> Accessibility.",
        "permission"
      );
    }
    if (countErr === kAXErrorAttributeUnsupported || countErr === kAXErrorNoValue) return [];
    if (countErr !== kAXErrorSuccess) {
      if (strict) throw new AxRefusal(`cannot read OBS ${attrName} (${countErr})`);
      return [];
    }
    const count = Number(countBuf.readBigInt64LE(0));
    if (count <= 0) return [];
    if (count > limit) {
      throw new AxRefusal(`incomplete AX traversal: ${attrName} count ${count} exceeds limit ${limit}`);
    }
    const outArr = Buffer.alloc(8);
    const copyErr = AXUIElementCopyAttributeValues(element, attr, 0, count, outArr) as number;
    if (copyErr === kAXErrorAPIDisabled) {
      throw new AxRefusal(
        "Allow Stream Deck (or OpenDeck) in macOS System Settings -> Privacy & Security -> Accessibility.",
        "permission"
      );
    }
    const arrPtr = copyErr === kAXErrorSuccess ? outArr.readBigUInt64LE(0) : 0n;
    if (arrPtr === 0n) {
      if (strict) throw new AxRefusal(`cannot copy OBS ${attrName} (${copyErr})`);
      return [];
    }
    try {
      if (toPtr(CFGetTypeID(arrPtr) as number | bigint) !== CF_ARRAY_TYPE_ID) return [];
      const actualCount = Number(CFArrayGetCount(arrPtr) as number | bigint);
      const result: Ptr[] = [];
      for (let i = 0; i < actualCount; i++) {
        const item = toPtr(CFArrayGetValueAtIndex(arrPtr, i) as number | bigint);
        if (item !== 0n) {
          const retained = cfRetain(item);
          pool.push(retained);
          result.push(retained);
        }
      }
      return result;
    } finally {
      cfRelease(arrPtr);
    }
  }

  private readChecked(allowPrompt: boolean): number {
    const reused = this.locate(allowPrompt);
    try {
      return this.value();
    } catch (error) {
      if (
        !reused ||
        (error instanceof AxRefusal &&
          (error.reason === "unavailable" || error.reason === "minimised" || error.reason === "permission"))
      ) {
        throw error;
      }
      this.forget();
      this.locate(false);
      return this.value();
    }
  }

  private locate(allowPrompt: boolean): boolean {
    if (!this.running()) throw new AxRefusal("OBS process exited");
    ensureAccessibilityTrusted(allowPrompt);

    if (this.pinnedSlider !== 0n && this.pinnedWindow !== 0n && this.owned(this.pinnedWindow) && this.owned(this.pinnedSlider)) {
      const minimised = attrBoolOpt(this.pinnedWindow, "AXMinimized");
      if (minimised === true) throw new AxRefusal("OBS is minimised", "minimised");
      if (minimised === false) return true;
    }

    this.forget();
    const pool: Ptr[] = [];
    try {
      const app = toPtr(AXUIElementCreateApplication(this.pid) as number | bigint);
      if (app === 0n) throw new AxRefusal("cannot inspect OBS application");
      pool.push(app);
      if (!this.owned(app)) throw new AxRefusal("OBS application element unavailable");

      const rawWindows = this.children(app, "AXWindows", AX_WINDOWS_LIMIT, pool, true);
      let sawMinimised = false;
      const activeWindows: Ptr[] = [];

      for (const win of rawWindows) {
        if (!this.owned(win)) continue;
        if (attrStringOpt(win, "AXRole") !== "AXWindow") continue;
        const subrole = attrStringOpt(win, "AXSubrole");
        if (subrole === "AXFloatingWindow" || subrole === "AXSystemFloatingWindow") continue;
        const minimised = attrBoolOpt(win, "AXMinimized");
        if (minimised === true) {
          sawMinimised = true;
          continue;
        }
        if (minimised !== false) continue;
        activeWindows.push(win);
      }

      if (activeWindows.length === 0) {
        if (sawMinimised) throw new AxRefusal("OBS is minimised", "minimised");
        throw new AxRefusal(
          "Cannot find the main OBS window. Keep it open on this desktop, with Studio Mode on and the T-bar visible."
        );
      }

      const deadline = performance.now() + AX_TRAVERSAL_BUDGET_MS;
      const seen = new Map<bigint, Ptr[]>();
      const markVisited = (el: Ptr): boolean => {
        const hash = toPtr(CFHash(el) as number | bigint);
        const bucket = seen.get(hash);
        if (!bucket) {
          seen.set(hash, [el]);
          return true;
        }
        if (bucket.some((existing) => (CFEqual(existing, el) as number) !== 0)) return false;
        bucket.push(el);
        return true;
      };

      const queue: Array<{ element: Ptr; window: Ptr; depth: number }> = activeWindows.map((win) => ({
        element: win,
        window: win,
        depth: 0
      }));
      const matches: Array<{ slider: Ptr; window: Ptr }> = [];

      let index = 0;
      while (index < queue.length) {
        if (performance.now() >= deadline) {
          throw new AxRefusal("incomplete AX traversal: deadline");
        }
        const { element, window, depth } = queue[index++]!;
        if (!markVisited(element)) continue;
        if (!this.owned(element)) continue;

        const role = attrStringOpt(element, "AXRole");
        const subrole = attrStringOpt(element, "AXSubrole");
        if (role === "AXDockItem" || subrole === "AXFloatingWindow" || subrole === "AXSystemFloatingWindow") {
          continue;
        }
        const ident = attrStringOpt(element, "AXIdentifier");
        if (role === "AXSlider" && ident === SLIDER_ID) {
          matches.push({ slider: element, window });
        }
        // Prune sibling OBSBasic subtrees (docks, statusbar, menubar) that are outside SLIDER_ID's Qt ancestor path.
        if (ident && ident.startsWith("OBSApp.OBSBasic.") && ident !== SLIDER_ID && !SLIDER_ID.startsWith(`${ident}.`)) {
          continue;
        }

        if (depth < AX_DEPTH_LIMIT) {
          const room = AX_NODE_LIMIT - queue.length;
          if (room <= 0) throw new AxRefusal("incomplete AX traversal: node budget");
          const kids = this.children(element, "AXChildren", Math.min(AX_CHILDREN_PER_NODE_LIMIT, room), pool, false);
          for (const kid of kids) {
            queue.push({ element: kid, window, depth: depth + 1 });
          }
        }
      }

      if (matches.length === 0) {
        if (sawMinimised) throw new AxRefusal("OBS is minimised", "minimised");
        throw new AxRefusal(
          "Cannot find the T-bar in OBS. Keep the main OBS window open, with Studio Mode on and the T-bar visible."
        );
      }
      if (matches.length > 1) {
        throw new AxRefusal("ambiguous OBS Studio Mode T-bar");
      }

      this.pinnedWindow = cfRetain(matches[0]!.window);
      this.pinnedSlider = cfRetain(matches[0]!.slider);
      try {
        this.value();
      } catch (error) {
        this.forget();
        throw error;
      }
      return false;
    } finally {
      for (const item of pool) cfRelease(item);
    }
  }

  private value(): number {
    if (!this.running()) throw new AxRefusal("OBS process exited");
    ensureAccessibilityTrusted(false);
    if (this.pinnedWindow === 0n || this.pinnedSlider === 0n) {
      throw new AxRefusal("OBS T-bar handle unavailable");
    }
    if (!this.owned(this.pinnedWindow) || !this.owned(this.pinnedSlider)) {
      throw new AxRefusal("OBS window no longer owned");
    }
    const minimised = attrBoolOpt(this.pinnedWindow, "AXMinimized");
    if (minimised === true) throw new AxRefusal("OBS is minimised", "minimised");
    if (minimised !== false) throw new AxRefusal("OBS window unavailable");

    const orientation = attrStringOpt(this.pinnedSlider, "AXOrientation");
    if (
      attrStringOpt(this.pinnedSlider, "AXRole") !== "AXSlider" ||
      attrStringOpt(this.pinnedSlider, "AXIdentifier") !== SLIDER_ID ||
      (orientation !== undefined && orientation !== "AXHorizontalOrientation") ||
      attrBoolOpt(this.pinnedSlider, "AXEnabled") !== true ||
      attrNumberOpt(this.pinnedSlider, "AXMinValue") !== 0 ||
      attrNumberOpt(this.pinnedSlider, "AXMaxValue") !== AX_TBAR_MAX ||
      !isSettable(this.pinnedSlider, "AXValue")
    ) {
      throw new AxRefusal("native Studio Mode slider identity, orientation, range, or enabled state changed");
    }

    const { value: sliderWin } = copyAttr(this.pinnedSlider, "AXWindow");
    try {
      if (sliderWin === 0n || (CFEqual(sliderWin, this.pinnedWindow) as number) === 0) {
        throw new AxRefusal("native Studio Mode slider window changed");
      }
    } finally {
      cfRelease(sliderWin);
    }

    const current = attrNumberOpt(this.pinnedSlider, "AXValue");
    if (current === undefined || !(current >= 0 && current <= AX_TBAR_MAX) || current !== Math.trunc(current)) {
      throw new AxRefusal("invalid native T-bar position");
    }
    return current;
  }
}
