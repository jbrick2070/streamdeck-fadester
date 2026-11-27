// SPDX-License-Identifier: GPL-2.0-or-later
// Audio, scene and fixed-scene layer controls are chosen by the OBS name the settings page shows. The name breaks when
// the input or scene is renamed in OBS; the UUID OBS gives every input and scene does not. So the control also keeps
// the UUID, follows a rename through it, and keeps the name as what is shown and as the fallback (a UUID OBS no longer
// knows, after a scene collection change or on another computer, is found again by its name).

/** An OBS input or scene as the catalog lists it. */
export interface NamedObsEntry {
  readonly name: string;
  readonly uuid: string;
}

/** A name the plugin stands for itself (`__audio_main__`, `__next_scene__`, `__scene_index_0__`), never an OBS name. */
export function isPlaceholderName(name: string): boolean {
  return /^__.+__$/.test(name);
}

/**
 * The binding as it should be saved now, or null when it is right as it is (or the catalog cannot tell yet).
 * - A UUID OBS knows: the name follows it (the input or scene was renamed).
 * - No UUID yet (settings saved before this), or one OBS does not know: the name is looked up and its UUID is kept.
 * Placeholder names and an empty catalog are left alone.
 */
export function followNameBinding(
  entries: readonly NamedObsEntry[],
  name: string,
  uuid: string
): { name: string; uuid: string } | null {
  if (entries.length === 0) return null;
  if (uuid) {
    const byUuid = entries.find((entry) => entry.uuid === uuid);
    if (byUuid) return byUuid.name !== name ? { name: byUuid.name, uuid } : null;
  }
  if (!name || isPlaceholderName(name)) return null;
  const byName = entries.find((entry) => entry.name === name);
  return byName && byName.uuid !== uuid ? { name, uuid: byName.uuid } : null;
}
