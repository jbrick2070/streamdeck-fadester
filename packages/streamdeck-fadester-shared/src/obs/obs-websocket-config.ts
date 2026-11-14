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
 * Reads OBS's local `plugin_config/obs-websocket/config.json` on explicit user request.
 * Refuses non-local hosts before touching disk, and never logs the password.
 */
export function readObsWebsocketConfig(
  options?: ReadObsWebsocketConfigOptions
): ObsWebsocketConfigReadResult {
  const host = options?.host ?? "127.0.0.1";
  const configPath =
    options?.configPath ?? resolveObsWebsocketConfigPath(options);

  if (!isLoopbackObsHost(host)) {
    return { ok: false, reason: "non_local", configPath };
  }

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
      sourceRelPath: OBS_WEBSOCKET_REL_PATH,
      serverPort: result.serverPort,
      serverEnabled: result.serverEnabled,
      authRequired: result.authRequired,
      passwordFound: true
    };
  }
  return {
    ok: false,
    reason: result.reason,
    sourceRelPath: OBS_WEBSOCKET_REL_PATH,
    serverPort: result.serverPort ?? null,
    serverEnabled: result.serverEnabled ?? null,
    authRequired: result.authRequired ?? null,
    passwordFound: false
  };
}
