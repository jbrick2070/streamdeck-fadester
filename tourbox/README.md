# Fadester Companion: a game controller or a TourBox for OBS Studio

Fadester Companion lets you mix OBS Studio scenes on Windows with an Xbox or other XInput game controller, a full-size TourBox, or both. The right trigger of the controller, or the flat Dial of the TourBox, drives OBS’s own Studio Mode T-bar.

On a Mac, download `Fadester-Companion-macOS-arm64-<version>.zip` (Apple silicon) or `Fadester-Companion-macOS-x64-<version>.zip` (Intel) from the same release; it works with a TourBox (there is no game controller on the Mac). See [MACOS.md](MACOS.md) for first open and what has been verified.

<a href="https://apps.microsoft.com/detail/9PN7D3P2X7F4?mode=direct"><img src="https://get.microsoft.com/images/en-us%20dark.svg" alt="Get Fadester Companion from Microsoft" width="200"></a>

## First five minutes (game controller)

1. Install **Fadester Companion** from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) and open it from the Start menu. If you use the ZIP, extract all of it into a folder you want to keep and open **Fadester Companion.exe**.
2. In OBS, open **Tools → WebSocket Server Settings**, turn on **Enable WebSocket server**, keep **Enable Authentication** on, and click **OK**. The companion connects by itself with the password OBS saved on this PC, and the **OBS** light at the top turns green. If it is amber, click the button beside it: **Show me** plays a short animation of the clicks in OBS, and **Turn on** switches Studio Mode on for you.
3. On the **Setup** tab, under **2 Choose your controller**, tick **Use an Xbox or XInput game controller** and keep **Easy mode** ticked. Skip the TourBox part below it.
4. The controls start by themselves the first time, without the controller: click **Stop** and then **Start**, at the bottom left of the window (or **Use it** beside the **Controller** light at the top), so they start again with it. The lights at the top turn green: *Controller: connected* and *Controls: on*. Closing the window does not stop the controls: Fadester Companion stays in the notification area beside the clock; right-click that icon and choose **Quit Fadester Companion** to stop.
5. In OBS 33, turn on **Studio Mode** (or click **Turn on** beside the amber **OBS** light), keep a **Fade** among the scene transitions, and keep the main OBS window open with its T-bar visible.
6. Press D-pad down to put the next scene in Preview.
7. Pull the right trigger: OBS’s T-bar follows. Pull it all the way and Preview goes to Program; let go early and it goes back.

Every control, Easy mode and the safety rules are in the [game controller guide](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/gamepad/README.md).

The window, the native preset labels and the quick guides are available in 13 languages: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese. The window follows the Windows display language. To choose a language explicitly, pass `--language` and the locale code to **Fadester Companion.exe**, for example `--language fr`. The window is dark when Windows is set to dark app mode (Settings → Personalization → Colors) and light otherwise; `--theme dark` or `--theme light` chooses one by hand. The **Quick guide** button opens the matching offline guide (**START-HERE.html** in English, with an illustrated control layout, a first-minute rehearsal, the complete preset reference and recovery steps). The full operator reference and most messages in the **Activity** tab are in English; the window shows the OBS connection problems in your language.

## Connect a TourBox

With a full-size TourBox, the Scroll wheel selects the next scene in Preview, the flat Dial drives the T-bar, and the raised Knob rides the speed of the YouTube video in Chrome. Music is on Side + Dial. Press **Tour** for media, overlays, transition settings and capture tools.

1. Open Fadester Companion (step 1 above).
2. Open OBS. In TourBox Console, use **Import** beside **Preset List** to add **OBS Fadester for TourBox.tb**. The **Import into TourBox Console** button in Fadester Companion copies the matching language’s preset path and opens Console; paste it into Console’s import window. Do not double-click the `.tb` file, because Windows has no app for it. Import one language only. Turn **Auto Switch** off and select **OBS Fadester for TourBox**, so it works whichever application is in front (or keep Auto Switch on and link the preset to OBS). To change languages or update, select this existing preset and use its own menu’s **Import** to replace its contents.
3. In OBS, enable **Tools → WebSocket Server Settings** with authentication. Use **Studio Mode** (the **OBS** light has a **Turn on** button when it is off), keep a **Fade** among OBS's scene transitions (it need not be the selected one), and keep the main OBS window and its white T-bar visible. The manual fader targets OBS Studio **33.x**.
4. Fadester Companion reads OBS's port and password from the settings OBS saved on this PC, so both fields fill themselves in. Type a port only to use another OBS (a portable copy, or a second one); a typed port is kept, and while VJster is on it cannot be the same as the VJster port. Type a password only if the connection fails; it is not saved.
5. Select **OBS Fadester for TourBox** in Console. The controls start by themselves; if the **Controls** light at the top says *off*, click **Start** beside it. The **TourBox** light is green only when Console holds the preset: amber *preset not imported* has an **Import** button. (With Auto Switch on, bring OBS to the front.)

### Chrome videos without OBS

VJster's controls (the Knob's speed, play and pause) work on a video in Chrome whether or not OBS is open. Fadester Companion starts its controls by itself, on the first launch too, OBS or not, unless you pressed **Stop** last time. While OBS is closed the Controls light reads **Controls: on, waiting for OBS**; the OBS controls start as soon as OBS answers.

**Turn Auto Switch off** in TourBox Console and select **OBS Fadester for TourBox**: one preset then serves every application in front, so the T-bar, scenes and the Knob's video speed work with OBS, Chrome or anything else in front. With Auto Switch on, Console picks a preset by the application in front and the TourBox does nothing while an application without a linked preset is in front; link the preset to OBS (and, to control videos with Chrome in front, link it to Google Chrome too). The yellow “bring OBS to the front” strip appears only when Auto Switch is on.

### Updating the preset

A new Fadester Companion can ship a new preset (for example, older presets put the whole mix level on the Knob; now it rides the video speed). Fadester Companion compares the presets TourBox Console has stored with its own: if one is older, the TourBox light turns amber and reads **TourBox: old preset**. Click **Import new preset** and import it into the **OBS Fadester for TourBox** preset with that preset's own menu **Import**, which keeps any link you gave it. The light turns green again once Console holds no older copy.

## Rehearse the first throw

Start with two scenes that look distinctly different. Turn **Scroll** until the second one appears in Preview. Program should keep showing the first shot. Tap Scroll to read both scene names in the **Activity** tab.

Turn the **flat Dial** clockwise in small steps. Observe the white slider and the picture on Program. Stop partway to hold a blend. Reverse to the start, or hold **Side** and press **Dial** to cancel. Try again and finish the throw. The preview shot goes live once, and OBS parks its native handle at the starting end. Turn the Dial clockwise again for the next throw: clockwise always moves the T-bar towards Preview. After a throw finishes, pause a moment before turning again: clicks right after a finished throw are ignored as overshoot.

From rest, **Tall** sends Preview to Program using the selected transition. **Top** cuts directly to Preview. During a partial manual mix, either button finishes the current throw. To select a fresh shot, first finish or cancel the mix, then turn Scroll.

## Learn the surface

**Fade the whole mix.** Under Setup, enable **All OBS mixer inputs**, then click **Stop** and **Start**. Hold **Side** and turn the **raised Knob** to lower or raise the group; the Tour menu reads its level. Press **Tour** and choose **Fade whole mix to silence** or **Restore whole mix** for a timed fade. The default is 600 ms and each turn steps 3 dB. Music duck/restore and the Content control remain available separately.

The group scales each public, non-composite OBS audio input in this scene collection from its own starting volume. New eligible inputs join while it is active. Muted inputs stay muted. Editing a source’s level by hand releases that input from the current group until the next fade cycle. **Restore mix** (**Restore whole mix** in the Tour menu) brings the untouched faders back to their original levels. Stopping Fadester Companion does not raise the sound: restart with the same config and select **Restore whole mix**. This controls the input faders feeding every track and monitor, not a separate post-processing or stream-only master. A newly created source can be heard briefly before it is discovered; use OBS mute when adding a source that must enter silently.

Stream Deck, OpenDeck and MIDI users can tick **Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)** in Setup and start Fadester Companion without TourBox hardware or global shortcuts. In this mode the game controller and VJster are off too. Use a compatible **Fadester for OBS** build with the **All OBS mixer inputs** target. All controllers share one gain setting through the authenticated local OBS connection.

| Control | Action |
| --- | --- |
| Raised Knob | Turn to change the video’s speed (needs the VJster extension). Tap to play or pause the video. Press and turn for 0.05 steps. |
| Flat Dial | Turn for a manual blend. Tap to read the current fade. Press and turn for quarter steps. |
| Scroll wheel | Turn to select Preview. Tap for Program and Preview names. Press and turn for the video’s quality. |
| D-pad | Put assigned scenes in Preview. Up, Right, Down and Left correspond to anchors 1–4; an anchor nobody chose uses the scene at that place in OBS's scene list (anchor 1 = the first scene). |
| C1 / C2 | Duck music / restore the saved bed level. |
| Tall / Short | Preview to Program / read recording status (read-only). |
| Top | Cut Preview live. |
| Side | Video speed back to 1x. |
| Tour / Side + Tour | Open the same menu of readouts, transitions, media, overlay and capture tools. |

Hold one of the four prime buttons while turning a rotary for these additional controls. Some assignments give an alternate grip for the same task.

| Hold | Raised Knob | Scroll | Flat Dial |
| --- | --- | --- | --- |
| Side | Whole mix level | Previous / next media | Music level |
| Tall | Content level | Previous / next transition | Fine scene blend |
| Short | Fine Music level | Shorter / longer transition | Fine video speed |
| Top | Layer 1 blend mode | Layer 2 blend mode | Layer 2 opacity |

**Side, Tall, Short and Top** use Console’s **UP** mode. Their single-button actions happen on release. Hold the modifier first, operate the second control, then release. The expanded modifier combinations need a physical hold/release rehearsal on the actual device. Follow **REHEARSAL.md** before using them during a show. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

**Side + Dial press** cancels a manual mix, and **Side + Scroll press** sets Preview to the current Program scene. Side + Tall and Side + Short provide the same cancel and sync actions. Hold Side and press D-pad Up to read the video (title, speed, quality), Down to restart media, or Left/Right for previous/next media; Side + Knob press, like a tap on Side, returns the video to 1x. OBS media play/pause is in the Tour menu.

For direct production shortcuts, **Side + Top** saves a screenshot, **Top + Tall** adds a recording chapter, and **Top + Short** saves the running replay buffer. **Tall + Short** reads the audio levels. **Top + D-pad Up / Down** shows or hides the assigned overlay; Top + Left / Right sets Layer 1 / Layer 2 back to the Normal blend mode. With **Top** held, the Knob, Scroll and Dial drive the VJ layers (see below). With whole-mix control enabled, **Side + C1 / C2** fades the mix to silence or restores it. The generated reference lists every assigned combination.

**Tour** and **Side + Tour** open the same menu at the pointer. Scroll through its entries, then press Tall or click the choice to run it. Short dismisses the menu. It provides scene and fade readouts, soundcheck, Preview sync, duck/restore, whole-mix fades, undo of the last audio change, transition selection and duration, media transport, overlay visibility, mic mute, screenshot, recording status, chapters, replay and reconnect. Select **Mute microphone** to mute the assigned mic; unmute it in OBS.

For a compact assignment card, open **General HUD** at the top right of Console. It starts hidden and shows a curated list for this preset. The **Control map** tab and the offline guide contain the full physical assignments and menu choices.

## Drive YouTube and the VJ layers

A plain `https://www.youtube.com/...` Browser Source in OBS cannot be controlled from outside. Instead, either control YouTube in Chrome (add a **Window Capture** of the Chrome window and an **Application Audio Capture** of Chrome for its sound) or use VJster's bundled `/obs` Browser Source page served by the companion (`http://127.0.0.1:<port>/obs?v=<11-character-YouTube-id>#token=<vjsterObsToken>`, enabled when `vjsterObsToken` is set to 32 lowercase hex digits in `config.json`; `vjsterTarget` defaults to `"both"` and accepts `"browser"`, `"obs"` or `"both"`, and both the Windows and Mac Setup tabs offer a **Target** choice plus **Copy OBS Browser Source URL**, which makes the token on first use).

Install the free **VJster** extension in Chrome from the [Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) and play a YouTube video. The extension connects to the companion on your own computer, on the **VJster port** in Setup (48150 unless you change it there and on the extension’s options page); OBS can be closed. Turn the **raised Knob** for the speed, press and turn it for 0.05 steps, tap it to read the video, and tap **Side** (or hold Side and press the Knob) to return to 1x. Press and turn **Scroll** for the quality; **Side + D-pad Up** plays or pauses; **Tour** has quality back to Auto. With several videos playing, the extension picks the active tab of the focused Chrome window, else the one that started last, so pause the others; the TourBox has no pin. In a YouTube playlist the speed carries to the next video, quality returns to Auto, and there is no next or previous.

In **Assignments**, set **Layer 1** and **Layer 2** to two items in your mix scene, each appearing once in it. Layers nobody chose fill themselves in from the live scene the first time a layer control is used (Layer 1 = the topmost visible picture, Layer 2 = the next one down; sound-only and hidden sources are skipped) and are saved to the Assignments tab. Opacity uses a filter on the source, so it also changes that source anywhere else it appears, Program included. Hold **Top** and turn the **Knob** to cycle Layer 1’s blend mode, **Scroll** for Layer 2’s, and the **Dial** to ride Layer 2’s opacity (through a Color Correction filter, added when the source has none). Tour has both blend modes back to Normal. The **Activity** tab reads back the video and each layer after every move.

If the VJster actions of **Fadester for OBS** are on a Stream Deck or OpenDeck page, they hold the port and Activity says so. The **VJster** light at the top then reads *VJster: on your Stream Deck* in grey: the deck controls the video, and nothing is wrong. To control the video from this controller instead, remove them from the deck or choose another port in both places. Fadester Companion tries the port again every 30 seconds.

## Assign your show

Open **Assignments** after reading your sources. Set Music and Content to the audio inputs you want to ride. Choose a mic for mute, a media source or OBS Playlister source for transport (**Side + Scroll** or **Side + D-pad Left / Right** for previous and next, **Side + D-pad Down** to restart, **Tour** to play or pause; there is no speed control for these, and Playlister has not been tested on the hardware yet), and both a scene and an item for overlay visibility. Assign up to four scene shortcuts by name. Empty roles can stay unassigned. **Save** applies assignments, inputs, anchors and steps at once while the controls run; the port, VJster, game controller, mixer mode and fade step still need **Stop** and **Start**.

Under **Adjust the feel**, set the dB step for level rides, the duck ceiling, ticks per full fade, and the transition timing step. The press-and-turn step on the Dial is a quarter of its normal movement; on the Knob it is a 0.05 speed step. **Opacity step** sets how far one Top + Dial detent moves Layer 2. Duck and restore last about 450 ms. Duck leaves music that is already below the ceiling at its current level. A separate mixer move can interrupt a fade and disarm its saved restore. An audio update already sent can still land while two operators move the same fader.

For an interview, use **C1** to duck the bed as the guest comes up, hold **Tall** and turn the **Knob** to trim Content, then press **C2** to restore. For a lower third, press **Tour** and select **Show overlay** or **Hide overlay**. Confirm the target item and the scene it belongs to. Shared media and overlay changes can affect Program.

## Read the desk and recover

- **OBS** shows the actual Program, Preview, slider and mixer. **TourBox Console** identifies the active preset and physical assignments. The **Activity** tab lists action results and refusals. Its Setup scene names are a snapshot from the last scan. The optional last-action strip can appear in a desktop capture.
- **A dial changed the wrong thing.** Confirm that **OBS Fadester for TourBox** is the active preset and release any held modifier. With Auto Switch on, bringing another application forward can select a different preset; turn Auto Switch off to keep this one.
- **The manual fade will not start.** Check the supported OBS version, two different scenes, Studio Mode, a Fade among OBS's scene transitions, and a visible native T-bar. The Dial mixes with that Fade even while Cut is selected. Clear a conflicting transition override on Preview. If someone moved Preview or the slider independently, settle the handle in OBS, verify Program and Preview, then use Side + Dial press to reset.
- **The selected transition changes and you did not change it.** Click **Stop** in Fadester Companion, open a terminal in the package folder and run `FadesterCompanionBridge.exe --trace-transitions`. The controls work as usual, and each change of OBS's selected transition is printed with the time, next to the companion's own requests. A line that says `NOT asked by the companion` is a change something else made: OBS itself, a click in OBS, another plugin, a script or another controller. Started this way, the companion connects with the password OBS has saved on this PC. Type `quit` to stop, then click **Start** in Fadester Companion again.
- **The transition did not change.** Right after a fade or cut OBS ignores a change of transition for about a second. **Previous / next transition** keeps asking for up to three seconds, and **Activity** names the transition OBS really has. After a cut, the companion also puts your transition back by itself if OBS returns to Cut.
- **Stop says the controls are still finishing.** Click **Stop** again (or choose **Quit Fadester Companion** again): if the controls still have not stopped after 3 more seconds, Fadester Companion ends them and says so. Then check the T-bar and the selected transition in OBS.
- **A source or scene was renamed.** Read the current list from OBS, select the role again under Assignments, and click **Save**. Check the selected media source’s transport support. Recording chapters require an active, supported recording; saving a replay requires an active replay buffer.
- **No shortcut responds.** Check Activity for a connection error, another listener or a keyboard shortcut conflict. A shortcut that another app already uses is skipped, and Activity names it; the other controls still work. Stop competing shortcut handlers and restart controls. Tap Scroll to read the two scene names.
- **End the session.** Click **Stop**, or right-click the Fadester Companion icon in the notification area (beside the clock) and choose **Quit Fadester Companion**, to release the Windows shortcuts. Closing the window alone leaves the controls on. To uninstall, remove **OBS Fadester for TourBox** in Console, then uninstall **Fadester Companion** in Windows Settings (Store) or delete the extracted package (ZIP). Optional saved preferences are in `%LOCALAPPDATA%\FadesterTourBox\config.json` (a Microsoft Store install keeps them in its own package folder). If Fadester Companion cannot read that file, it leaves the file as it is, names the folder that holds it and shows **Open settings folder**.
- **Removing it.** The installer's uninstall also removes the **Open when I sign in** entry. If you use the ZIP and delete its folder, untick **Open when I sign in** first; if you forgot, switch **Fadester Companion** off under Windows Settings → Apps → Startup (or Task Manager → Startup apps). Windows skips an entry whose program is gone. Your settings stay in `%LOCALAPPDATA%\FadesterTourBox` either way.

## Package and source

This edition targets Windows x64. The native preset requires TourBox Console and a full-size desktop TourBox with three pushable rotaries, Side, Tour, C1/C2 and a D-pad. The shared mixer companion includes its runtime, runs on the OBS computer and needs neither TourBox Console nor TourBox hardware with **Use only Stream Deck, OpenDeck or MIDI** ticked. See the rehearsal notes for hardware and software checks.

Fadester Companion for Mac (Apple silicon and Intel) ships as its own ZIP in each release; see [MACOS.md](MACOS.md) and [macos/panel/README.md](macos/panel/README.md). This package is for Windows.

The source includes the native preset generator and validator, the controls' engine, the Fadester Companion window, the C++ slider helper, icons and guide generator. Rebuilding on Windows requires an 8.x .NET SDK, Node.js, Python 3, PowerShell, Visual Studio 2022 or later C++ build tools with the Windows SDK and the stock .NET Framework C# compiler. Run `./build.ps1` from the TourBox source folder. Use `-DotNet C:\path\to\dotnet.exe` to select an SDK. The optional transport integration test uses the Node package `ws`. The distribution includes the source license and separate notices for the .NET runtime.

For TourBox Console’s own import and menu instructions, see the [preset manual](https://www.tourboxtech.com/en/manual/how-to-customize-presets/) and [TourMenu guide](https://www.tourboxtech.com/en/manual/tourmenu/).
