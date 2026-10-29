// SPDX-License-Identifier: GPL-2.0-or-later
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

/** Names match the bundled Profiles entries; only profiles for the active
 * device are offered by the inspector. */
export const READY_LAYOUTS = [
  { slug: "plus-source-desk", name: "[Either Mode] Source Desk +", deviceType: 7, obsMode: "either" },
  { slug: "plus-source-half", name: "[Either Mode] Half Source Desk +", deviceType: 7, obsMode: "either" },
  { slug: "plus-creative-layer-lab", name: "[Either Mode] Creative Layer Lab +", deviceType: 7, obsMode: "either" },
  { slug: "buttons-source-desk", name: "[Either Mode] Source Desk · 15 keys", deviceType: 0, obsMode: "either" },
  { slug: "buttons-source-half", name: "[Either Mode] Half Source Desk · 15 keys", deviceType: 0, obsMode: "either" },
  { slug: "mini-source-desk", name: "[Either Mode] Source Desk Mini · 6 keys", deviceType: 1, obsMode: "either" },
  { slug: "plus-scene-desk", name: "[Studio Mode] Scene Desk +", deviceType: 7, obsMode: "studio" },
  { slug: "buttons-creative-layer-lab", name: "[Either Mode] Creative Layer Lab · 15 keys", deviceType: 0, obsMode: "either" },
  { slug: "buttons-scene-desk", name: "[Studio Mode] Scene Desk · 15 keys", deviceType: 0, obsMode: "studio" },
  { slug: "plus-scene-regular", name: "[Regular Mode] Scene Desk +", deviceType: 7, obsMode: "regular" },
  { slug: "buttons-scene-regular", name: "[Regular Mode] Scene Desk · 15 keys", deviceType: 0, obsMode: "regular" }
] as const;
