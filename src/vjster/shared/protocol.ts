// SPDX-License-Identifier: GPL-2.0-or-later
// VJster: the vocabulary shared by the deck actions, the Chrome extension and
// the Phase 2 page (docs/vjster/REQUIREMENTS.md section 2). Phase 0 pins the
// constants; Phase 1 step 2 adds the message types and `parse`.
// Requirement ids in src/vjster refer to docs/vjster/REQUIREMENTS.md.
//
// This folder imports nothing from Fadester's OBS code, so a standalone VJster
// plugin can be built from the same source later (R-HOME-3).

/** Protocol version carried by every message (R-INT-1). */
export const PROTOCOL_VERSION = 1 as const;

/** Default port of the plugin's loopback link server (R-LNK-1). */
export const DEFAULT_LINK_PORT = 48150;

/** The only address the link server ever binds (R-LNK-1). */
export const LINK_HOST = "127.0.0.1";

/** The targets an intent can address (R-INT-1). The array is the source of the type, so they cannot drift apart. */
export const TARGETS = ["browser", "obs"] as const;

export type Target = (typeof TARGETS)[number];
