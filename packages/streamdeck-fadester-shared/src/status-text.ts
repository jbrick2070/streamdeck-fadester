// SPDX-License-Identifier: GPL-2.0-or-later
import { ConnectionStatusInfo } from "./types.js";
import { LocalText, Translate, englishShared, ownText, wordText } from "./i18n.js";

/** The full status sentence (inspectors, errors while offline), as a key. */
export function statusSentenceText(status: ConnectionStatusInfo): LocalText {
  switch (status.kind) {
    case "obs_unreachable":
      return ownText("statusUnreachable");
    case "wrong_password":
      return ownText("statusWrongPassword");
    case "missing_plugin":
      return ownText("statusMissingPlugin", { plugin: status.pluginName ?? "" });
    case "version_mismatch":
      return ownText("statusVersionMismatch", {
        plugin: status.pluginName ?? "",
        apiVersion: status.apiVersion ?? "",
        supported: status.supportedApiVersion ?? "",
        surface: status.surfaceName ?? ""
      });
    case "connected":
    default: {
      const obsVersion = status.obsVersion ?? "";
      if (status.fadesterVersion === undefined) {
        return ownText("statusConnectedDirect", { obsVersion });
      }
      const base = { obsVersion, plugin: status.pluginName ?? "", version: status.fadesterVersion };
      return status.buildCommit
        ? ownText("statusConnectedVendorBuild", { ...base, commit: status.buildCommit })
        : ownText("statusConnectedVendor", base);
    }
  }
}

/** The short reason drawn on a key or dial; empty while connected. */
export function statusCellReasonText(status: ConnectionStatusInfo): LocalText | null {
  switch (status.kind) {
    case "obs_unreachable":
      return ownText("statusUnreachableShort");
    case "wrong_password":
      return ownText("statusWrongPasswordShort");
    case "missing_plugin":
      return ownText("statusMissingPlugin", { plugin: status.pluginName ?? "" });
    case "version_mismatch":
      return ownText("statusVersionMismatchShort", { surface: status.surfaceName ?? "" });
    default:
      return null;
  }
}

export function statusSentence(status: ConnectionStatusInfo, t: Translate = englishShared): string {
  return wordText(statusSentenceText(status), t);
}

export function statusCellReason(status: ConnectionStatusInfo, t: Translate = englishShared): string {
  return wordText(statusCellReasonText(status), t);
}

/** What a status change is measured by: the kind and the parameters its two texts use, no more. */
export function statusSignature(status: ConnectionStatusInfo): string {
  return JSON.stringify([status.kind, statusSentenceText(status), statusCellReasonText(status)]);
}
