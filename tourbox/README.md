# OBS Fadester for TourBox

Use a full-size TourBox to operate OBS Studio on Windows. The Scroll wheel cues the next scene, the flat Dial drives OBS’s native Studio Mode crossfader, and the raised Knob rides the music bed. Press **Tour** for media, overlays, transition settings and capture tools.

Open **START-HERE.html** in the extracted package for an illustrated control layout, a first-minute rehearsal, the complete preset reference and recovery steps. Its control tables are generated from the map shipped with this preset.

The panel, native preset labels and quick starts are available in English, German, Spanish, French, Italian, Japanese, Korean, Russian, Simplified Chinese and Traditional Chinese. The panel follows the Windows display language. To choose a language explicitly, pass `--language` and the locale code to **Fadester for TourBox.exe**, for example `--language fr`. The panel’s **Quick guide** button opens the matching offline guide. The full operator reference and bridge diagnostic messages are in English.

## Connect the desk

1. Extract the whole Windows x64 ZIP into a folder you want to keep. Run **Fadester for TourBox.exe** from that folder.
2. Open OBS. In TourBox Console, use **Import** beside **Preset List** to add **OBS Fadester for TourBox.tb**. The panel’s **Open preset folder** button opens the matching language folder. Import one language only. Enable **Auto Switch** and link **OBS Fadester for TourBox** to the running OBS application. To change languages or update, select this existing preset and use its own menu’s **Import** to replace its contents.
3. In OBS, enable **Tools → WebSocket Server Settings** with authentication. Use **Studio Mode**, select **Fade**, and keep the main OBS window and its white T-bar visible. The manual fader targets OBS Studio **33.0.0 and 33.0.1**.
4. In the Fadester panel, click **Read scenes and inputs from OBS**. If your server uses a different port or the saved password is unavailable, enter the port and password from OBS. A password entered in the panel lasts for that session.
5. Select **OBS Fadester for TourBox**, click **Save & start controls**, and bring OBS to the front. Keep the Fadester panel running.

## Rehearse the first throw

Start with two scenes that look distinctly different. Turn **Scroll** until the second one appears in Preview. Program should keep showing the first shot. Tap Scroll to read both scene names in the panel.

Turn the **flat Dial** clockwise in small steps. Observe the white slider and the picture on Program. Stop partway to hold a blend. Reverse to the start, or hold **Side** and press **Dial** to cancel. Try again and finish the throw. The preview shot goes live once, and OBS parks its native handle at the starting end. Turn the Dial the opposite way for the return throw.

From rest, **Tall** takes Preview using the selected transition. **Top** cuts directly to Preview. During a partial manual mix, either button finishes the current throw. To select a fresh shot, first finish or cancel the mix, then turn Scroll.

## Learn the surface

**Fade the whole mix.** Under Setup, enable **All OBS mixer inputs**, then save and start controls. Hold **Side** and turn the **raised Knob** to lower or raise the group; Side + Knob press reads the level. Press **Tour** and choose **Fade whole mix to silence** or **Restore whole mix** for a timed fade. The default is 600 ms and each turn steps 3 dB. Music duck/restore and the Content control remain available separately.

The group scales each public, non-composite OBS audio input in this scene collection from its own starting volume. New eligible inputs join while it is active. Muted inputs stay muted. Editing a source’s level by hand releases that input from the current group until the next fade cycle. Restore brings the untouched faders back to their original levels. Stopping the companion does not raise the sound: restart with the same config and select Restore. This controls the input faders feeding every track and monitor, not a separate post-processing or stream-only master. A newly created source can be heard briefly before it is discovered; use OBS mute when adding a source that must enter silently.

Stream Deck, OpenDeck and MIDI users can select **Run for Stream Deck, OpenDeck or MIDI only** in Setup and start the companion without TourBox hardware or global shortcuts. Use a compatible plugin build with the all-inputs target. All controllers share one gain setting through the authenticated local OBS connection.

| Control | Action |
| --- | --- |
| Raised Knob | Turn to ride Music. Tap for levels and mute states. Press and turn for quarter steps. |
| Flat Dial | Turn for a manual blend. Tap to read the current fade. Press and turn for quarter steps. |
| Scroll wheel | Turn to cue Preview. Tap for Program and Preview names. Press and turn for previous or next media. |
| D-pad | Cue assigned scenes. Up, Right, Down and Left correspond to anchors 1–4. |
| C1 / C2 | Duck music / restore the saved bed level. |
| Tall / Short | Take Preview / undo the last supported audio adjustment. |
| Top | Cut Preview live. |
| Side | Read recording status. |
| Tour / Side + Tour | Open the same menu of readouts, transitions, media, overlay and capture tools. |

Hold one of the four prime buttons while turning a rotary for these additional controls. Some assignments give an alternate grip for the same task.

| Hold | Raised Knob | Scroll | Flat Dial |
| --- | --- | --- | --- |
| Side | Whole mix level | Previous / next media | Content level |
| Tall | Content level | Previous / next transition | Fine scene blend |
| Short | Fine Music level | Previous / next Preview scene | Fine scene blend |
| Top | Content level | Previous / next media | Shorter / longer transition |

**Side, Tall, Short and Top** use Console’s **UP** mode. Their single-button actions happen on release. Hold the modifier first, operate the second control, then release. The expanded modifier combinations need a physical hold/release rehearsal on the actual device. Follow **REHEARSAL.md** before using them during a show. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

**Side + Dial press** cancels a manual mix, and **Side + Scroll press** sets Preview to the current Program scene. Side + Tall and Side + Short provide the same cancel and sync actions. Hold Side and press D-pad Up for play/pause, Down for restart, or Left/Right for previous/next media.

For direct production shortcuts, **Side + Top** saves a screenshot, **Top + Tall** adds a recording chapter, and **Top + Short** saves the running replay buffer. **Tall + Short** reads the audio levels. **Top + D-pad Up / Down** shows or hides the assigned overlay; Top + Left / Right selects the previous or next transition. With whole-mix control enabled, **Side + C1 / C2** fades the mix to silence or restores it. The generated reference lists every assigned combination.

**Tour** and **Side + Tour** open the same menu at the pointer. Scroll through its entries, then press Tall or click the choice to run it. Short dismisses the menu. It provides scene and fade readouts, soundcheck, Preview sync, duck/restore, whole-mix fades, transition selection and duration, media transport, overlay visibility, mic mute, screenshot, recording status, chapters, replay and reconnect. Select **Mute microphone** to mute the assigned mic; unmute it in OBS.

For a compact assignment card, open **General HUD** at the top right of Console. It starts hidden and shows a curated list for this preset. The panel’s **Control map** tab and the offline guide contain the full physical assignments and menu choices.

## Assign your show

Open **Assignments** after reading your sources. Set Music and Content to the audio inputs you want to ride. Choose a mic for mute, a media source for transport, and both a scene and an item for overlay visibility. Assign up to four scene shortcuts by name. Empty roles can stay unassigned. Save changes and restart controls to apply them.

Under **Adjust the feel**, set the dB step for level rides, the duck ceiling, ticks per full fade, and the transition timing step. The press-and-turn steps on the Knob and Dial are a quarter of their normal movement. Duck and restore take about 450 ms. Duck leaves music that is already below the ceiling at its current level. A separate mixer move can interrupt a fade and disarm its saved restore. An audio update already sent can still land while two operators move the same fader.

For an interview, use **C1** to duck the bed as the guest comes up, hold **Side** and turn the Dial to trim Content, then press **C2** to restore. For a lower third, press **Tour** and select **Show overlay** or **Hide overlay**. Confirm the target item and the scene it belongs to. Shared media and overlay changes can affect Program.

## Read the desk and recover

- **OBS** shows the actual Program, Preview, slider and mixer. **TourBox Console** identifies the active preset and physical assignments. The panel’s **Activity** tab lists action results and refusals. Its Setup scene names are a snapshot from the last scan. The optional last-action strip can appear in a desktop capture.
- **A dial changed the wrong thing.** Focus OBS, confirm the active preset and release any held modifier. With Auto Switch enabled, bringing another application forward can select a different preset.
- **The manual fade will not start.** Check the supported OBS version, two different scenes, Studio Mode, Fade, and a visible native T-bar. Clear a conflicting transition override on Preview. If someone moved the cue or slider independently, settle the handle in OBS, verify Program and Preview, then use Side + Dial press to reset.
- **A source or scene was renamed.** Read the current list from OBS, select the role again under Assignments, and restart controls. Check the selected media source’s transport support. Recording chapters require an active, supported recording; saving a replay requires an active replay buffer.
- **No shortcut responds.** Check Activity for a connection error, another listener or a keyboard shortcut conflict. Stop competing shortcut handlers and restart controls. Focus OBS and tap Scroll to read the two scene names.
- **End the session.** Stop controls and close the panel to release the Windows shortcuts. To uninstall, remove **OBS Fadester for TourBox** in Console and delete the extracted package. Optional saved preferences are in `%LOCALAPPDATA%\FadesterTourBox\config.json`.

## Package and source

This edition targets Windows x64. The native preset requires TourBox Console and a full-size desktop TourBox with three pushable rotaries, Side, Tour, C1/C2 and a D-pad. The shared mixer companion includes its runtime, runs on the OBS computer and needs neither TourBox Console nor TourBox hardware in mix-only mode. See the rehearsal notes for hardware and software checks.

macOS support is in development; this package is for Windows.

The source includes the native preset generator and validator, bridge, Windows panel, C++ slider helper, icons and guide generator. Rebuilding on Windows requires an 8.x .NET SDK, Node.js, Python 3, PowerShell, Visual Studio 2022 C++ build tools with the Windows SDK and the stock .NET Framework C# compiler. Run `./build.ps1` from the TourBox source folder. Use `-DotNet C:\path\to\dotnet.exe` to select an SDK. The optional transport integration test uses the Node package `ws`. The distribution includes the source license and separate notices for the .NET runtime.

For TourBox Console’s own import and menu instructions, see the [preset manual](https://www.tourboxtech.com/en/manual/how-to-customize-presets/) and [TourMenu guide](https://www.tourboxtech.com/en/manual/tourmenu/).
