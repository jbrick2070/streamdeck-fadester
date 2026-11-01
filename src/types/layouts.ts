// SPDX-License-Identifier: GPL-2.0-or-later
import { t } from "../i18n/strings.js";

/** Stream Deck keeps editable installed copies. Revise only the starter whose
 * structure changed so unchanged layouts retain their bundled identities. */
export const READY_LAYOUT_REVISION = 2;

const READY_LAYOUT_REVISIONS: Readonly<Record<string, number>> = {
  "plus-source-desk": 3,
  "buttons-source-desk": 4,
  "plus-scene-regular": 3
};

export function profileRevisionForSlug(slug: string): number {
  return READY_LAYOUT_REVISIONS[slug] ?? READY_LAYOUT_REVISION;
}

export function profilePathForSlug(slug: string): string {
  return `profiles/${slug}-v${profileRevisionForSlug(slug)}`;
}

/** Titles match the bundled Profiles entries (kept as named, R-I18N-1); the
 * inspector shows them after the translated OBS mode. Only profiles for the
 * active device are offered by the inspector. */
export const READY_LAYOUTS = [
  { slug: "plus-source-desk", title: "Source Desk +", deviceType: 7, obsMode: "either" },
  { slug: "plus-source-half", title: "Half Source Desk +", deviceType: 7, obsMode: "either" },
  { slug: "plus-creative-layer-lab", title: "Creative Layer Lab +", deviceType: 7, obsMode: "either" },
  { slug: "buttons-source-desk", title: "Source Desk · 15 keys", deviceType: 0, obsMode: "either" },
  { slug: "buttons-source-half", title: "Half Source Desk · 15 keys", deviceType: 0, obsMode: "either" },
  { slug: "mini-source-desk", title: "Source Desk Mini · 6 keys", deviceType: 1, obsMode: "either" },
  { slug: "plus-scene-desk", title: "Scene Desk +", deviceType: 7, obsMode: "studio" },
  { slug: "buttons-creative-layer-lab", title: "Creative Layer Lab · 15 keys", deviceType: 0, obsMode: "either" },
  { slug: "buttons-scene-desk", title: "Scene Desk · 15 keys", deviceType: 0, obsMode: "studio" },
  { slug: "plus-scene-regular", title: "Scene Desk +", deviceType: 7, obsMode: "regular" },
  { slug: "buttons-scene-regular", title: "Scene Desk · 15 keys", deviceType: 0, obsMode: "regular" }
] as const;

const LAYOUT_MODE_KEYS = { either: "layoutModeEither", studio: "layoutModeStudio", regular: "layoutModeRegular" } as const;

/** The picker name, e.g. "[Studio Mode] Scene Desk +", in the plugin language. */
export function readyLayoutName(layout: (typeof READY_LAYOUTS)[number]): string {
  return t(LAYOUT_MODE_KEYS[layout.obsMode], { name: layout.title });
}
