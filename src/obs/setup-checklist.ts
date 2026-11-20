// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One-shot setup readiness checklist and Playlister input-kind probe (P1-5):
 * - Runs ONLY on explicit inspector open (`directPiReady`) or `Check again`
 *   (`directRunChecklist`) — never on a background timer or polling loop.
 * - Checks OBS reachability, password acceptance, OBS 33.x, Studio Mode, Fade
 *   transition, local OBS elevation and window state (read-only Win32 probe),
 *   macOS Accessibility trust (`AXIsProcessTrusted()`, never prompting),
 *   optional OBS plugins (`midi-fadester`, `visual-sidechain`, `obs-playlister`
 *   by input kind with `"version unknown"`), and who holds the VJster link port.
 */
import { createRequire } from "node:module";
import type KoffiModule from "koffi";
import { isLoopbackObsHost } from "../../packages/streamdeck-fadester-shared/src/obs/obs-websocket-config.js";
import { vendorErrorKind } from "../../packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.js";
import type { ConnectionStatusInfo } from "../../packages/streamdeck-fadester-shared/src/types.js";
import { DEFAULT_LINK_PORT } from "../vjster/shared/protocol.js";
import { probeVjsterPortStatus, type VjsterPortProbeResult } from "../vjster/plugin/link-server.js";

export const PLAYLISTER_INPUT_KIND = "obs_playlister_source";

export type ChecklistDotState =
  | "ok"
  | "fail"
  | "warn"
  | "info"
  | "unknown"
  | "not_applicable";

export type ChecklistItemId =
  | "obs_reachable"
  | "password_accepted"
  | "obs_version"
  | "studio_mode"
  | "fade_selected"
  | "obs_not_elevated"
  | "window_not_minimised"
  | "macos_accessibility"
  | "midi_fadester"
  | "visual_sidechain"
  | "playlister"
  | "vjster_port_holder";

export type ChecklistReasonCode =
  | "ok"
  | "unreachable"
  | "wrong_password"
  | "not_obs_33"
  | "studio_off"
  | "not_fade"
  | "elevated"
  | "minimised"
  | "ax_denied"
  | "present"
  | "missing"
  | "too_old"
  | "vs_conflict"
  | "vs_off"
  | "port_free"
  | "port_self"
  | "port_other"
  | "port_unknown_holder"
  | "unknown"
  | "not_applicable";

export interface ChecklistItemMeta {
  readonly obsVersion?: string;
  readonly transitionName?: string;
  readonly version?: string;
  readonly port?: number;
  readonly holder?: string;
}

export interface SetupChecklistItem {
  readonly id: ChecklistItemId;
  readonly state: ChecklistDotState;
  readonly code: ChecklistReasonCode;
  readonly detail: string;
  readonly fix: string;
  readonly meta: ChecklistItemMeta;
}

export interface PlaylisterPluginInfo {
  readonly status: "present" | "missing" | "unknown";
  readonly inputKind: string;
  readonly version: "version unknown";
}

export interface LocalObsProcessProbe {
  readonly elevated: "ok" | "fail" | "unknown" | "not_applicable";
  readonly minimised: "ok" | "fail" | "unknown";
}

export interface SetupChecklistReport {
  readonly checkedAtMs: number;
  readonly items: readonly SetupChecklistItem[];
  readonly playlisterPlugin: PlaylisterPluginInfo;
}

export interface SetupChecklistClientLike {
  isConnected(): boolean;
  getStatus(): ConnectionStatusInfo;
  getSettings(): { host: string; port: number; password: string };
  getCatalog(): {
    studioMode: boolean;
    currentTransition?: string;
    inputDetails?: ReadonlyArray<{ inputKind?: string; unversionedInputKind?: string }>;
  };
  getNativeTbarStatus?(): string;
  sendObsRequest(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>>;
  callNamedVendor<T = Record<string, unknown>>(
    vendorName: string,
    requestType: string,
    requestData?: Record<string, unknown>
  ): Promise<T>;
}

export interface SetupChecklistOptions {
  readonly platform?: string;
  readonly vjsterPort?: number;
  readonly now?: () => number;
  readonly probeLocalObsProcess?: (port: number, platform: string) => LocalObsProcessProbe;
  readonly probeMacAccessibility?: (platform: string) => "ok" | "fail" | "unknown" | "not_applicable";
  readonly probeVjsterPort?: (port: number) => Promise<VjsterPortProbeResult>;
}

const OBS_33_RE = /^33\.\d+\.\d+(\D|$)/;

function unversionInputKind(raw: string): string {
  return raw.replace(/_v\d+$/, "");
}

/**
 * Detects `obs-playlister` via `GetInputKindList` (or already-present scene inputs).
 * Playlister exposes no vendor API over obs-websocket, so version is always
 * reported honestly as `"version unknown"`.
 */
export async function detectPlaylisterPlugin(
  client: Pick<SetupChecklistClientLike, "isConnected" | "getCatalog" | "sendObsRequest">
): Promise<PlaylisterPluginInfo> {
  if (!client.isConnected()) {
    return { status: "unknown", inputKind: PLAYLISTER_INPUT_KIND, version: "version unknown" };
  }
  const details = client.getCatalog().inputDetails ?? [];
  const inCatalog = details.some((entry) => {
    const kind = entry.unversionedInputKind || unversionInputKind(String(entry.inputKind ?? ""));
    return kind === PLAYLISTER_INPUT_KIND;
  });

  try {
    const reply = await client.sendObsRequest("GetInputKindList", { unversioned: true });
    if (Array.isArray(reply.inputKinds)) {
      const found =
        inCatalog ||
        reply.inputKinds.some(
          (k) => typeof k === "string" && unversionInputKind(k) === PLAYLISTER_INPUT_KIND
        );
      return {
        status: found ? "present" : "missing",
        inputKind: PLAYLISTER_INPUT_KIND,
        version: "version unknown"
      };
    }
  } catch {
    // Older/limited WebSocket server without GetInputKindList: fall back to catalog presence if seen.
  }

  return {
    status: inCatalog ? "present" : "unknown",
    inputKind: PLAYLISTER_INPUT_KIND,
    version: "version unknown"
  };
}

// ---------------------------------------------------------------------------
// Read-only OS probes (loaded lazily on demand, zero background timers)
// ---------------------------------------------------------------------------

interface Win32ChecklistBindings {
  GetExtendedTcpTable: (...args: unknown[]) => number;
  OpenProcess: (...args: unknown[]) => number | bigint;
  /** Windows' last error (koffi.errno() is the C runtime's errno, which Win32 calls do not set). */
  GetLastError: () => number;
  CloseHandle: (...args: unknown[]) => number;
  QueryFullProcessImageNameW: (...args: unknown[]) => number;
  OpenProcessToken: (...args: unknown[]) => number;
  GetTokenInformation: (...args: unknown[]) => number;
  EnumWindows: (cb: (hwnd: number | bigint, lParam: number | bigint) => number, lParam: number) => number;
  GetWindowThreadProcessId: (hwnd: bigint, outPid: Buffer) => number;
  IsWindowVisible: (hwnd: bigint) => number;
  IsIconic: (hwnd: bigint) => number;
}

let cachedWin32: Win32ChecklistBindings | null | undefined;

type Koffi = typeof KoffiModule;
let cachedKoffi: Koffi | null | undefined;

/**
 * koffi, loaded the first time a Windows or macOS probe needs it. It is never imported at start: koffi has no native
 * addon for every platform this plugin may run on (OpenDeck on Linux), and a missing addon throws while loading.
 */
function loadKoffi(): Koffi | null {
  if (cachedKoffi !== undefined) return cachedKoffi;
  try {
    const nativeRequire = createRequire(import.meta.url);
    cachedKoffi = nativeRequire("koffi") as Koffi;
  } catch {
    cachedKoffi = null;
  }
  return cachedKoffi;
}
let cachedMacAxTrust: (() => number) | null | undefined;

function getWin32Bindings(): Win32ChecklistBindings | null {
  if (cachedWin32 !== undefined) return cachedWin32;
  if (process.platform !== "win32") {
    cachedWin32 = null;
    return null;
  }
  const koffi = loadKoffi();
  if (!koffi) {
    cachedWin32 = null;
    return null;
  }
  try {
    const enumProc = koffi.proto("__stdcall", "FadesterChecklistEnumWindowsProc", "int32", [
      "uint64",
      "int64"
    ]);
    const iphlpapi = koffi.load("iphlpapi.dll");
    const kernel32 = koffi.load("kernel32.dll");
    const advapi32 = koffi.load("advapi32.dll");
    const user32 = koffi.load("user32.dll");
    cachedWin32 = {
      GetExtendedTcpTable: iphlpapi.func("__stdcall", "GetExtendedTcpTable", "uint32", [
        "void *",
        "void *",
        "int32",
        "uint32",
        "uint32",
        "uint32"
      ]) as Win32ChecklistBindings["GetExtendedTcpTable"],
      OpenProcess: kernel32.func("__stdcall", "OpenProcess", "uint64", [
        "uint32",
        "int32",
        "uint32"
      ]) as Win32ChecklistBindings["OpenProcess"],
      GetLastError: kernel32.func("__stdcall", "GetLastError", "uint32", []) as Win32ChecklistBindings["GetLastError"],
      CloseHandle: kernel32.func("__stdcall", "CloseHandle", "int32", [
        "uint64"
      ]) as Win32ChecklistBindings["CloseHandle"],
      QueryFullProcessImageNameW: kernel32.func("__stdcall", "QueryFullProcessImageNameW", "int32", [
        "uint64",
        "uint32",
        "void *",
        "void *"
      ]) as Win32ChecklistBindings["QueryFullProcessImageNameW"],
      OpenProcessToken: advapi32.func("__stdcall", "OpenProcessToken", "int32", [
        "uint64",
        "uint32",
        "void *"
      ]) as Win32ChecklistBindings["OpenProcessToken"],
      GetTokenInformation: advapi32.func("__stdcall", "GetTokenInformation", "int32", [
        "uint64",
        "int32",
        "void *",
        "uint32",
        "void *"
      ]) as Win32ChecklistBindings["GetTokenInformation"],
      EnumWindows: user32.func("__stdcall", "EnumWindows", "int32", [
        koffi.pointer(enumProc),
        "int64"
      ]) as Win32ChecklistBindings["EnumWindows"],
      GetWindowThreadProcessId: user32.func("__stdcall", "GetWindowThreadProcessId", "uint32", [
        "uint64",
        "void *"
      ]) as Win32ChecklistBindings["GetWindowThreadProcessId"],
      IsWindowVisible: user32.func("__stdcall", "IsWindowVisible", "int32", [
        "uint64"
      ]) as Win32ChecklistBindings["IsWindowVisible"],
      IsIconic: user32.func("__stdcall", "IsIconic", "int32", [
        "uint64"
      ]) as Win32ChecklistBindings["IsIconic"]
    };
    return cachedWin32;
  } catch {
    cachedWin32 = null;
    return null;
  }
}

function findWin32LoopbackListenerPid(win: Win32ChecklistBindings, port: number): number | null {
  const AF_INET = 2;
  const AF_INET6 = 23;
  const TCP_TABLE_OWNER_PID_LISTENER = 3;
  const ERROR_INSUFFICIENT_BUFFER = 122;
  const ERROR_NOT_SUPPORTED = 50;

  const owners = new Set<number>();
  for (const family of [AF_INET, AF_INET6]) {
    const size = Buffer.alloc(4);
    let status = win.GetExtendedTcpTable(null, size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
    if (status === ERROR_NOT_SUPPORTED && family === AF_INET6) continue;
    let table = Buffer.alloc(0);
    for (let attempt = 0; attempt < 4 && status === ERROR_INSUFFICIENT_BUFFER; attempt++) {
      table = Buffer.alloc(size.readUInt32LE(0) + 1024);
      size.writeUInt32LE(table.length, 0);
      status = win.GetExtendedTcpTable(table, size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
    }
    if (status !== 0 || table.length < 4) return null;
    const count = table.readUInt32LE(0);
    for (let i = 0; i < count; i++) {
      if (family === AF_INET) {
        const row = 4 + i * 24;
        if (row + 24 > table.length) break;
        if (table.readUInt16BE(row + 8) !== port) continue;
        const any = table.readUInt32LE(row + 4) === 0;
        if (!any && table[row + 4] !== 127) continue;
        owners.add(table.readUInt32LE(row + 20));
      } else {
        const row = 4 + i * 56;
        if (row + 56 > table.length) break;
        if (table.readUInt16BE(row + 20) !== port) continue;
        const address = table.subarray(row, row + 16);
        const any = address.every((byte) => byte === 0);
        const loopback = address.subarray(0, 15).every((byte) => byte === 0) && address[15] === 1;
        if (!any && !loopback) continue;
        owners.add(table.readUInt32LE(row + 52));
      }
    }
  }
  return owners.size === 1 ? [...owners][0]! : null;
}

export function defaultProbeLocalObsProcess(port: number, platform: string): LocalObsProcessProbe {
  if (platform === "darwin") {
    return { elevated: "not_applicable", minimised: "unknown" };
  }
  if (platform !== "win32") {
    return { elevated: "unknown", minimised: "unknown" };
  }
  const win = getWin32Bindings();
  if (!win) {
    return { elevated: "unknown", minimised: "unknown" };
  }

  const pid = findWin32LoopbackListenerPid(win, port);
  if (pid === null || pid <= 0) {
    return { elevated: "unknown", minimised: "unknown" };
  }

  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const SYNCHRONIZE = 0x100000;
  const ERROR_ACCESS_DENIED = 5;
  const TOKEN_QUERY = 0x0008;
  const TokenElevation = 20;

  const proc = BigInt(win.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid));
  if (proc === 0n) {
    if (win.GetLastError() === ERROR_ACCESS_DENIED) {
      return { elevated: "fail", minimised: "unknown" };
    }
    return { elevated: "unknown", minimised: "unknown" };
  }

  try {
    const pathBuf = Buffer.alloc(4096 * 2);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(4096, 0);
    if (!win.QueryFullProcessImageNameW(proc, 0, pathBuf, lenBuf)) {
      return { elevated: "unknown", minimised: "unknown" };
    }
    const imagePath = pathBuf.subarray(0, lenBuf.readUInt32LE(0) * 2).toString("utf16le");
    const exeName = imagePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    if (exeName !== "obs64.exe") {
      // Never guess on a stand-in test server or tunnel process.
      return { elevated: "unknown", minimised: "unknown" };
    }

    let elevated: "ok" | "fail" = "ok";
    const tokOut = Buffer.alloc(8);
    if (win.OpenProcessToken(proc, TOKEN_QUERY, tokOut)) {
      const tok = tokOut.readBigUInt64LE(0);
      if (tok !== 0n) {
        try {
          const elevBuf = Buffer.alloc(4);
          const retLen = Buffer.alloc(4);
          if (win.GetTokenInformation(tok, TokenElevation, elevBuf, 4, retLen)) {
            if (elevBuf.readUInt32LE(0) !== 0) {
              elevated = "fail";
            }
          }
        } finally {
          win.CloseHandle(tok);
        }
      }
    }

    const visibleWindows: bigint[] = [];
    win.EnumWindows((rawHwnd) => {
      const hwnd = BigInt(rawHwnd);
      if (hwnd !== 0n && win.IsWindowVisible(hwnd)) {
        const ownerBuf = Buffer.alloc(4);
        if (win.GetWindowThreadProcessId(hwnd, ownerBuf) !== 0 && ownerBuf.readUInt32LE(0) === pid) {
          visibleWindows.push(hwnd);
        }
      }
      return 1;
    }, 0);

    let minimised: "ok" | "fail" | "unknown" = "unknown";
    if (visibleWindows.length > 0) {
      const hasUnminimised = visibleWindows.some((hwnd) => win.IsIconic(hwnd) === 0);
      minimised = hasUnminimised ? "ok" : "fail";
    }
    return { elevated, minimised };
  } finally {
    win.CloseHandle(proc);
  }
}

/**
 * Checks macOS Accessibility trust using zero-arg `AXIsProcessTrusted()`, which
 * NEVER prompts the user. Returns `"not_applicable"` off macOS and `"unknown"`
 * if ApplicationServices cannot be loaded.
 */
export function defaultProbeMacAccessibility(
  platform: string
): "ok" | "fail" | "unknown" | "not_applicable" {
  if (platform !== "darwin") return "not_applicable";
  if (cachedMacAxTrust === undefined) {
    const koffi = loadKoffi();
    try {
      if (!koffi) throw new Error("koffi unavailable");
      const appServices = koffi.load(
        "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
      );
      cachedMacAxTrust = appServices.func("AXIsProcessTrusted", "uint8", []) as () => number;
    } catch {
      cachedMacAxTrust = null;
    }
  }
  if (!cachedMacAxTrust) return "unknown";
  try {
    return cachedMacAxTrust() !== 0 ? "ok" : "fail";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Checklist evaluation
// ---------------------------------------------------------------------------

// What a failed vendor call says about the plugin (600 by its comment, or 604): the shared client's, which the keys'
// "Update Midi Fadester" gates use too.
export { vendorErrorKind };

/** Numeric "major.minor.patch" (any pre-release or build suffix dropped); null when it is not a version. */
export function parseVersion(version: unknown): [number, number, number] | null {
  if (typeof version !== "string") return null;
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

export function versionAtLeast(version: unknown, min: [number, number, number]): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

/** Midi Fadester carries Visual Sidechain from this version on. */
export const MF_WITH_VISUAL_SIDECHAIN: [number, number, number] = [0, 9, 0];

/**
 * The Visual Sidechain item read against Midi Fadester's. From Midi Fadester 0.9.0 Visual Sidechain is part of it and
 * answers with Midi Fadester's version. With such a Midi Fadester, a Visual Sidechain answering with an older version is
 * the old standalone plugin, loaded first (Midi Fadester then keeps its own copy off), and no answer at all means
 * Visual Sidechain in Midi Fadester did not start.
 */
export function reconcileVisualSidechain(vs: SetupChecklistItem, mf: SetupChecklistItem): SetupChecklistItem {
  const mfVersion = mf.meta.version;
  const mfCarriesVs = (mf.code === "present" || mf.code === "too_old") && versionAtLeast(mfVersion, MF_WITH_VISUAL_SIDECHAIN);
  const vsVersion = typeof vs.meta.version === "string" ? vs.meta.version : "";
  if (mfCarriesVs && (vs.code === "present" || vs.code === "too_old") && !versionAtLeast(vsVersion, MF_WITH_VISUAL_SIDECHAIN)) {
    const shown = parseVersion(vsVersion) ? vsVersion : "";
    return {
      id: "visual_sidechain",
      state: "warn",
      code: "vs_conflict",
      detail: shown ? `Old Visual Sidechain ${shown} running` : "Old Visual Sidechain running",
      fix: "Remove the old Visual Sidechain plugin and restart OBS: Visual Sidechain is part of Midi Fadester now. Midi Fadester's Fadester Desk dock names the file.",
      meta: shown ? { version: shown } : {}
    };
  }
  if (mfCarriesVs && vs.code === "missing") {
    return {
      id: "visual_sidechain",
      state: "warn",
      code: "vs_off",
      detail: "Switched off in Midi Fadester",
      fix: "Visual Sidechain in Midi Fadester did not start. Look at Midi Fadester's Fadester Desk dock or OBS's log, then restart OBS.",
      meta: {}
    };
  }
  return vs;
}

async function checkMidiFadester(
  client: SetupChecklistClientLike,
  connected: boolean
): Promise<SetupChecklistItem> {
  if (!connected) {
    return {
      id: "midi_fadester",
      state: "unknown",
      code: "unknown",
      detail: "Waiting for OBS connection",
      fix: "",
      meta: {}
    };
  }
  let stateReply: Record<string, unknown>;
  try {
    stateReply = await client.callNamedVendor<Record<string, unknown>>("midi-fadester", "get_state");
  } catch (error) {
    const kind = vendorErrorKind(error);
    if (kind === "vendor_missing") {
      return {
        id: "midi_fadester",
        state: "info",
        code: "missing",
        detail: "Not installed (optional)",
        fix: "Optional: install Midi Fadester in OBS if you use a MIDI controller or shared slots.",
        meta: {}
      };
    }
    if (kind === "request_missing") {
      return {
        id: "midi_fadester",
        state: "warn",
        code: "too_old",
        detail: "Midi Fadester installed",
        fix: "Update Midi Fadester in OBS for Clean FX, slot configuration, and single-owner layer opacity.",
        meta: {}
      };
    }
    return {
      id: "midi_fadester",
      state: "unknown",
      code: "unknown",
      detail: "Could not read Midi Fadester",
      fix: "",
      meta: {}
    };
  }

  const version = typeof stateReply.version === "string" && stateReply.version ? stateReply.version : "installed";
  const slots = Array.isArray(stateReply.slots) ? (stateReply.slots as Array<Record<string, unknown>>) : [];
  const hasFxSlots = slots.some((s) => s && s.kind === "fx");
  if (!hasFxSlots) {
    return {
      id: "midi_fadester",
      state: "warn",
      code: "too_old",
      detail: `Midi Fadester ${version}`,
      fix: "Update Midi Fadester in OBS for Clean FX, slot configuration, and single-owner layer opacity.",
      meta: { version }
    };
  }

  try {
    const catalogReply = await client.callNamedVendor<Record<string, unknown>>("midi-fadester", "get_catalog", {});
    const scenes = Array.isArray(catalogReply.scenes)
      ? (catalogReply.scenes as Array<Record<string, unknown>>)
      : [];
    const missingLayerFields = scenes.some((scene) => {
      const layers = Array.isArray(scene?.layers) ? (scene.layers as Array<Record<string, unknown>>) : [];
      return layers.some(
        (layer) =>
          typeof layer?.has_internal_opacity !== "boolean" ||
          typeof layer?.opacity_slot !== "string"
      );
    });
    if (missingLayerFields) {
      return {
        id: "midi_fadester",
        state: "warn",
        code: "too_old",
        detail: `Midi Fadester ${version}`,
        fix: "Update Midi Fadester in OBS for Clean FX, slot configuration, and single-owner layer opacity.",
        meta: { version }
      };
    }
  } catch (error) {
    if (vendorErrorKind(error) === "request_missing" || (error as { code?: unknown } | null)?.code === 400) {
      return {
        id: "midi_fadester",
        state: "warn",
        code: "too_old",
        detail: `Midi Fadester ${version}`,
        fix: "Update Midi Fadester in OBS for Clean FX, slot configuration, and single-owner layer opacity.",
        meta: { version }
      };
    }
  }

  return {
    id: "midi_fadester",
    state: "ok",
    code: "present",
    detail: `Midi Fadester ${version}`,
    fix: "",
    meta: { version }
  };
}

const VS_FIX_MISSING =
  "Optional: install Midi Fadester 0.9.0 or newer in OBS (it includes Visual Sidechain) if you use audio-reactive shaders, Visual Panic, or Tape Deck.";
const VS_FIX_OLD =
  "Install Midi Fadester 0.9.0 or newer in OBS: it includes Visual Sidechain, with live safety state, tempo lock, and Tape Deck controls.";

async function checkVisualSidechain(
  client: SetupChecklistClientLike,
  connected: boolean
): Promise<SetupChecklistItem> {
  if (!connected) {
    return {
      id: "visual_sidechain",
      state: "unknown",
      code: "unknown",
      detail: "Waiting for OBS connection",
      fix: "",
      meta: {}
    };
  }

  let signals: Record<string, unknown>;
  try {
    signals = await client.callNamedVendor<Record<string, unknown>>("visual-sidechain", "get_signals");
  } catch (error) {
    const kind = vendorErrorKind(error);
    if (kind === "vendor_missing") {
      return {
        id: "visual_sidechain",
        state: "info",
        code: "missing",
        detail: "Not installed (optional)",
        fix: VS_FIX_MISSING,
        meta: {}
      };
    }
    if (kind === "request_missing") {
      return {
        id: "visual_sidechain",
        state: "warn",
        code: "too_old",
        detail: "Visual Sidechain installed",
        fix: VS_FIX_OLD,
        meta: {}
      };
    }
    return {
      id: "visual_sidechain",
      state: "unknown",
      code: "unknown",
      detail: "Could not read Visual Sidechain",
      fix: "",
      meta: {}
    };
  }

  const version = typeof signals.version === "string" && signals.version ? signals.version : "installed";
  const hasSignalFields =
    typeof signals.audio_present === "boolean" &&
    typeof signals.beat_index === "number" &&
    typeof signals.bar_phase === "number";

  if (!hasSignalFields) {
    return {
      id: "visual_sidechain",
      state: "warn",
      code: "too_old",
      detail: `Visual Sidechain ${version}`,
      fix: VS_FIX_OLD,
      meta: { version }
    };
  }

  try {
    const [, decksReply] = await Promise.all([
      client.callNamedVendor<Record<string, unknown>>("visual-sidechain", "get_safety"),
      client.callNamedVendor<Record<string, unknown>>("visual-sidechain", "get_decks")
    ]);
    if (typeof decksReply.version !== "string" || decksReply.version.length === 0) {
      return {
        id: "visual_sidechain",
        state: "warn",
        code: "too_old",
        detail: `Visual Sidechain ${version}`,
        fix: VS_FIX_OLD,
        meta: { version }
      };
    }
  } catch (error) {
    if (vendorErrorKind(error) !== "other") {
      return {
        id: "visual_sidechain",
        state: "warn",
        code: "too_old",
        detail: `Visual Sidechain ${version}`,
        fix: VS_FIX_OLD,
        meta: { version }
      };
    }
  }

  return {
    id: "visual_sidechain",
    state: "ok",
    code: "present",
    detail: `Visual Sidechain ${version}`,
    fix: "",
    meta: { version }
  };
}

export async function evaluateSetupChecklist(
  client: SetupChecklistClientLike,
  options: SetupChecklistOptions = {}
): Promise<SetupChecklistReport> {
  const platform = options.platform ?? process.platform;
  const vjsterPort = options.vjsterPort ?? DEFAULT_LINK_PORT;
  const now = options.now ?? Date.now;
  const probeLocal = options.probeLocalObsProcess ?? defaultProbeLocalObsProcess;
  const probeMacAx = options.probeMacAccessibility ?? defaultProbeMacAccessibility;
  const probePort = options.probeVjsterPort ?? ((p: number) => probeVjsterPortStatus(p));

  const status = client.getStatus();
  const settings = client.getSettings();
  const catalog = client.getCatalog();
  const connected = client.isConnected() && status.kind === "connected";
  const wrongPassword = status.kind === "wrong_password";
  const obsReachable = connected || wrongPassword;
  const isLocal = isLoopbackObsHost(settings.host);

  const reachableItem: SetupChecklistItem = obsReachable
    ? {
        id: "obs_reachable",
        state: "ok",
        code: "ok",
        detail: `${settings.host}:${settings.port}`,
        fix: "",
        meta: { port: settings.port }
      }
    : {
        id: "obs_reachable",
        state: "fail",
        code: "unreachable",
        detail: `${settings.host}:${settings.port}`,
        fix: "Open OBS and enable Tools > WebSocket Server Settings on this host and port.",
        meta: { port: settings.port }
      };

  const passwordItem: SetupChecklistItem = connected
    ? {
        id: "password_accepted",
        state: "ok",
        code: "ok",
        detail: "Accepted",
        fix: "",
        meta: {}
      }
    : wrongPassword
      ? {
          id: "password_accepted",
          state: "fail",
          code: "wrong_password",
          detail: "Rejected",
          fix: "Press Use OBS's saved password above or enter OBS's WebSocket password, then press Save for all controls & test.",
          meta: {}
        }
      : {
          id: "password_accepted",
          state: "unknown",
          code: "unknown",
          detail: "Waiting for OBS connection",
          fix: "",
          meta: {}
        };

  const obsVer = (status.obsVersion ?? "").trim();
  const obsVersionItem: SetupChecklistItem = !connected
    ? {
        id: "obs_version",
        state: "unknown",
        code: "unknown",
        detail: "Waiting for OBS connection",
        fix: "",
        meta: {}
      }
    : OBS_33_RE.test(obsVer)
      ? {
          id: "obs_version",
          state: "ok",
          code: "ok",
          detail: `OBS ${obsVer}`,
          fix: "",
          meta: { obsVersion: obsVer }
        }
      : {
          id: "obs_version",
          state: "fail",
          code: "not_obs_33",
          detail: obsVer ? `OBS ${obsVer}` : "OBS version unknown",
          fix: "Install OBS Studio 33.x so all Fadester controls and the native T-bar match tested behaviour.",
          meta: { obsVersion: obsVer || "unknown" }
        };

  const studioItem: SetupChecklistItem = !connected
    ? {
        id: "studio_mode",
        state: "unknown",
        code: "unknown",
        detail: "Waiting for OBS connection",
        fix: "",
        meta: {}
      }
    : catalog.studioMode
      ? {
          id: "studio_mode",
          state: "ok",
          code: "ok",
          detail: "On",
          fix: "",
          meta: {}
        }
      : {
          id: "studio_mode",
          state: "fail",
          code: "studio_off",
          detail: "Off",
          fix: "Turn on Studio Mode in OBS (View > Studio Mode).",
          meta: {}
        };

  let fadeItem: SetupChecklistItem;
  if (!connected) {
    fadeItem = {
      id: "fade_selected",
      state: "unknown",
      code: "unknown",
      detail: "Waiting for OBS connection",
      fix: "",
      meta: {}
    };
  } else {
    try {
      const tr = await client.sendObsRequest("GetCurrentSceneTransition");
      const trKind = typeof tr.transitionKind === "string" ? tr.transitionKind : "";
      const trName =
        typeof tr.transitionName === "string" && tr.transitionName
          ? tr.transitionName
          : catalog.currentTransition || trKind || "Transition";
      fadeItem =
        trKind === "fade_transition"
          ? {
              id: "fade_selected",
              state: "ok",
              code: "ok",
              detail: trName,
              fix: "",
              meta: { transitionName: trName }
            }
          : {
              id: "fade_selected",
              state: "fail",
              code: "not_fade",
              detail: trName,
              fix: "Select the Fade transition in OBS's Scene Transitions dock.",
              meta: { transitionName: trName }
            };
    } catch {
      fadeItem = {
        id: "fade_selected",
        state: "unknown",
        code: "unknown",
        detail: "Unknown",
        fix: "",
        meta: {}
      };
    }
  }

  let localProbe: LocalObsProcessProbe;
  if (!connected || !isLocal) {
    localProbe = {
      elevated: platform === "darwin" ? "not_applicable" : "unknown",
      minimised: "unknown"
    };
  } else {
    localProbe = probeLocal(settings.port, platform);
    if (localProbe.minimised === "unknown" && client.getNativeTbarStatus?.() === "following") {
      localProbe = { ...localProbe, minimised: "ok" };
    }
  }

  const elevatedItem: SetupChecklistItem =
    localProbe.elevated === "ok"
      ? {
          id: "obs_not_elevated",
          state: "ok",
          code: "ok",
          detail: "Normal user",
          fix: "",
          meta: {}
        }
      : localProbe.elevated === "fail"
        ? {
            id: "obs_not_elevated",
            state: "fail",
            code: "elevated",
            detail: "Running as administrator",
            fix: "Close OBS and start it normally without Run as administrator.",
            meta: {}
          }
        : localProbe.elevated === "not_applicable"
          ? {
              id: "obs_not_elevated",
              state: "not_applicable",
              code: "not_applicable",
              detail: "Not applicable on macOS",
              fix: "",
              meta: {}
            }
          : {
              id: "obs_not_elevated",
              state: "unknown",
              code: "unknown",
              detail: "Unknown",
              fix: "",
              meta: {}
            };

  const minimisedItem: SetupChecklistItem =
    localProbe.minimised === "ok"
      ? {
          id: "window_not_minimised",
          state: "ok",
          code: "ok",
          detail: "Visible",
          fix: "",
          meta: {}
        }
      : localProbe.minimised === "fail"
        ? {
            id: "window_not_minimised",
            state: "fail",
            code: "minimised",
            detail: "Minimised",
            fix: "Restore OBS's main window from the taskbar so the native T-bar can reach it.",
            meta: {}
          }
        : {
            id: "window_not_minimised",
            state: "unknown",
            code: "unknown",
            detail: "Unknown",
            fix: "",
            meta: {}
          };

  let axState = probeMacAx(platform);
  if (platform === "darwin" && axState === "unknown") {
    const tbar = client.getNativeTbarStatus?.();
    if (tbar === "permission") axState = "fail";
    else if (tbar === "following") axState = "ok";
  }

  const macAxItem: SetupChecklistItem =
    axState === "ok"
      ? {
          id: "macos_accessibility",
          state: "ok",
          code: "ok",
          detail: "Granted",
          fix: "",
          meta: {}
        }
      : axState === "fail"
        ? {
            id: "macos_accessibility",
            state: "fail",
            code: "ax_denied",
            detail: "Not granted",
            fix: "Allow Stream Deck (or OpenDeck) in System Settings > Privacy & Security > Accessibility.",
            meta: {}
          }
        : axState === "not_applicable"
          ? {
              id: "macos_accessibility",
              state: "not_applicable",
              code: "not_applicable",
              detail: "Windows / Linux (not applicable)",
              fix: "",
              meta: {}
            }
          : {
              id: "macos_accessibility",
              state: "unknown",
              code: "unknown",
              detail: "unknown",
              fix: "",
              meta: {}
            };

  const [mfItem, vsRawItem, playlisterPlugin, vjsterProbe] = await Promise.all([
    checkMidiFadester(client, connected),
    checkVisualSidechain(client, connected),
    detectPlaylisterPlugin(client),
    probePort(vjsterPort)
  ]);
  const vsItem = reconcileVisualSidechain(vsRawItem, mfItem);

  const playlisterItem: SetupChecklistItem =
    playlisterPlugin.status === "present"
      ? {
          id: "playlister",
          state: "ok",
          code: "present",
          detail: "Installed (version unknown)",
          fix: "",
          meta: { version: "version unknown" }
        }
      : playlisterPlugin.status === "missing"
        ? {
            id: "playlister",
            state: "info",
            code: "missing",
            detail: "Not installed (optional, version unknown)",
            fix: "Optional: install Playlister in OBS if you use Playlister Transport keys.",
            meta: { version: "version unknown" }
          }
        : {
            id: "playlister",
            state: "unknown",
            code: "unknown",
            detail: "version unknown",
            fix: "",
            meta: { version: "version unknown" }
          };

  let vjsterItem: SetupChecklistItem;
  if (vjsterProbe.state === "free") {
    vjsterItem = {
      id: "vjster_port_holder",
      state: "ok",
      code: "port_free",
      detail: `Port ${vjsterPort} free`,
      fix: "",
      meta: { port: vjsterPort }
    };
  } else if (vjsterProbe.holder) {
    const holderLabel = `${vjsterProbe.holder.product} ${vjsterProbe.holder.version}`.trim();
    if (vjsterProbe.holder.product === "Fadester for OBS" || vjsterProbe.holder.product === "VJster") {
      vjsterItem = {
        id: "vjster_port_holder",
        state: "ok",
        code: "port_self",
        detail: `${holderLabel} (port ${vjsterPort})`,
        fix: "",
        meta: { port: vjsterPort, holder: holderLabel }
      };
    } else {
      vjsterItem = {
        id: "vjster_port_holder",
        state: "warn",
        code: "port_other",
        detail: `Held by ${holderLabel}`,
        fix: `VJster link is held by ${holderLabel}. Close it or turn off VJster there if you use VJster on this deck.`,
        meta: { port: vjsterPort, holder: holderLabel }
      };
    }
  } else {
    vjsterItem = {
      id: "vjster_port_holder",
      state: "warn",
      code: "port_unknown_holder",
      detail: `Port ${vjsterPort} in use`,
      fix: `Port ${vjsterPort} is in use by another program. Close it or choose another VJster port.`,
      meta: { port: vjsterPort }
    };
  }

  return {
    checkedAtMs: now(),
    items: [
      reachableItem,
      passwordItem,
      obsVersionItem,
      studioItem,
      fadeItem,
      elevatedItem,
      minimisedItem,
      macAxItem,
      mfItem,
      vsItem,
      playlisterItem,
      vjsterItem
    ],
    playlisterPlugin
  };
}
