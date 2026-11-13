# Fadester for OBS: ready-made layouts

Fourteen layouts for the Stream Deck +, the 15-key Stream Deck and the Stream Deck Mini. Every one is an editable profile; the name says which OBS mode it is for.

## Open one

In any Fadester control's settings page, expand **Ready-made layouts**, choose a layout for the deck you have, and press **Open current starter layout**. A Studio Mode layout offers **Enable Studio Mode & open current starter layout** and prepares Preview for you. The second time, the same button returns to your edited copy.

Or double-click a `.streamDeckProfile` file linked below; Stream Deck imports it as a new profile. The [profile library](profiles/README.md) lists every file.

Set up the OBS connection once, on any key (README, *First five minutes*). Every layout uses it.

## Which one

| You want to | Layout | Mode |
|---|---|---|
| Browse scenes in Preview, then take one live with Cut, Transition or the T-bar dial | [Scene Desk](#scene-desk-studio-mode) | Studio |
| Switch scenes directly, no Preview | [Scene Desk, Regular](#scene-desk-regular-mode) | Regular |
| One scene with many sources: show, hide and fade audio | [Source Desk](#source-desk-either-mode) | Either |
| The same with half the deck free for other plugins | [Half Source Desk](#half-source-desk-either-mode) | Either |
| Blend modes and layer order | [Creative Layer Lab](#creative-layer-lab-either-mode) | Either |
| Play, pause and skip a Playlister source | [Playlister Transport +](#playlister-transport--either-mode) | Either |
| A VJ set: scenes, layers, looks and Panic on four pages | [VJ Rig](#vj-rig-studio-mode) | Studio |

**Studio Mode** layouts use Preview and a separate take-live control. **Regular Mode** layouts send the chosen scene straight to Program with OBS's current transition. **Either Mode** layouts work in both.

What every layout already knows:

- **Scenes.** Previous, Next and Random follow your OBS scene list from top to bottom, including scenes you add or reorder, and wrap at the ends. Random avoids the live scene (and, in Studio layouts, the Preview scene). Scene 1, 2, 3... are positions in that list; a number beyond the end does nothing until you add a scene. Pin any key to a named scene in its settings page.
- **Audio.** Music keys and dials pick your main audio input, Mic picks a microphone, Aux picks another input. Choose a specific OBS mixer input in the key's settings page whenever you want; keep both keys of a fade pair on the same input.
- **Sources.** Source controls follow Preview in Studio Mode and the live scene otherwise, and share the selected source. A scene's content is shared, so when Preview and Program show the same scene, layer edits change both.

## Scene Desk (Studio Mode)

[Scene Desk +](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-desk-v3.streamDeckProfile) for the Stream Deck +, [Scene Desk 15 Keys](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-desk-v2.streamDeckProfile) for the 15-key deck.

Browse scenes in Preview with **Previous**, **Next** or **Random**, then press **Cut** or **Transition** to take Preview live. The Plus layout adds a **Scene 1** key and the scene mixer dial (the T-bar: turn from LIVE to NEXT, press to take Next live); the 15-key layout has **Scene 1-4**. Both have audio controls.

The T-bar's optional **Scene loop** queues the next scene after each transition you finish, so one dial walks through all your scenes.

## Scene Desk (Regular Mode)

[Scene Desk +, Regular](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-regular-v3.streamDeckProfile) and [Scene Desk 15 Keys, Regular](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-regular-v2.streamDeckProfile).

**Previous**, **Next**, **Random** and the numbered keys change Program at once with OBS's current transition. The Plus layout has **Scene 1-3** and mixer dials; the 15-key layout has **Scene 1-4** plus **Cut previous** and **Cut next**. No Preview and no T-bar.

## Source Desk (Either Mode)

[Source Desk +](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-desk-v3.streamDeckProfile) for the Stream Deck +. Layer order stays fixed.

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous source | Next source | Show/hide selected | Free |
| Music down | Music up | Mic down | Mic up |
| **Dial:** Select source | **Dial:** Music | **Dial:** Mic | **Dial:** Aux |

The free key is ready for a recording, replay or chat action from another plugin.

Buttons only: [Source Desk 15 Keys](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-desk-v4.streamDeckProfile) has source selection and visibility on the first row, then three audio fade pairs (main audio, microphone, Aux), with six keys free. [Source Desk Mini](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/mini-source-desk-v2.streamDeckProfile) uses five of six keys: previous and next source, show/hide, one audio fade pair.

A fade pair is a **0 %** key and a **100 %** key, so every audio job works without a dial.

## Half Source Desk (Either Mode)

[Half Source Desk +](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-half-v2.streamDeckProfile): four keys and two dials; the other four keys and two dials are empty for the OBS actions you already use.

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous source | Next source | Free | Free |
| Show/hide selected | Audio down | Free | Free |
| **Dial:** Select source | **Dial:** Audio | **Dial:** Free | **Dial:** Free |

Turn the audio dial to bring the level back up. [Half Source Desk 15 Keys](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-half-v2.streamDeckProfile) leaves eight of fifteen keys free.

## Creative Layer Lab (Either Mode)

[Creative Layer Lab +](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-creative-layer-lab-v2.streamDeckProfile) and [Creative Layer Lab 15 Keys](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-creative-layer-lab-v2.streamDeckProfile).

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous layer | Next layer | Show/hide selected | Normal blend |
| Layer down | Layer up | Previous blend | Next blend |
| **Dial:** Select layer | **Dial:** Blend mode | **Dial:** Layer order | **Dial:** Audio |

This is the one layout whose layer keys may reorder your sources (**Allow reordering** is on). Blend mode is a compositing choice (Normal, Additive, Screen, Multiply...), not a transition and not a smooth fade. **Normal blend** puts the selected layer back to normal. Keep a Source Desk for everyday use.

## Playlister Transport + (Either Mode)

[Playlister Transport +](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-playlister-transport-v1.streamDeckProfile). Six keys for one [Playlister](https://github.com/jbrick2070/obs-playlister) source (Playlister 0.5 or later in OBS).

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous | Next | Play / pause | Stop |
| Restart | Status | Free | Free |
| **Dial:** Free | **Dial:** Free | **Dial:** Free | **Dial:** Free |

The keys ship unbound: open each key's settings page once and choose the Playlister source by name. The key keeps following it if you rename it. Each key shows what OBS reports (Playing, Paused, Stopped, Ended, Empty, with the time), *Play sent* or *Pause sent* while a press waits for OBS, and *Busy* when presses are queued. Nothing is sent while the source is missing or OBS is unreachable. Status only watches.

## VJ Rig (Studio Mode)

[VJ Rig +](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-vj-rig-v1.streamDeckProfile) or [VJ Rig 15 Keys](io.github.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-vj-rig-v1.streamDeckProfile). Four pages, each with its own colour: **Perform** (brass), **Layers** (teal), **Visuals** (magenta), **Scenes** (violet). **Next page** sits bottom left and the red **PANIC** key bottom right on every page; no Cut or Transition key is ever next to Panic.

Panic sends [Visual Sidechain](https://github.com/jbrick2070/visual-sidechain)'s own Panic through OBS's hotkeys at once; **Restore** needs a 0.8 s hold. Panic keys then read **PANIC SENT** until a Restore is accepted. Every filter and Playlister control ships unbound: choose the source and its filter (or the Playlister) once in its settings page.

Stream Deck +, one row per page (keys top row / bottom row; dials):

| Page | Keys | Dials |
|---|---|---|
| Perform | Transition, Prev scene, Next scene, Random scene / Next page, Play / pause, Next clip, PANIC | Scene blend (T-bar), Effect mix, Reactivity, Music |
| Layers | Prev layer, Next layer, Show / hide, Normal blend / Next page, Prev blend, Next blend, PANIC | Select layer, Blend mode, Layer A fade, Layer B fade |
| Visuals | Look 1, Look 2, Look 3, Restore / Next page, Still, Full react, PANIC | Mix B, React B, Mix C, React C |
| Scenes | Transition, Scene 1, Scene 2, Scene 3 / Next page, Cut preview, Scene 4, PANIC | Scene blend, Music, Aux, Mic |

15 keys, three rows per page:

| Page | Row 1 | Row 2 | Row 3 |
|---|---|---|---|
| Perform | Prev scene, Next scene, Random scene, Cut preview, Transition | Mix drop, Mix full, React -, React +, Restore | Next page, Prev clip, Play / pause, Next clip, PANIC |
| Layers | Prev layer, Next layer, Show / hide, Prev blend, Next blend | A fade out, A fade in, B fade out, B fade in, Restore | Next page, Music down, Music up, Normal blend, PANIC |
| Visuals | Look 1, Look 2, Look 3, Look 4, Look 5 | Still, Full react, React -, React +, Restore | Next page, Mix -, Mix +, Mix drop, PANIC |
| Scenes | Scene 1, Scene 2, Scene 3, Scene 4, Scene 5 | Cut preview, Scene 6, Scene 7, Scene 8, Restore | Next page, Transition, Prev scene, Next scene, PANIC |

The effect dials ride a Visual Sidechain Shader Filter's Effect mix or Reactivity; press one to drop it while held. Look keys turn a filter on and off. The layer fades ride a **Color Correction** filter's opacity, so add one to each layer source you want to fade. Writes move gently and are refused when an Audio Modulator or a fader already drives the setting.

## Good to know

- Opening a layout creates a named, editable profile. Your edits stay; an updated layout in a later release opens as its own profile and leaves the old one alone.
- Layouts contain no host, port or password. The shared OBS connection lives in the plugin.
- Half layouts leave real empty keys for other plugins. A profile can reference another plugin's actions, but Stream Deck does not carry that plugin with the profile, so install it separately.
