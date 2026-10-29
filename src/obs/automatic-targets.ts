// SPDX-License-Identifier: GPL-2.0-or-later

const MAIN_AUDIO_NAMES = ["music", "desktop audio", "desktop", "system audio"];
const MICROPHONE_NAMES = ["mic/aux", "microphone", "mic"];

/** Keep custom captions, but let shipped role captions follow their real input. */
export function isAutomaticInputPresetLabel(target: string, label: string): boolean {
  return automaticInputLabel(target) !== undefined && /^(music|desktop|audio|mic|aux)( down| up)?$/i.test(label.trim());
}

/** Upgrade only untouched audio placeholders in older bundled layouts, once. */
export function migrateAutomaticInputSettings<T extends {
  inputName?: string;
  labelOverride?: string;
  presetBindingsVersion?: number;
}>(raw: T): T {
  if (raw.presetBindingsVersion === 1) return raw;
  const label = raw.labelOverride?.trim().toLowerCase() ?? "";
  const inputName = /^(music|desktop|audio)( down| up)?$/.test(label) ? "__audio_main__"
    : /^mic( down| up)?$/.test(label) ? "__audio_mic__"
    : /^aux( down| up)?$/.test(label) ? "__audio_input_2__" : undefined;
  if (!inputName) return raw;
  return { ...raw, inputName: raw.inputName?.trim() ? raw.inputName : inputName, presetBindingsVersion: 1 };
}

function indexedAudioTarget(target: string): number | undefined {
  const match = /^__audio_input_(\d+)__$/.exec(target);
  return match ? Number(match[1]) : undefined;
}

/** Resolve a preset role against the current volume-capable OBS inputs. */
export function resolveAutomaticInputName(target: string, names: readonly string[]): string {
  const normalized = names.map((name) => name.toLowerCase());
  const findPreferred = (preferences: readonly string[]): string | undefined => {
    for (const preference of preferences) {
      const index = normalized.indexOf(preference);
      if (index !== -1) return names[index];
    }
    return undefined;
  };

  if (target === "__audio_main__") {
    return findPreferred(MAIN_AUDIO_NAMES)
      ?? names.find((_, index) => /music|desktop/.test(normalized[index]))
      ?? names.find((_, index) => !normalized[index].includes("mic"))
      ?? "";
  }

  if (target === "__audio_mic__") {
    return findPreferred(MICROPHONE_NAMES)
      ?? names.find((_, index) => normalized[index].includes("mic"))
      ?? "";
  }

  if (target === "__audio_aux__") {
    const primary = resolveAutomaticInputName("__audio_main__", names);
    const microphone = resolveAutomaticInputName("__audio_mic__", names);
    return names.find((name) => name !== primary && name !== microphone) ?? "";
  }

  const index = indexedAudioTarget(target);
  if (index !== undefined) return names[index] ?? "";
  return names.includes(target) ? target : "";
}

/** Human-readable label for a preset role; explicit input names keep their own label. */
export function automaticInputLabel(target: string): string | undefined {
  if (target === "__audio_main__") return "Main audio (automatic)";
  if (target === "__audio_mic__") return "Microphone (automatic)";
  if (target === "__audio_aux__") return "Aux audio (automatic)";
  const index = indexedAudioTarget(target);
  return index !== undefined ? `Audio input ${index + 1} (automatic)` : undefined;
}
