// SPDX-License-Identifier: GPL-2.0-or-later
// OBS 33's Studio Mode T-bar, moved through Windows UI Automation from inside the plugin (Route B,
// docs/TBAR-WINDOWS-INPLUGIN-DESIGN.md). Runs only on the T-bar worker thread (uia-worker.ts): every COM object lives on
// that thread's multithreaded apartment. The rules are tourbox/native/NativeSlider.cpp's, called through koffi:
// IUIAutomation2 with automatic focus off (the managed client stalls about 2 s per write), the process image must be
// obs64.exe, exactly one OBSBasic/Qt main window for that PID, exactly one horizontal non-dock slider with the T-bar's
// AutomationId, type Slider and class SliderIgnoreScroll, range 0..1023 checked before every write, the expected value
// checked before writing, a readback after writing, and once a write is uncertain no write until a fresh read.
import koffi, { type TypeObject } from "koffi";

export const UIA_TBAR_MAX = 1023;

export type UiaRefusalReason = "refused" | "moved" | "minimised" | "admin" | "unavailable";

/** Nothing was written: OBS is as it was. `moved` says the slider was not where the caller left it (a hand on it). */
export class UiaRefusal extends Error {
  public constructor(message: string, public readonly reason: UiaRefusalReason = "refused") {
    super(message);
  }
}

/** A write may have landed. */
export class UiaUncertain extends Error {}

const MAIN_ID = "OBSApp.OBSBasic";
const SLIDER_ID = "OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll";

const CLSID_CUIAutomation8 = "{E22AD333-B25F-460C-83D0-0581107395C9}";
const IID_IUIAutomation2 = "{34723AFF-0C9D-49D0-9896-7AB52DF8CD8A}";
const IID_IUIAutomationRangeValuePattern = "{59213F4F-7346-49E5-B120-80555987A148}";
const UIA_AutomationIdPropertyId = 30011;
const UIA_RangeValuePatternId = 10003;
const UIA_SliderControlTypeId = 50015;
const ORIENTATION_VERTICAL = 2;
const TreeScope_Descendants = 4;
const CLSCTX_INPROC_SERVER = 1;
const COINIT_MULTITHREADED = 0;
const VT_BSTR = 8;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SYNCHRONIZE = 0x100000;
const WAIT_TIMEOUT = 0x102;
const TCP_TABLE_OWNER_PID_LISTENER = 3;
const AF_INET = 2;
const AF_INET6 = 23;
const ERROR_ACCESS_DENIED = 5;
const ERROR_INSUFFICIENT_BUFFER = 122;
const ERROR_NOT_SUPPORTED = 50;
const E_ACCESSDENIED = 0x80070005 | 0;

// Vtable slots (UIAutomationClient.h): IUnknown 0..2, then each interface's methods in declaration order.
const RELEASE = 2;
const UIA_ELEMENT_FROM_HANDLE = 6;
const UIA_CREATE_PROPERTY_CONDITION = 23;
const UIA2_GET_AUTO_SET_FOCUS = 58;
const UIA2_PUT_AUTO_SET_FOCUS = 59;
const UIA2_PUT_CONNECTION_TIMEOUT = 61;
const UIA2_PUT_TRANSACTION_TIMEOUT = 63;
const EL_FIND_ALL = 6;
const EL_GET_CURRENT_PATTERN_AS = 14;
const EL_PROCESS_ID = 20;
const EL_CONTROL_TYPE = 21;
const EL_IS_ENABLED = 28;
const EL_AUTOMATION_ID = 29;
const EL_CLASS_NAME = 30;
const EL_IS_OFFSCREEN = 38;
const EL_ORIENTATION = 39;
const EL_FRAMEWORK_ID = 40;
const ARR_LENGTH = 3;
const ARR_GET_ELEMENT = 4;
const RV_SET_VALUE = 3;
const RV_VALUE = 4;
const RV_IS_READ_ONLY = 5;
const RV_MAXIMUM = 6;
const RV_MINIMUM = 7;

type Ptr = bigint;

const GUID = koffi.struct("FADESTER_GUID", { a: "uint32", b: "uint16", c: "uint16", d: koffi.array("uint8", 8) });
// VARIANT on 64-bit Windows: vt, three reserved words, then a 16-byte union. Passed by value as the ABI requires.
const VARIANT = koffi.struct("FADESTER_VARIANT", { vt: "uint16", r1: "uint16", r2: "uint16", r3: "uint16", p: "uint64", q: "uint64" });

const P_PTR = koffi.proto("__stdcall", "FadesterComPtr", "int32", ["uint64", "void *"]);
const P_INT = koffi.proto("__stdcall", "FadesterComInt", "int32", ["uint64", "int32"]);
const P_RELEASE = koffi.proto("__stdcall", "FadesterComRelease", "uint32", ["uint64"]);
const P_HANDLE = koffi.proto("__stdcall", "FadesterComHandle", "int32", ["uint64", "uint64", "void *"]);
const P_CONDITION = koffi.proto("__stdcall", "FadesterComCondition", "int32", ["uint64", "int32", VARIANT, "void *"]);
const P_FIND = koffi.proto("__stdcall", "FadesterComFind", "int32", ["uint64", "int32", "uint64", "void *"]);
const P_PATTERN_AS = koffi.proto("__stdcall", "FadesterComPatternAs", "int32", ["uint64", "int32", koffi.pointer(GUID), "void *"]);
const P_INDEX = koffi.proto("__stdcall", "FadesterComIndex", "int32", ["uint64", "int32", "void *"]);
const P_DOUBLE = koffi.proto("__stdcall", "FadesterComDouble", "int32", ["uint64", "double"]);
const P_ENUM_WINDOWS = koffi.proto("__stdcall", "FadesterEnumWindowsProc", "int32", ["uint64", "int64"]);

const ole32 = koffi.load("ole32.dll");
const oleaut32 = koffi.load("oleaut32.dll");
const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const iphlpapi = koffi.load("iphlpapi.dll");

const CoInitializeEx = ole32.func("__stdcall", "CoInitializeEx", "int32", ["void *", "uint32"]);
const CoUninitialize = ole32.func("__stdcall", "CoUninitialize", "void", []);
const CoCreateInstance = ole32.func("__stdcall", "CoCreateInstance", "int32", [koffi.pointer(GUID), "void *", "uint32", koffi.pointer(GUID), "void *"]);
const SysAllocString = oleaut32.func("__stdcall", "SysAllocString", "uint64", ["str16"]);
const SysFreeString = oleaut32.func("__stdcall", "SysFreeString", "void", ["uint64"]);
const SysStringLen = oleaut32.func("__stdcall", "SysStringLen", "uint32", ["uint64"]);
const EnumWindows = user32.func("__stdcall", "EnumWindows", "int32", [koffi.pointer(P_ENUM_WINDOWS), "int64"]);
const GetWindowThreadProcessId = user32.func("__stdcall", "GetWindowThreadProcessId", "uint32", ["uint64", "void *"]);
const IsWindow = user32.func("__stdcall", "IsWindow", "int32", ["uint64"]);
const IsIconic = user32.func("__stdcall", "IsIconic", "int32", ["uint64"]);
const OpenProcess = kernel32.func("__stdcall", "OpenProcess", "uint64", ["uint32", "int32", "uint32"]);
const CloseHandle = kernel32.func("__stdcall", "CloseHandle", "int32", ["uint64"]);
const WaitForSingleObject = kernel32.func("__stdcall", "WaitForSingleObject", "uint32", ["uint64", "uint32"]);
const QueryFullProcessImageNameW = kernel32.func("__stdcall", "QueryFullProcessImageNameW", "int32", ["uint64", "uint32", "void *", "void *"]);
const GetExtendedTcpTable = iphlpapi.func("__stdcall", "GetExtendedTcpTable", "uint32", ["void *", "void *", "int32", "uint32", "uint32", "uint32"]);

function guid(text: string): Record<string, unknown> {
  const hex = text.replace(/[{}-]/g, "");
  const bytes = Array.from({ length: 8 }, (_, i) => parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16));
  return { a: parseInt(hex.slice(0, 8), 16), b: parseInt(hex.slice(8, 12), 16), c: parseInt(hex.slice(12, 16), 16), d: bytes };
}

const failed = (hr: number): boolean => hr < 0;

function toPtr(raw: number | bigint): Ptr {
  return BigInt(raw);
}

/** Reads a pointer-sized value at `address`. */
function at(address: Ptr): Ptr {
  return toPtr(koffi.decode(address, "uint64") as number | bigint);
}

/** The function in vtable slot `slot` of COM object `object`. */
function slotOf(object: Ptr, slot: number): Ptr {
  return at(at(object) + BigInt(slot * 8));
}

function call(object: Ptr, slot: number, proto: TypeObject, ...args: unknown[]): number {
  return koffi.call(slotOf(object, slot), proto, object, ...args) as number;
}

function release(object: Ptr | null | undefined): void {
  if (object && object !== 0n) koffi.call(slotOf(object, RELEASE), P_RELEASE, object);
}

function outPtr(): Buffer {
  return Buffer.alloc(8);
}

function ptrOf(buffer: Buffer): Ptr {
  return buffer.readBigUInt64LE(0);
}

function getInt(object: Ptr, slot: number): number | undefined {
  const out = Buffer.alloc(8);
  return failed(call(object, slot, P_PTR, out)) ? undefined : out.readInt32LE(0);
}

function getDouble(object: Ptr, slot: number): number | undefined {
  const out = Buffer.alloc(8);
  return failed(call(object, slot, P_PTR, out)) ? undefined : out.readDoubleLE(0);
}

/** A BSTR getter, freeing the string on every path. */
function getText(object: Ptr, slot: number): string | undefined {
  const out = outPtr();
  const hr = call(object, slot, P_PTR, out);
  const bstr = ptrOf(out);
  try {
    if (failed(hr) || bstr === 0n) return undefined;
    const length = SysStringLen(bstr) as number;
    return length ? Buffer.from(koffi.view(bstr, length * 2)).toString("utf16le") : "";
  } finally {
    if (bstr !== 0n) SysFreeString(bstr);
  }
}

let comReady = false;

/** Joins this thread to COM's multithreaded apartment, once. */
export function initializeCom(): void {
  if (comReady) return;
  const hr = CoInitializeEx(null, COINIT_MULTITHREADED) as number;
  if (failed(hr)) throw new UiaRefusal(`Windows COM unavailable (0x${(hr >>> 0).toString(16)})`, "unavailable");
  comReady = true;
}

export function uninitializeCom(): void {
  if (comReady) CoUninitialize();
  comReady = false;
}

/** The one local process listening on this TCP port on a loopback or any address (NativeSlider.cpp listenerPid). */
export function listenerPid(port: number): number {
  const owners = new Set<number>();
  for (const family of [AF_INET, AF_INET6]) {
    const size = Buffer.alloc(4);
    let status = GetExtendedTcpTable(null, size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0) as number;
    if (status === ERROR_NOT_SUPPORTED && family === AF_INET6) continue;
    let table = Buffer.alloc(0);
    for (let attempt = 0; attempt < 4 && status === ERROR_INSUFFICIENT_BUFFER; attempt++) {
      table = Buffer.alloc(size.readUInt32LE(0) + 1024); // listeners can appear between the two calls
      size.writeUInt32LE(table.length, 0);
      status = GetExtendedTcpTable(table, size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0) as number;
    }
    if (status !== 0) throw new UiaRefusal("Couldn't read the local OBS listener.");
    const count = table.readUInt32LE(0);
    for (let i = 0; i < count; i++) {
      if (family === AF_INET) {
        const row = 4 + i * 24; // dwState, dwLocalAddr, dwLocalPort, dwRemoteAddr, dwRemotePort, dwOwningPid
        if (table.readUInt16BE(row + 8) !== port) continue;
        const first = table[row + 4];
        const any = table.readUInt32LE(row + 4) === 0;
        if (!any && first !== 127) continue;
        owners.add(table.readUInt32LE(row + 20));
      } else {
        const row = 4 + i * 56; // ucLocalAddr[16], scope, dwLocalPort, ucRemoteAddr[16], scope, port, state, pid
        if (table.readUInt16BE(row + 20) !== port) continue;
        const address = table.subarray(row, row + 16);
        const any = address.every((byte) => byte === 0);
        const loopback = address.subarray(0, 15).every((byte) => byte === 0) && address[15] === 1;
        if (!any && !loopback) continue;
        owners.add(table.readUInt32LE(row + 52));
      }
    }
  }
  if (owners.size !== 1) throw new UiaRefusal("Could not match the WebSocket port to exactly one local OBS process.");
  return [...owners][0]!;
}

/** OBS's T-bar for one OBS process, found through UI Automation on this thread. */
export class UiaSlider {
  private uia: Ptr = 0n;
  private process: Ptr = 0n;
  private mainWindow: Ptr = 0n;
  private slider: Ptr = 0n;
  private range: Ptr = 0n;
  private uncertain = false;

  public constructor(public readonly pid: number) {
    initializeCom();
    this.process = toPtr(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) as number | bigint);
    if (this.process === 0n) {
      const err = koffi.errno();
      throw new UiaRefusal(
        err === ERROR_ACCESS_DENIED ? "OBS is running as administrator." : "target OBS process unavailable",
        err === ERROR_ACCESS_DENIED ? "admin" : "refused"
      );
    }
    const path = Buffer.alloc(32768 * 2);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(32768, 0);
    if (!QueryFullProcessImageNameW(this.process, 0, path, length)) {
      this.dispose();
      throw new UiaRefusal("target OBS process unavailable");
    }
    const image = path.subarray(0, length.readUInt32LE(0) * 2).toString("utf16le");
    if (image.split(/[\\/]/).pop()?.toLowerCase() !== "obs64.exe") {
      this.dispose();
      throw new UiaRefusal("target is not the OBS process");
    }
    const out = outPtr();
    const hr = CoCreateInstance(guid(CLSID_CUIAutomation8), null, CLSCTX_INPROC_SERVER, guid(IID_IUIAutomation2), out) as number;
    const created = ptrOf(out);
    if (failed(hr) || created === 0n) {
      this.dispose();
      throw new UiaRefusal("Windows UI Automation 2 unavailable", "unavailable");
    }
    this.uia = created;
    // UIA normally focuses a control before each write: that can stall for two seconds on an unfocused desktop and is
    // wrong for a live production.
    if (failed(call(this.uia, UIA2_PUT_AUTO_SET_FOCUS, P_INT, 0)) || getInt(this.uia, UIA2_GET_AUTO_SET_FOCUS) !== 0) {
      this.dispose();
      throw new UiaRefusal("UI Automation would change focus", "unavailable");
    }
    // Bound UIA's cross-process wait so a hung OBS cannot block this worker thread indefinitely.
    call(this.uia, UIA2_PUT_CONNECTION_TIMEOUT, P_INT, 500);
    call(this.uia, UIA2_PUT_TRANSACTION_TIMEOUT, P_INT, 500);
  }

  /** True when the pinned OBS process has not exited. */
  public get isRunning(): boolean {
    return this.running();
  }

  /** True when the slider found earlier is still held (the next call needs no search). */
  public get located(): boolean {
    return this.range !== 0n;
  }

  /** The slider's position, 0..1023. A successful read is a fresh truth: it ends an uncertain write's lock. */
  public read(): number {
    const value = this.readChecked();
    this.uncertain = false;
    return value;
  }

  /** Moves the slider from `expected` to `desired`, refusing without writing if it is elsewhere. */
  public move(expected: number, desired: number): number {
    if (!Number.isInteger(expected) || !Number.isInteger(desired) || expected < 0 || desired < 0 || expected > UIA_TBAR_MAX || desired > UIA_TBAR_MAX) {
      throw new UiaRefusal("expected two integers 0..1023");
    }
    if (this.uncertain) throw new UiaRefusal("prior write unconfirmed; read first");
    const before = this.readChecked();
    if (before !== expected) throw new UiaRefusal(`T-bar moved; actual ${before}`, "moved");
    if (before === desired) return before;
    try {
      if (failed(call(this.range, RV_SET_VALUE, P_DOUBLE, desired))) throw new Error("native slider setter failed");
      const actual = this.value();
      if (actual !== desired) throw new Error("native slider readback mismatch");
      return actual;
    } catch (error) {
      this.uncertain = true; // a failed write may have taken effect: never replay it
      this.forget();
      throw new UiaUncertain(`write unconfirmed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Drops the slider found earlier (OBS rebuilt its T-bar): the next call searches again. */
  public forget(): void {
    release(this.range);
    release(this.slider);
    this.range = 0n;
    this.slider = 0n;
    this.mainWindow = 0n;
  }

  public dispose(): void {
    this.forget();
    if (this.uia !== 0n) {
      release(this.uia);
      this.uia = 0n;
    }
    if (this.process !== 0n) {
      CloseHandle(this.process);
      this.process = 0n;
    }
  }

  /** locate() + read(), with one fresh search when a slider found earlier was rebuilt (Studio Mode off and on). */
  private readChecked(): number {
    const reused = this.locate();
    try {
      return this.value();
    } catch (error) {
      if (!reused || (error instanceof UiaRefusal && (error.reason === "unavailable" || error.reason === "minimised" || error.reason === "admin"))) {
        throw error;
      }
      this.forget();
      this.locate();
      return this.value();
    }
  }

  private running(): boolean {
    return this.process !== 0n && (WaitForSingleObject(this.process, 0) as number) === WAIT_TIMEOUT;
  }

  private owns(hwnd: Ptr): boolean {
    if (hwnd === 0n || !IsWindow(hwnd)) return false;
    const owner = Buffer.alloc(4);
    return (GetWindowThreadProcessId(hwnd, owner) as number) !== 0 && owner.readUInt32LE(0) === this.pid;
  }

  private collectOwnedWindows(): Ptr[] {
    const owned: Ptr[] = [];
    EnumWindows((rawHwnd: number | bigint) => {
      const hwnd = toPtr(rawHwnd);
      if (this.owns(hwnd)) owned.push(hwnd);
      return 1;
    }, 0);
    return owned;
  }

  /** Returns true when the slider found earlier was kept rather than looked up again. */
  private locate(): boolean {
    if (!this.running()) throw new UiaRefusal("OBS process exited");
    if (this.range !== 0n && this.owns(this.mainWindow)) {
      if (IsIconic(this.mainWindow)) throw new UiaRefusal("OBS is minimised", "minimised");
      return true;
    }
    this.forget();
    let root: Ptr = 0n;
    let rootWindow: Ptr = 0n;
    let denied = false;
    try {
      for (const window of this.collectOwnedWindows()) {
        const out = outPtr();
        const hr = call(this.uia, UIA_ELEMENT_FROM_HANDLE, P_HANDLE, window, out);
        if (hr === E_ACCESSDENIED) denied = true;
        const candidate = failed(hr) ? 0n : ptrOf(out);
        if (candidate === 0n) continue;
        const matches = getInt(candidate, EL_PROCESS_ID) === this.pid &&
          getText(candidate, EL_CLASS_NAME) === "OBSBasic" &&
          getText(candidate, EL_AUTOMATION_ID) === MAIN_ID &&
          getText(candidate, EL_FRAMEWORK_ID) === "Qt";
        if (!matches) {
          release(candidate);
          continue;
        }
        if (root !== 0n) {
          release(candidate);
          throw new UiaRefusal("ambiguous OBS main window");
        }
        root = candidate;
        rootWindow = window;
      }
      if (root === 0n) {
        if (denied) {
          throw new UiaRefusal("OBS runs as administrator: Windows does not let Fadester reach its window.", "admin");
        }
        throw new UiaRefusal("Cannot find the main OBS window. Keep it open on this desktop, with Studio Mode on and the T-bar visible.");
      }
      if (IsIconic(rootWindow)) throw new UiaRefusal("OBS is minimised", "minimised");
      this.findSlider(root);
      this.mainWindow = rootWindow;
      return false;
    } finally {
      release(root);
    }
  }

  private findSlider(root: Ptr): void {
    const id = toPtr(SysAllocString(SLIDER_ID) as number | bigint);
    if (id === 0n) throw new UiaRefusal("out of memory");
    const condition = outPtr();
    let match: Ptr = 0n;
    let found: Ptr = 0n;
    try {
      const hr = call(this.uia, UIA_CREATE_PROPERTY_CONDITION, P_CONDITION, UIA_AutomationIdPropertyId,
        { vt: VT_BSTR, r1: 0, r2: 0, r3: 0, p: id, q: 0n }, condition);
      match = failed(hr) ? 0n : ptrOf(condition);
      if (match === 0n) throw new UiaRefusal("cannot locate the native Studio Mode T-bar");
      const list = outPtr();
      const findHr = call(root, EL_FIND_ALL, P_FIND, TreeScope_Descendants, match, list);
      if (findHr === E_ACCESSDENIED) {
        throw new UiaRefusal("OBS runs as administrator: Windows does not let Fadester reach its window.", "admin");
      }
      found = failed(findHr) ? 0n : ptrOf(list);
      if (found === 0n || getInt(found, ARR_LENGTH) !== 1) {
        throw new UiaRefusal("Cannot find the T-bar in OBS. Keep the main OBS window open, with Studio Mode on and the T-bar visible.");
      }
      const element = outPtr();
      const slider = failed(call(found, ARR_GET_ELEMENT, P_INDEX, 0, element)) ? 0n : ptrOf(element);
      if (slider === 0n) throw new UiaRefusal("native Studio Mode T-bar unavailable");
      this.slider = slider;
      const orientation = getInt(slider, EL_ORIENTATION);
      if (
        getInt(slider, EL_PROCESS_ID) !== this.pid ||
        getInt(slider, EL_CONTROL_TYPE) !== UIA_SliderControlTypeId ||
        getText(slider, EL_AUTOMATION_ID) !== SLIDER_ID ||
        getText(slider, EL_CLASS_NAME) !== "SliderIgnoreScroll" ||
        getText(slider, EL_FRAMEWORK_ID) !== "Qt" ||
        orientation === ORIENTATION_VERTICAL
      ) {
        throw new UiaRefusal("native Studio Mode slider identity mismatch");
      }
      const pattern = outPtr();
      const patternHr = call(slider, EL_GET_CURRENT_PATTERN_AS, P_PATTERN_AS, UIA_RangeValuePatternId, guid(IID_IUIAutomationRangeValuePattern), pattern);
      this.range = failed(patternHr) ? 0n : ptrOf(pattern);
      if (this.range === 0n) throw new UiaRefusal("native T-bar range provider unavailable");
    } catch (error) {
      this.forget();
      throw error;
    } finally {
      release(found);
      release(match);
      SysFreeString(id);
    }
  }

  /** The slider's integer value after the identity-free checks: visible, enabled, writable, range 0..1023. */
  private value(): number {
    if (!this.running() || !this.owns(this.mainWindow)) throw new UiaRefusal("OBS window no longer owned");
    if (IsIconic(this.mainWindow)) throw new UiaRefusal("OBS is minimised", "minimised");
    const offscreen = getInt(this.slider, EL_IS_OFFSCREEN);
    const enabled = getInt(this.slider, EL_IS_ENABLED);
    if (
      offscreen !== 0 ||
      !enabled ||
      getInt(this.range, RV_IS_READ_ONLY) !== 0 ||
      getDouble(this.range, RV_MINIMUM) !== 0 ||
      getDouble(this.range, RV_MAXIMUM) !== UIA_TBAR_MAX
    ) {
      throw new UiaRefusal("native T-bar disabled or range changed");
    }
    const value = getDouble(this.range, RV_VALUE);
    if (value === undefined) throw new UiaRefusal("cannot read native T-bar position");
    if (!(value >= 0 && value <= UIA_TBAR_MAX) || value !== Math.trunc(value)) {
      throw new UiaRefusal("invalid native T-bar position");
    }
    return value;
  }
}
