// SPDX-License-Identifier: GPL-2.0-or-later
// The suite's action ids (docs/SUITE.md). Stream Deck wants every action id of a plugin to start with the plugin's
// own id, so VJster's seven actions are listed in the suite as io.github.jbrick2070.fadester-for-obs.vjster-<kind>; the
// VJster plugin inside it still knows them as com.jbrick2070.vjster.<kind> (as its standalone build does).

export const SUITE_PLUGIN_ID = "io.github.jbrick2070.fadester-for-obs";
export const VJSTER_PLUGIN_ID = "com.jbrick2070.vjster";
/** The key of the global-settings object that holds VJster's own settings in the suite. */
export const VJSTER_NAMESPACE = "vjster";

/** VJster's action kinds, as the last part of its action ids. */
export const VJSTER_KINDS = ["speed", "quality", "speed-preset", "speed-step", "quality-preset", "pin", "transport"] as const;

/** The suite's id for a VJster action kind. */
export const suiteActionId = (kind: string): string => `${SUITE_PLUGIN_ID}.vjster-${kind}`;
/** VJster's own id for an action kind. */
export const vjsterActionId = (kind: string): string => `${VJSTER_PLUGIN_ID}.${kind}`;

/** The suite's id of each VJster action, and the id the VJster plugin knows it by. */
export const VJSTER_ACTIONS: Readonly<Record<string, string>> = Object.fromEntries(VJSTER_KINDS.map((kind) => [suiteActionId(kind), vjsterActionId(kind)]));
