// SPDX-License-Identifier: GPL-2.0-or-later
// VJster extension settings, kept in chrome.storage.local (docs/vjster/REQUIREMENTS.md R-LNK-1, D-4).

import { DEFAULT_LINK_PORT, LINK_HOST } from "../../src/vjster/shared/protocol.js";

export const PORT_KEY = "vjster.port";
export const ALL_SITES_KEY = "vjster.allSites";
export const PIN_KEY = "vjster.pinnedTab";

/** A port the user may choose: 1024 to 65535. */
export function readPort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : DEFAULT_LINK_PORT;
}

export function linkUrl(port: number): string {
  return `ws://${LINK_HOST}:${port}/`;
}

/** The content scripts registered when the operator allows every site (D-4). */
export const ALL_SITES_SCRIPTS = [
  {
    id: "vjster-main-all",
    matches: ["<all_urls>"],
    excludeMatches: ["*://*.youtube.com/*"],
    js: ["content-main.js"],
    runAt: "document_idle" as const,
    world: "MAIN" as const,
    persistAcrossSessions: true
  },
  {
    id: "vjster-bridge-all",
    matches: ["<all_urls>"],
    excludeMatches: ["*://*.youtube.com/*"],
    js: ["content-bridge.js"],
    runAt: "document_idle" as const,
    world: "ISOLATED" as const,
    persistAcrossSessions: true
  }
];
