# Ready-made Fadester layouts

The plugin includes eleven importable layouts for a Stream Deck +, a 15-key Stream Deck, and a Stream Deck Mini. They require Stream Deck 7.1 or later and use Fadester's direct OBS actions. Every profile name includes **Studio Mode**, **Regular Mode**, or **Either Mode**. Each profile is editable and has its own name. The current starter revision opens as an updated profile while older profiles and their customizations remain available.

## Choose a starting layout

For one OBS scene with many sources, start with **Source Desk**. Its source-selection controls share the selected source, so browsing with a dial or key updates the target used by Show/hide. These everyday layouts preserve the existing layer order.

| Profile | OBS mode | Hardware | Keys / dials used | Purpose |
|---|---|---|---|---|
| [Source Desk +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-desk-v3.streamDeckProfile) | **Either** | Stream Deck + | 7 keys / 4 dials | Source browsing, visibility, three mixer inputs, mic/music fade pairs. |
| [Half Source Desk +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-source-half-v2.streamDeckProfile) | **Either** | Stream Deck + | 4 keys / 2 dials | Source browsing, visibility, and one mixer input, with half the deck free. |
| [Source Desk 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-desk-v4.streamDeckProfile) | **Either** | 15-key Stream Deck | 9 keys | Source browsing and three audio fade pairs, with six free keys. |
| [Half Source Desk 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-source-half-v2.streamDeckProfile) | **Either** | 15-key Stream Deck | 7 keys | Source browsing, visibility, and mic/music fade pairs, with eight free keys. |
| [Source Desk Mini](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/mini-source-desk-v2.streamDeckProfile) | **Either** | Stream Deck Mini | 5 keys | Previous/next source, visibility, and an audio fade pair. |
| [Creative Layer Lab +](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-creative-layer-lab-v2.streamDeckProfile) | **Either** | Stream Deck + | 8 keys / 4 dials | Dedicated blend and layer-order experiments, plus source selection and audio. |
| [Creative Layer Lab 15 Keys](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-creative-layer-lab-v2.streamDeckProfile) | **Either** | 15-key Stream Deck | 12 keys | The same creative layer controls through buttons, plus mic/music fade pairs. |
| [Scene Desk + — Studio](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-desk-v2.streamDeckProfile) | **Studio** | Stream Deck + | 8 keys / 3 dials | Previous/next/random Preview scenes, Cut, Transition, Scene 1, and mixer/T-bar dials. |
| [Scene Desk 15 Keys — Studio](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-desk-v2.streamDeckProfile) | **Studio** | 15-key Stream Deck | 13 keys | Previous/next/random Preview scenes, Cut and Transition, Scene 1–4, and audio fade pairs. |
| [Scene Desk + — Regular](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/plus-scene-regular-v3.streamDeckProfile) | **Regular** | Stream Deck + | 8 keys / 3 dials | Transition directly to previous/next/random scenes or Scene 1–3; mixer dials. |
| [Scene Desk 15 Keys — Regular](../com.jbrick2070.fadester-for-obs.sdPlugin/profiles/buttons-scene-regular-v2.streamDeckProfile) | **Regular** | 15-key Stream Deck | 13 keys | Direct and random transitions, previous/next Cut keys, Scene 1–4, and audio fade pairs. |

**Creative Layer Lab** deliberately enables the reorder setting for its layer-up/down controls. Its blend dial/buttons alter an OBS layer's blend mode; that is a creative compositing choice, not a transition between scenes. Keep a Source Desk profile for the everyday fixed-order workflow.

## Import and configure

In any direct Fadester action's inspector, expand **Ready-made layouts**, choose a layout for the connected device, and click **Open layout**. The first open creates the current starter's named, editable profile; later opens return to that profile with your edits. An updated starter has a separate revision, so opening it preserves older profiles and their customizations. The files above also support manual import.

1. Open the `.streamDeckProfile` matching your device. Stream Deck offers to import it as a new profile.
2. Open one Fadester action and connect it to OBS in its shared connection panel.
3. Try the automatic audio controls. Music/Desktop/Audio use the main audio role, Mic uses a microphone role, and Aux uses another available input. You can override any control with a specific OBS mixer input; set both keys of a fade pair to the same input. If a suitable input is unavailable, choose one in the inspector.
4. Try **Previous**, **Next**, and **Random** in any Scene Desk layout immediately; they use your existing OBS scene list without configuring one key per scene. Numbered shortcuts also refer to the top-to-bottom list positions: the Studio Plus layout has Scene 1, the Regular Plus layout has Scene 1–3, and the 15-key layouts have Scene 1–4. Cut/Transition controls are already configured too.
5. Put your preferred existing actions on the empty keys or dials.

Source Desk follows Preview while Studio Mode is on and Program while regular mode is active. The action inspector can pin it to Program or a specific scene. OBS scene-item changes apply to that scene wherever it is used, including Preview and Program if both refer to the same scene.

The **Studio Mode** Scene Desk profiles use Preview and a separate take-live control; their T-bar needs Studio Mode. The **Regular Mode** Scene Desk profiles send the chosen scene directly to Program using the selected transition and contain no Preview or T-bar controls. The audio and source layouts labelled **Either Mode** support both modes.

Scene navigation follows the current top-to-bottom OBS list, including added or reordered scenes, so the same Previous/Next/Random keys work with ten or more scenes. Random avoids the live Program scene when another scene is available. In Studio layouts it also avoids the current Preview scene when another non-live candidate exists. You can pin any shortcut to a specific named scene later. Numbered shortcuts track their list positions; if OBS has fewer scenes, the extra numbered shortcuts have no scene to select.

Previous/Next scene navigation wraps at the ends of the scene list. The Scene T-bar's optional automatic queue setting prepares the next Preview scene after a completed transition.

## Mixing with other plugins

The half-deck profiles leave real empty positions, ready for the OBS actions and other tools you already use. Recording, replay, chat, or a specialist transform action can live beside Fadester. A profile can reference another plugin's actions, but Elgato does not transfer the plugin itself with a profile, so these starter downloads keep external dependencies out of the main setup.

This is compatible layout composition, not copied third-party code. A future hybrid preset should identify each plugin dependency and use its published action settings, with its own setup instructions.

## Rebuilding the files

`layouts.json` is the reviewable source of truth. Run:

```powershell
node --import tsx scripts/build-profiles.ts
```

The builder writes the `.streamDeckProfile` archives into the plugin's `profiles/` folder, plus `catalog.json` and `manifest-entries.json` here. It uses deterministic IDs and archives, rejects invalid positions/action IDs, and does not read or edit installed user profiles. It stores no host, password, device serial number, or global settings.

The profile ZIP contains a root `*.sdProfile/manifest.json` with `Device`, `Name`, `Pages`, and `Version: "3.0"`; each page has `Controllers`, `Icon`, and `Name`, with actions keyed by `column,row`. Device model values come from the default profiles shipped with the locally installed Stream Deck app.

## Distribution references

Elgato's [Profiles SDK guide](https://docs.elgato.com/streamdeck/sdk/guides/profiles/) documents bundling exported profiles in the plugin and registering them in the manifest. The [manifest profile reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/#profile) defines the device type, editability, and install behavior. The generated manifest entries use `AutoInstall: false` and `DontAutoSwitchWhenInstalled: true` so the user chooses when to install or activate a preset. Elgato's [profile guidance](https://docs.elgato.com/stream-deck/profiles/getting-started/) explains that other plugins used by a profile must be installed separately.
