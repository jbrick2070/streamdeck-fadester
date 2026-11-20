// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface ObsWebsocketConfigPathOptions {
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  homedir?: string;
}

export interface ReadObsWebsocketConfigOptions extends ObsWebsocketConfigPathOptions {
  /** Configured OBS host; reading local config is refused unless this is loopback. */
  host?: string;
  /** The port wanted: with several config files (Linux), the one saved for this port is read. */
  port?: number;
  /** Optional explicit config path override for fixture tests. */
  configPath?: string;
  /** Optional file reader override for fixture tests. */
  readFile?: (path: string) => string;
}

export type ObsWebsocketConfigErrorReason =
  | "non_local"
  | "missing_file"
  | "invalid_json"
  | "missing_port"
  | "no_password";

export type ObsWebsocketConfigReadResult =
  | {
      ok: true;
      configPath: string;
      serverPort: number;
      serverEnabled: boolean | null;
      authRequired: boolean | null;
      /** Kept in plugin process memory only; never log or send to a browser page. */
      password: string;
    }
  | {
      ok: false;
      reason: ObsWebsocketConfigErrorReason;
      configPath: string;
      serverPort?: number | null;
      serverEnabled?: boolean | null;
      authRequired?: boolean | null;
    };

/** Redacted summary safe to send to a Property Inspector before filling fields. */
export interface ObsWebsocketConfigPreview {
  ok: boolean;
  reason?: ObsWebsocketConfigErrorReason;
  sourceRelPath: string;
  serverPort: number | null;
  serverEnabled: boolean | null;
  authRequired: boolean | null;
  passwordFound: boolean;
}

export const OBS_WEBSOCKET_REL_PATH = "obs-studio/plugin_config/obs-websocket/config.json";

/** The file as a settings page may name it: from OBS's own folder on, with the Flatpak or Snap folder in front, never the user's home. */
export function obsWebsocketConfigRelPath(configPath: string): string {
  const unix = configPath.split("\\").join("/");
  for (const marker of [".var/app/com.obsproject.Studio/config/", "snap/obs-studio/current/.config/"]) {
    if (unix.includes(`/${marker}${OBS_WEBSOCKET_REL_PATH}`)) return marker + OBS_WEBSOCKET_REL_PATH;
  }
  return OBS_WEBSOCKET_REL_PATH;
}

/** True only when `host` names this machine's loopback interface. */
export function isLoopbackObsHost(host: string | undefined): boolean {
  const normalized = (host ?? "").trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

/** Resolves OBS Studio's `plugin_config/obs-websocket/config.json` path on Windows, macOS, and Linux. */
export function resolveObsWebsocketConfigPath(
  options?: ObsWebsocketConfigPathOptions
): string {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const home = options?.homedir ?? homedir();

  if (platform === "win32") {
    const appData =
      typeof env.APPDATA === "string" && env.APPDATA.trim().length > 0
        ? env.APPDATA.trim()
        : win32.join(home, "AppData", "Roaming");
    return win32.join(
      appData,
      "obs-studio",
      "plugin_config",
      "obs-websocket",
      "config.json"
    );
  }

  if (platform === "darwin") {
    return posix.join(
      home,
      "Library",
      "Application Support",
      "obs-studio",
      "plugin_config",
      "obs-websocket",
      "config.json"
    );
  }

  const xdg =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim().length > 0
      ? env.XDG_CONFIG_HOME.trim()
      : posix.join(home, ".config");
  return posix.join(
    xdg,
    "obs-studio",
    "plugin_config",
    "obs-websocket",
    "config.json"
  );
}

/**
 * Every place OBS may keep that file on this computer, the usual one first. On Linux OBS from Flathub and the Snap keep
 * their own configuration folders, so those follow the native one. A portable OBS on Windows keeps its settings beside
 * its own program, which cannot be found from here: its password has to be typed.
 */
export function resolveObsWebsocketConfigPaths(
  options?: ObsWebsocketConfigPathOptions
): string[] {
  const platform = options?.platform ?? process.platform;
  const first = resolveObsWebsocketConfigPath(options);
  if (platform === "win32" || platform === "darwin") return [first];
  const home = options?.homedir ?? homedir();
  const tail = ["obs-studio", "plugin_config", "obs-websocket", "config.json"];
  return [
    first,
    posix.join(home, ".var", "app", "com.obsproject.Studio", "config", ...tail),
    posix.join(home, "snap", "obs-studio", "current", ".config", ...tail)
  ];
}

/**
 * Reads OBS's local `plugin_config/obs-websocket/config.json`.
 * Refuses non-local hosts before touching disk, and never logs the password.
 * With several places to look (Linux), the file whose port is `port` wins, then the first file that can be read.
 */
export function readObsWebsocketConfig(
  options?: ReadObsWebsocketConfigOptions
): ObsWebsocketConfigReadResult {
  const host = options?.host ?? "127.0.0.1";
  const paths = options?.configPath ? [options.configPath] : resolveObsWebsocketConfigPaths(options);
  if (!isLoopbackObsHost(host)) {
    return { ok: false, reason: "non_local", configPath: paths[0] };
  }
  let firstFound: ObsWebsocketConfigReadResult | null = null;
  let first: ObsWebsocketConfigReadResult | null = null;
  for (const configPath of paths) {
    const read = readOneObsWebsocketConfig(configPath, options);
    first ??= read;
    if (!read.ok && read.reason === "missing_file") continue;
    if (options?.port === undefined || read.serverPort === options.port) return read;
    firstFound ??= read;
  }
  return firstFound ?? first!;
}

function readOneObsWebsocketConfig(
  configPath: string,
  options?: ReadObsWebsocketConfigOptions
): ObsWebsocketConfigReadResult {
  const reader = options?.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
  let rawText: string;
  try {
    rawText = reader(configPath);
  } catch {
    return { ok: false, reason: "missing_file", configPath };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, reason: "invalid_json", configPath };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid_json", configPath };
  }

  const obj = parsed as Record<string, unknown>;
  const serverPort =
    typeof obj.server_port === "number" &&
    Number.isInteger(obj.server_port) &&
    obj.server_port >= 1 &&
    obj.server_port <= 65535
      ? obj.server_port
      : null;
  const serverEnabled =
    typeof obj.server_enabled === "boolean" ? obj.server_enabled : null;
  const authRequired =
    typeof obj.auth_required === "boolean" ? obj.auth_required : null;
  const password =
    typeof obj.server_password === "string" ? obj.server_password : "";

  if (serverPort === null) {
    return {
      ok: false,
      reason: "missing_port",
      configPath,
      serverPort: null,
      serverEnabled,
      authRequired
    };
  }

  if (password.length === 0) {
    return {
      ok: false,
      reason: "no_password",
      configPath,
      serverPort,
      serverEnabled,
      authRequired
    };
  }

  return {
    ok: true,
    configPath,
    serverPort,
    serverEnabled,
    authRequired,
    password
  };
}

/** Strips `password` and local user-profile directories so a preview can be shown safely in the UI. */
export function toObsWebsocketConfigPreview(
  result: ObsWebsocketConfigReadResult
): ObsWebsocketConfigPreview {
  if (result.ok) {
    return {
      ok: true,
      sourceRelPath: obsWebsocketConfigRelPath(result.configPath),
      serverPort: result.serverPort,
      serverEnabled: result.serverEnabled,
      authRequired: result.authRequired,
      passwordFound: true
    };
  }
  return {
    ok: false,
    reason: result.reason,
    sourceRelPath: obsWebsocketConfigRelPath(result.configPath),
    serverPort: result.serverPort ?? null,
    serverEnabled: result.serverEnabled ?? null,
    authRequired: result.authRequired ?? null,
    passwordFound: false
  };
}

/**
 * The password OBS saved on this computer for the given host and port, or "" (another host, another port,
 * authentication off, no file). Kept in memory by the caller only; never logged or sent to a page.
 */
export function savedObsPasswordFor(
  host: string,
  port: number,
  options?: Omit<ReadObsWebsocketConfigOptions, "host">
): string {
  const read = readObsWebsocketConfig({ ...options, host, port });
  if (!read.ok || read.serverPort !== port || read.authRequired === false) return "";
  return read.password;
}

/** What OBS's saved settings on this computer say about its WebSocket server. */
export interface SavedObsServer {
  /** OBS's saved port, or null when the file has none. */
  port: number | null;
  /** OBS's "Enable WebSocket server" tick as saved, or null when the file does not say. */
  enabled: boolean | null;
}

/**
 * OBS's own saved port and "Enable WebSocket server" tick for a loopback host, or null (another host, no file, a
 * broken file). The password is not part of the answer.
 */
export function savedObsServerFor(
  host: string,
  options?: Omit<ReadObsWebsocketConfigOptions, "host">
): SavedObsServer | null {
  const read = readObsWebsocketConfig({ ...options, host });
  if (!read.ok && (read.reason === "non_local" || read.reason === "missing_file" || read.reason === "invalid_json")) return null;
  return { port: read.serverPort ?? null, enabled: read.serverEnabled ?? null };
}
