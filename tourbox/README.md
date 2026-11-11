# Fadester Companion: a game controller or a TourBox for OBS Studio

Fadester Companion lets you mix OBS Studio scenes on Windows with an Xbox or other XInput game controller, a full-size TourBox, or both. The right trigger of the controller, or the flat Dial of the TourBox, drives OBS’s own Studio Mode T-bar.

<a href="https://apps.microsoft.com/detail/9PN7D3P2X7F4?mode=direct"><img src="https://get.microsoft.com/images/en-us%20dark.svg" alt="Get Fadester Companion from Microsoft" width="200"></a>

## First five minutes (game controller)

1. Install **Fadester Companion** from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) and open it from the Start menu. If you use the ZIP, extract all of it into a folder you want to keep and open **Fadester for TourBox.exe**.
2. In OBS, open **Tools → WebSocket Server Settings**, turn on **Enable WebSocket server**, keep **Enable Authentication** on, and click **OK**. The companion connects by itself with the password OBS saved on this PC, and the **OBS** light at the top turns green. If it is amber, click **Show me** beside it: a short animation shows the clicks in OBS.
3. On the **Setup** tab, under **2 Choose your controller**, tick **Use an Xbox or XInput game controller** and keep **Easy mode** ticked. Skip the TourBox part below it.
4. Click **Save & start controls** (or **Start** beside the **Controls** light). The lights at the top turn green: *Controller: connected* and *Controls: on*. Keep the window open: closing it stops the controls.
5. In OBS 33.0.0 or 33.0.1, turn on **Studio Mode**, select the **Fade** transition, and keep the main OBS window open with its T-bar visible.
6. Press D-pad down to put the next scene in Preview.
7. Pull the right trigger: OBS’s T-bar follows. Pull it all the way and Preview goes to Program; let go early and it goes back.

Every control, Easy mode and the safety rules are in the [game controller guide](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/gamepad/README.md).

The panel, native preset labels and quick guides are available in English, German, Spanish, French, Italian, Japanese, Korean, Russian, Simplified Chinese and Traditional Chinese. The panel follows the Windows display language. To choose a language explicitly, pass `--language` and the locale code to **Fadester for TourBox.exe**, for example `--language fr`. The panel’s **Quick guide** button opens the matching offline guide (**START-HERE.html** in English, with an illustrated control layout, a first-minute rehearsal, the complete preset reference and recovery steps). The full operator reference and most messages in the **Activity** tab are in English; the panel shows the OBS connection problems in your language.

## Connect a TourBox

With a full-size TourBox, the Scroll wheel cues the next scene, the flat Dial drives the T-bar, and the raised Knob rides the speed of the YouTube video in Chrome. Music is on Side + Dial. Press **Tour** for media, overlays, transition settings and capture tools.

1. Open Fadester Companion (step 1 above).
2. Open OBS. In TourBox Console, use **Import** beside **Preset List** to add **OBS Fadester for TourBox.tb**. The panel’s **Import into TourBox Console** button copies the matching language’s preset path and opens Console; paste it into Console’s import window. Do not double-click the `.tb` file, because Windows has no app for it. Import one language only. Enable **Auto Switch** and link **OBS Fadester for TourBox** to the running OBS application. To change languages or update, select this existing preset and use its own menu’s **Import** to replace its contents.
3. In OBS, enable **Tools → WebSocket Server Settings** with authentication. Use **Studio Mode**, select **Fade**, and keep the main OBS window and its white T-bar visible. The manual fader targets OBS Studio **33.0.0 and 33.0.1**.
4. In the Fadester panel, click **Read scenes and inputs from OBS**. If your server uses a different port, set the **OBS port** (OBS usually uses 4455; while VJster is on, the OBS port cannot be the same as the VJster port). Leave **OBS password (optional)** empty: the panel uses the password OBS saved on this PC. Type one only if the connection fails; it is not saved.
5. Select **OBS Fadester for TourBox**, click **Save & start controls**, and bring OBS to the front. Keep the Fadester panel running.

## Rehearse the first throw

Start with two scenes that look distinctly different. Turn **Scroll** until the second one appears in Preview. Program should keep showing the first shot. Tap Scroll to read both scene names in the panel.

Turn the **flat Dial** clockwise in small steps. Observe the white slider and the picture on Program. Stop partway to hold a blend. Reverse to the start, or hold **Side** and press **Dial** to cancel. Try again and finish the throw. The preview shot goes live once, and OBS parks its native handle at the starting end. Turn the Dial the opposite way for the return throw.

From rest, **Tall** takes Preview using the selected transition. **Top** cuts directly to Preview. During a partial manual mix, either button finishes the current throw. To select a fresh shot, first finish or cancel the mix, then turn Scroll.

## Learn the surface

**Fade the whole mix.** Under Setup, enable **All OBS mixer inputs**, then save and start controls. Hold **Side** and turn the **raised Knob** to lower or raise the group; the Tour menu reads its level. Press **Tour** and choose **Fade whole mix to silence** or **Restore whole mix** for a timed fade. The default is 600 ms and each turn steps 3 dB. Music duck/restore and the Content control remain available separately.

The group scales each public, non-composite OBS audio input in this scene collection from its own starting volume. New eligible inputs join while it is active. Muted inputs stay muted. Editing a source’s level by hand releases that input from the current group until the next fade cycle. Restore brings the untouched faders back to their original levels. Stopping the companion does not raise the sound: restart with the same config and select Restore. This controls the input faders feeding every track and monitor, not a separate post-processing or stream-only master. A newly created source can be heard briefly before it is discovered; use OBS mute when adding a source that must enter silently.

Stream Deck, OpenDeck and MIDI users can tick **Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)** in Setup and start the companion without TourBox hardware or global shortcuts. In this mode the game controller and VJster are off too. Use a compatible plugin build with the all-inputs target. All controllers share one gain setting through the authenticated local OBS connection.

| Control | Action |
| --- | --- |
| Raised Knob | Turn to change the YouTube video’s speed (needs the VJster extension). Tap to read the video. Press and turn for 0.05 steps. |
| Flat Dial | Turn for a manual blend. Tap to read the current fade. Press and turn for quarter steps. |
| Scroll wheel | Turn to cue Preview. Tap for Program and Preview names. Press and turn for the video’s quality. |
| D-pad | Cue assigned scenes. Up, Right, Down and Left correspond to anchors 1–4. |
| C1 / C2 | Duck music / restore the saved bed level. |
| Tall / Short | Take Preview / undo the last supported audio adjustment. |
| Top | Cut Preview live. |
| Side | Read recording status. |
| Tour / Side + Tour | Open the same menu of readouts, transitions, media, overlay and capture tools. |

Hold one of the four prime buttons while turning a rotary for these additional controls. Some assignments give an alternate grip for the same task.

| Hold | Raised Knob | Scroll | Flat Dial |
| --- | --- | --- | --- |
| Side | Whole mix level | Previous / next media | Music level |
| Tall | Content level | Previous / next transition | Fine scene blend |
| Short | Fine Music level | Previous / next Preview scene | Fine scene blend |
| Top | Layer 1 blend mode | Layer 2 blend mode | Layer 2 opacity |

**Side, Tall, Short and Top** use Console’s **UP** mode. Their single-button actions happen on release. Hold the modifier first, operate the second control, then release. The expanded modifier combinations need a physical hold/release rehearsal on the actual device. Follow **REHEARSAL.md** before using them during a show. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

**Side + Dial press** cancels a manual mix, and **Side + Scroll press** sets Preview to the current Program scene. Side + Tall and Side + Short provide the same cancel and sync actions. Hold Side and press D-pad Up to play or pause the YouTube video, Down to restart media, or Left/Right for previous/next media; Side + Knob press returns the video to 1x. OBS media play/pause and the transition duration steps are in the Tour menu.

For direct production shortcuts, **Side + Top** saves a screenshot, **Top + Tall** adds a recording chapter, and **Top + Short** saves the running replay buffer. **Tall + Short** reads the audio levels. **Top + D-pad Up / Down** shows or hides the assigned overlay; Top + Left / Right selects the previous or next transition. With **Top** held, the Knob, Scroll and Dial drive the VJ layers (see below). With whole-mix control enabled, **Side + C1 / C2** fades the mix to silence or restores it. The generated reference lists every assigned combination.

**Tour** and **Side + Tour** open the same menu at the pointer. Scroll through its entries, then press Tall or click the choice to run it. Short dismisses the menu. It provides scene and fade readouts, soundcheck, Preview sync, duck/restore, whole-mix fades, transition selection and duration, media transport, overlay visibility, mic mute, screenshot, recording status, chapters, replay and reconnect. Select **Mute microphone** to mute the assigned mic; unmute it in OBS.

For a compact assignment card, open **General HUD** at the top right of Console. It starts hidden and shows a curated list for this preset. The panel’s **Control map** tab and the offline guide contain the full physical assignments and menu choices.

## Drive YouTube and the VJ layers

VJster controls YouTube in Chrome only. A YouTube browser source in OBS cannot be controlled, because nothing outside it can reach the page. To show the video in OBS, add a **Window Capture** of the Chrome window and keep that window open; add an **Application Audio Capture** of Chrome for its sound.

Install the free **VJster** extension in Chrome from the [Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) and play a YouTube video. The extension connects to the companion on your own computer, on the **VJster port** in Setup (48150 unless you change it there and on the extension’s options page); OBS can be closed. Turn the **raised Knob** for the speed, press and turn it for 0.05 steps, tap it to read the video, and hold **Side** and press it to return to 1x. Press and turn **Scroll** for the quality; **Side + D-pad Up** plays or pauses; **Tour** has quality back to Auto. With several videos playing, the extension picks the active tab of the focused Chrome window, else the one that started last, so pause the others; the TourBox has no pin. In a YouTube playlist the speed carries to the next video, quality returns to Auto, and there is no next or previous.

In **Assignments**, set **Layer 1** and **Layer 2** to two items in your mix scene, each appearing once in it. Opacity uses a filter on the source, so it also changes that source anywhere else it appears, Program included. Hold **Top** and turn the **Knob** to cycle Layer 1’s blend mode, **Scroll** for Layer 2’s, and the **Dial** to ride Layer 2’s opacity (through a Color Correction filter, added when the source has none). Tour has both blend modes back to Normal. The **Activity** tab reads back the video and each layer after every move.

If the VJster actions of the Stream Deck or OpenDeck plugin are on a deck page, they hold the port and Activity says so; remove them from the deck or choose another port in both places. The companion tries the port again every 30 seconds.

## Assign your show

Open **Assignments** after reading your sources. Set Music and Content to the audio inputs you want to ride. Choose a mic for mute, a media source or OBS Playlister source for transport (**Side + Scroll** or **Side + D-pad Left / Right** for previous and next, **Side + D-pad Down** to restart, **Tour** to play or pause; there is no speed control for these, and Playlister has not been tested on the hardware yet), and both a scene and an item for overlay visibility. Assign up to four scene shortcuts by name. Empty roles can stay unassigned. Save changes and restart controls to apply them.

Under **Adjust the feel**, set the dB step for level rides, the duck ceiling, ticks per full fade, and the transition timing step. The press-and-turn step on the Dial is a quarter of its normal movement; on the Knob it is a 0.05 speed step. **Opacity step** sets how far one Top + Dial detent moves Layer 2. Duck and restore take about 450 ms. Duck leaves music that is already below the ceiling at its current level. A separate mixer move can interrupt a fade and disarm its saved restore. An audio update already sent can still land while two operators move the same fader.

For an interview, use **C1** to duck the bed as the guest comes up, hold **Tall** and turn the **Knob** to trim Content, then press **C2** to restore. For a lower third, press **Tour** and select **Show overlay** or **Hide overlay**. Confirm the target item and the scene it belongs to. Shared media and overlay changes can affect Program.

## Read the desk and recover

- **OBS** shows the actual Program, Preview, slider and mixer. **TourBox Console** identifies the active preset and physical assignments. The panel’s **Activity** tab lists action results and refusals. Its Setup scene names are a snapshot from the last scan. The optional last-action strip can appear in a desktop capture.
- **A dial changed the wrong thing.** Focus OBS, confirm the active preset and release any held modifier. With Auto Switch enabled, bringing another application forward can select a different preset.
- **The manual fade will not start.** Check the supported OBS version, two different scenes, Studio Mode, a Fade among OBS's scene transitions, and a visible native T-bar. The Dial mixes with that Fade even while Cut is selected. Clear a conflicting transition override on Preview. If someone moved the cue or slider independently, settle the handle in OBS, verify Program and Preview, then use Side + Dial press to reset.
- **The selected transition changes and you did not change it.** Stop controls in the panel, open a terminal in the package folder and run `FadesterTourBoxBridge.exe --trace-transitions`. The controls work as usual, and each change of OBS's selected transition is printed with the time, next to the companion's own requests. A line that says `NOT asked by the companion` is a change something else made: OBS itself, a click in OBS, another plugin, a script or another controller. Started this way, the companion connects with the password OBS has saved on this PC. Type `quit` to stop, then start controls in the panel again.
- **The transition did not change.** Right after a take or cut OBS ignores a change of transition for about a second. **Previous / next transition** keeps asking for up to three seconds, and **Activity** names the transition OBS really has. After a cut, the companion also puts your transition back by itself if OBS returns to Cut.
- **Stop controls says the bridge is still finishing.** Click **Stop controls** again (or close the panel again): if the bridge still has not stopped after 3 more seconds, the panel ends it and says so. Then check the T-bar and the selected transition in OBS.
- **A source or scene was renamed.** Read the current list from OBS, select the role again under Assignments, and restart controls. Check the selected media source’s transport support. Recording chapters require an active, supported recording; saving a replay requires an active replay buffer.
- **No shortcut responds.** Check Activity for a connection error, another listener or a keyboard shortcut conflict. A shortcut that another app already uses is skipped, and Activity names it; the other controls still work. Stop competing shortcut handlers and restart controls. Focus OBS and tap Scroll to read the two scene names.
- **End the session.** Stop controls and close the panel to release the Windows shortcuts. To uninstall, remove **OBS Fadester for TourBox** in Console, then uninstall **Fadester Companion** in Windows Settings (Store) or delete the extracted package (ZIP). Optional saved preferences are in `%LOCALAPPDATA%\FadesterTourBox\config.json` (a Microsoft Store install keeps them in its own package folder). If the panel cannot read that file, it leaves the file as it is, names the folder that holds it and shows **Open settings folder**.

## Package and source

This edition targets Windows x64. The native preset requires TourBox Console and a full-size desktop TourBox with three pushable rotaries, Side, Tour, C1/C2 and a D-pad. The shared mixer companion includes its runtime, runs on the OBS computer and needs neither TourBox Console nor TourBox hardware with **Use only Stream Deck, OpenDeck or MIDI** ticked. See the rehearsal notes for hardware and software checks.

macOS support is in development ([MACOS.md](MACOS.md) describes the experimental pieces and what they still lack); this package is for Windows.

The source includes the native preset generator and validator, bridge, Windows panel, C++ slider helper, icons and guide generator. Rebuilding on Windows requires an 8.x .NET SDK, Node.js, Python 3, PowerShell, Visual Studio 2022 C++ build tools with the Windows SDK and the stock .NET Framework C# compiler. Run `./build.ps1` from the TourBox source folder. Use `-DotNet C:\path\to\dotnet.exe` to select an SDK. The optional transport integration test uses the Node package `ws`. The distribution includes the source license and separate notices for the .NET runtime.

For TourBox Console’s own import and menu instructions, see the [preset manual](https://www.tourboxtech.com/en/manual/how-to-customize-presets/) and [TourMenu guide](https://www.tourboxtech.com/en/manual/tourmenu/).
