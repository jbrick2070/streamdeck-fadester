# Fadester for OBS — ready-made layouts

Start with **Source Desk (Either Mode)** when you use one OBS scene containing many sources. For complete scene changes, choose **Scene Desk (Studio Mode)** or **Scene Desk (Regular Mode)** to match OBS. The separate **Creative Layer Lab (Either Mode)** adds blend and order controls for experimentation.

These are real `.streamDeckProfile` downloads, ready to import as editable profiles. The [complete profile library](profiles/README.md) includes fourteen layouts for Stream Deck +, 15-key Stream Deck, and Stream Deck Mini. Every profile name clearly labels its OBS mode. Opening the current starter for the first time creates its updated named profile; later opens return to that editable profile. Older profiles and their customizations remain available.

## Source Desk + — Either Mode

[Import Source Desk +](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-desk-v3.streamDeckProfile). Source-selection keys and dial share the selected source. This layout leaves source order fixed.

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous source | Next source | Show/hide selected | Free |
| Music down | Music up | Mic down | Mic up |
| **Dial:** Select source | **Dial:** Music | **Dial:** Mic | **Dial:** Aux |

Audio controls start with automatic input roles: Music/Desktop/Audio use the main audio input, Mic uses a microphone, and Aux uses another available input. You can select a specific OBS mixer input in the Stream Deck app at any time; keep both keys of a fade pair on the same input. The free key is ready for a recording, replay, or specialist action from another plugin.

## Half Source Desk + — Either Mode

[Import Half Source Desk +](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-half-v2.streamDeckProfile). It uses four keys and two dials; the other four keys and two dials are genuinely empty.

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous source | Next source | Free | Free |
| Show/hide selected | Audio down | Free | Free |
| **Dial:** Select source | **Dial:** Audio | **Dial:** Free | **Dial:** Free |

Use the audio dial to bring the level back up. Reserve the free half for the proven OBS actions you already rely on.

## Buttons-only Source Desk — Either Mode

The [15-key Source Desk](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-desk-v4.streamDeckProfile) keeps source selection and visibility on the first row, then provides three audio fade pairs for main audio, microphone, and Aux, leaving six keys free. The [half version](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-half-v2.streamDeckProfile) leaves eight of fifteen keys free. The [Mini version](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/mini-source-desk-v2.streamDeckProfile) uses five of six keys for previous/next source, visibility, and one audio fade pair.

Each fade pair has a `0 %` key and a `100 %` key, so every essential audio job works without a dial. The pairs use automatic audio roles immediately after connecting, and each can be changed to a specific mixer input in the Stream Deck app.

## Creative Layer Lab — Either Mode

The [Stream Deck + lab](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-creative-layer-lab-v2.streamDeckProfile) and [15-key buttons-only lab](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-creative-layer-lab-v2.streamDeckProfile) add the advanced controls explicitly.

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous layer | Next layer | Show/hide selected | Normal blend |
| Layer down | Layer up | Previous blend | Next blend |
| **Dial:** Select layer | **Dial:** Blend mode | **Dial:** Layer order | **Dial:** Audio |

The lab's reorder actions have **Allow reordering** enabled. Blend mode is a discrete compositing choice such as Normal, Additive, Screen, or Multiply; it is separate from a scene transition or a smooth fade. Use Normal blend to return the selected layer to its usual compositing mode.

## Scene Desk — Studio Mode

The [Stream Deck + Scene Desk](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-desk-v2.streamDeckProfile) and [15-key Scene Desk](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-desk-v2.streamDeckProfile) use a familiar Studio Mode workflow: browse scenes in Preview with **Previous**, **Next**, or **Random**, then press a separate Cut or Transition key to take Preview live. The Plus profile also has a **Scene 1** shortcut; the 15-key profile provides **Scene 1–4**. These use positions in your existing OBS scene list, so they work immediately after connecting.

## Scene Desk — Regular Mode

The [Stream Deck + Scene Desk — Regular Mode](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-regular-v3.streamDeckProfile) and [15-key Scene Desk — Regular Mode](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-regular-v2.streamDeckProfile) change Program directly when you press **Previous**, **Next**, **Random**, or a chosen scene shortcut. They use OBS's current transition and include audio fade pairs; the Plus profile adds mixer dials. There are no Preview or T-bar controls in these layouts.

The 15-key regular profile also provides **Cut previous** and **Cut next** keys for immediate scene changes. The Plus layout provides **Scene 1–3** shortcuts; the 15-key layout provides **Scene 1–4**.

Scene navigation follows the OBS scene list from top to bottom and updates when that list changes. You can browse ten or more scenes with the same Previous/Next/Random keys; a separate key for every scene is optional. Random avoids the live Program scene when another scene is available. In Studio layouts it also avoids the current Preview scene when another non-live candidate exists. Numbered shortcuts track their list positions; select a named scene in the action inspector if you prefer a shortcut to stay pinned. A numbered shortcut beyond the end of the list has no scene to select.

## Playlister Transport + — Either Mode

[Import Playlister Transport +](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-playlister-transport-v1.streamDeckProfile). Six keys drive one [Playlister](https://github.com/jbrick2070/obs-playlister) source through OBS's own media controls; each key's inspector chooses the source by name, and the key follows it through renames (the binding is the source's UUID).

| Column 1 | Column 2 | Column 3 | Column 4 |
|---|---|---|---|
| Previous | Next | Play / pause | Stop |
| Restart | Status | Free | Free |
| **Dial:** Free | **Dial:** Free | **Dial:** Free | **Dial:** Free |

The keys show what OBS reports: the observed state (Playing, Paused, Stopped, Ended, Empty) with the position and duration while playing or paused, "Play sent" or "Pause sent" while a toggle waits for confirmation, and Busy when four presses are queued. Play / pause decides from a fresh reading of the state, Stop first drops presses not yet sent, and nothing is sent while the source is missing, not a Playlister, or OBS is unreachable. Status only watches.

## VJ Rig — Studio Mode

[Import VJ Rig +](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-vj-rig-v1.streamDeckProfile) or [VJ Rig 15 Keys](com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-vj-rig-v1.streamDeckProfile). Four pages, each in its own accent: **Perform** (brass), **Layers** (teal), **Visuals** (magenta), **Scenes** (violet). Elgato's own Next page key sits bottom left and the red **PANIC** key bottom right on every page; no Cut or Transition key is ever next to Panic. Panic sends [Visual Sidechain](https://github.com/jbrick2070/visual-sidechain)'s own Panic through OBS's hotkeys at once; **Restore** needs a 0.8 s hold. Panic keys then read **PANIC SENT** until a Restore is accepted, and no Visual Sidechain filter is written from the deck meanwhile. Every filter and Playlister control ships unbound: choose the source and its filter (or the Playlister) once in its inspector.

Stream Deck +, one row per page (keys top row / bottom row; dials):

| Page | Keys | Dials |
|---|---|---|
| Perform | Transition, Prev scene, Next scene, Random scene / Next page, Play / pause, Next clip, PANIC | Scene blend (T-bar), Effect mix, Reactivity, Music |
| Layers | Prev layer, Next layer, Show / hide, Normal blend / Next page, Prev blend, Next blend, PANIC | Select layer, Blend mode, Layer A fade, Layer B fade |
| Visuals | Look 1, Look 2, Look 3, Restore / Next page, Still, Full react, PANIC | Mix B, React B, Mix C, React C |
| Scenes | Transition, Scene 1, Scene 2, Scene 3 / Next page, Cut preview, Scene 4, PANIC | Scene blend, Music, Aux, Mic |

15 keys (three rows each): Perform — Prev scene, Next scene, Random scene, Cut preview, Transition / Mix drop, Mix full, React −, React +, Restore / Next page, Prev clip, Play / pause, Next clip, PANIC. Layers — Prev layer, Next layer, Show / hide, Prev blend, Next blend / A fade out, A fade in, B fade out, B fade in, Restore / Next page, Music down, Music up, Normal blend, PANIC. Visuals — Look 1 to Look 5 / Still, Full react, React −, React +, Restore / Next page, Mix −, Mix +, Mix drop, PANIC. Scenes — Scene 1 to Scene 5 / Cut preview, Scene 6, Scene 7, Scene 8, Restore / Next page, Transition, Prev scene, Next scene, PANIC.

The effect dials ride a Visual Sidechain Shader Filter's Effect mix or Reactivity; pressing one drops it while held and returns it on release. Look keys turn a filter on and off. The layer fades ride a **Color Correction** filter's opacity, so add one to each layer source you want to fade. Every write moves at most a tenth of the range at a time and is refused when an Audio Modulator or a fader already drives the setting.

## Mode and setup notes

Source controls automatically follow Preview in Studio Mode and Program in regular mode. You can pin an action to Program or a fixed scene in its inspector. Editing a scene item affects that scene wherever OBS uses it, including both Preview and Program when they share a scene.

Use the Scene Desk version that matches the mode shown in its profile name. Audio and source controls labelled Either Mode work in both. Choose **Open layout** to create or open the current named, editable starter. Updated starters have their own revision, so opening one preserves older profiles and their edits. Presets do not install or switch automatically. See the [library setup guide](profiles/README.md) for import steps and dependencies.

Previous/Next scene navigation wraps at the ends of the scene list. The Scene T-bar's optional automatic queue setting prepares the next Preview scene after a completed transition.
