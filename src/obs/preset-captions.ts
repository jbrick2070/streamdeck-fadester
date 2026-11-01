// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The English captions the bundled profiles store as `labelOverride`
 * (profiles/layouts.json, baked by scripts/build-profiles.ts), plus the older
 * spellings still found on decks. They stay English as data and are compared
 * only, in their own context: a stored caption equal to one of them is a
 * generated default, so the deck draws the translated role (or the live OBS
 * name) instead; any other caption is drawn as typed (R-I18N-2).
 *
 * The inspectors use the same table through the generated ui/preset-captions.js
 * (scripts/generate-ui-i18n.ts; a test keeps it current).
 */

export type CaptionAction = "scene" | "fader" | "fade" | "layerKey" | "layerDial" | "playlister";

/** Captions per action and context, lower case; `shipped` are the ones in profiles/layouts.json. */
export const PRESET_CAPTIONS: Readonly<Record<CaptionAction, Readonly<Record<string, {
  readonly shipped: readonly string[];
  readonly legacy: readonly string[];
}>>>> = {
  scene: {
    __next_scene__: { shipped: ["Next scene", "Cut next"], legacy: [] },
    __previous_scene__: { shipped: ["Prev scene", "Cut previous"], legacy: [] },
    __current_preview__: { shipped: ["Cut preview", "Transition"], legacy: [] },
    __random_scene__: { shipped: ["Random scene"], legacy: ["Random"] },
    __scene_index_0__: { shipped: ["Scene 1"], legacy: ["Scene A", "Scene1", "SceneA"] },
    __scene_index_1__: { shipped: ["Scene 2"], legacy: ["Scene B", "Scene2", "SceneB"] },
    __scene_index_2__: { shipped: ["Scene 3"], legacy: ["Scene C", "Scene3", "SceneC"] },
    __scene_index_3__: { shipped: ["Scene 4"], legacy: ["Scene D", "Scene4", "SceneD"] }
  },
  fader: {
    tbar: { shipped: ["Scene blend"], legacy: ["Scene transition"] },
    automaticInput: {
      shipped: ["Music", "Mic", "Aux", "Audio"],
      legacy: ["Desktop", "Music down", "Music up", "Mic down", "Mic up", "Aux down", "Aux up",
        "Audio down", "Audio up", "Desktop down", "Desktop up"]
    }
  },
  fade: {
    automaticInput: {
      shipped: ["Music down", "Music up", "Mic down", "Mic up", "Aux down", "Aux up", "Audio down", "Audio up"],
      legacy: ["Music", "Mic", "Aux", "Audio", "Desktop", "Desktop down", "Desktop up"]
    }
  },
  layerKey: {
    select_previous: { shipped: ["Prev source", "Prev layer"], legacy: [] },
    select_next: { shipped: ["Next source", "Next layer"], legacy: [] },
    show_hide: { shipped: ["Show / hide"], legacy: [] },
    move_up: { shipped: ["Layer up"], legacy: [] },
    move_down: { shipped: ["Layer down"], legacy: [] },
    blend_next: { shipped: ["Next blend"], legacy: [] },
    blend_previous: { shipped: ["Prev blend"], legacy: [] },
    blend_normal: { shipped: ["Normal blend"], legacy: [] }
  },
  layerDial: {
    select_layer: { shipped: ["Select source", "Select layer"], legacy: [] },
    blend: { shipped: ["Blend mode"], legacy: [] },
    order: { shipped: ["Layer order"], legacy: [] }
  },
  // The Playlister starter stores these; the key draws the translated operation word.
  playlister: {
    previous: { shipped: ["Previous"], legacy: [] },
    next: { shipped: ["Next"], legacy: [] },
    playpause: { shipped: ["Play / pause"], legacy: [] },
    stop: { shipped: ["Stop"], legacy: [] },
    restart: { shipped: ["Restart"], legacy: [] },
    status: { shipped: ["Status"], legacy: [] }
  }
};

const AUTOMATIC_INPUT = /^__audio_(main|mic|aux|input_\d+)__$/;

/** The context a caption is compared in, from the action's settings. */
export function captionContext(action: CaptionAction, settings: Readonly<Record<string, unknown>>): string {
  const text = (key: string): string => typeof settings[key] === "string" ? String(settings[key]).trim() : "";
  switch (action) {
    case "scene":
      return text("sceneTarget");
    case "fader":
      if (text("target") === "tbar") return "tbar";
      return AUTOMATIC_INPUT.test(text("inputName")) ? "automaticInput" : "";
    case "fade":
      return AUTOMATIC_INPUT.test(text("inputName")) ? "automaticInput" : "";
    case "layerKey":
      return text("operation") || "select_next";
    case "layerDial":
      return text("dialMode") || "select_layer";
    case "playlister":
      return text("operation") || "playpause";
  }
}

/** True when the stored caption is a generated default in its context (case and spaces ignored). */
export function isGeneratedCaption(action: CaptionAction, settings: Readonly<Record<string, unknown>>,
  caption = settings.labelOverride): boolean {
  if (typeof caption !== "string") return false;
  const normalized = caption.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return false;
  const entry = PRESET_CAPTIONS[action][captionContext(action, settings)];
  return Boolean(entry) && [...entry.shipped, ...entry.legacy].some((known) => known.toLowerCase() === normalized);
}

/** The caption to draw: empty for a generated default (the control draws its role), else as typed. */
export function customCaption(action: CaptionAction, settings: Readonly<Record<string, unknown>>): string {
  const caption = typeof settings.labelOverride === "string" ? settings.labelOverride.trim() : "";
  return caption && !isGeneratedCaption(action, settings, caption) ? caption : "";
}
