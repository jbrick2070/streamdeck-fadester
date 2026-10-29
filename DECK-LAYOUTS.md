# Fadester for OBS — ready-made layouts

Start with **Source Desk (Either Mode)** when you use one OBS scene containing many sources. For complete scene changes, choose **Scene Desk (Studio Mode)** or **Scene Desk (Regular Mode)** to match OBS. The separate **Creative Layer Lab (Either Mode)** adds blend and order controls for experimentation.

These are real `.streamDeckProfile` downloads, ready to import as editable profiles. The [complete profile library](profiles/README.md) includes eleven layouts for Stream Deck +, 15-key Stream Deck, and Stream Deck Mini. Every profile name clearly labels its OBS mode. Opening the current starter for the first time creates its updated named profile; later opens return to that editable profile. Older profiles and their customizations remain available.

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

## Mode and setup notes

Source controls automatically follow Preview in Studio Mode and Program in regular mode. You can pin an action to Program or a fixed scene in its inspector. Editing a scene item affects that scene wherever OBS uses it, including both Preview and Program when they share a scene.

Use the Scene Desk version that matches the mode shown in its profile name. Audio and source controls labelled Either Mode work in both. Choose **Open layout** to create or open the current named, editable starter. Updated starters have their own revision, so opening one preserves older profiles and their edits. Presets do not install or switch automatically. See the [library setup guide](profiles/README.md) for import steps and dependencies.

Previous/Next scene navigation wraps at the ends of the scene list. The Scene T-bar's optional automatic queue setting prepares the next Preview scene after a completed transition.
