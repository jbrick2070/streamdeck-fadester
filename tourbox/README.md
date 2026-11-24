# Fadester Companion: a game controller or a TourBox for OBS Studio

Fadester Companion lets you mix OBS Studio scenes on Windows with an Xbox or other XInput game controller, a full-size TourBox, or both. The right trigger of the controller, or the flat Dial of the TourBox, drives OBS’s own Studio Mode T-bar.

<a href="https://apps.microsoft.com/detail/9PN7D3P2X7F4?mode=direct"><img src="https://get.microsoft.com/images/en-us%20dark.svg" alt="Get Fadester Companion from Microsoft" width="200"></a>

On a Mac: download `Fadester-Companion-macOS-arm64-<version>.zip` (Apple silicon) or `Fadester-Companion-macOS-x64-<version>.zip` (Intel) from the same release. It works with a TourBox (there is no game controller on the Mac). First open and what has been verified: [MACOS.md](MACOS.md).

## Quick start

<img src="companion-steps.svg" alt="Fadester Companion in three steps: 1, install it and open it; 2, in OBS turn on the WebSocket server, and the OBS light in Fadester Companion turns green; 3, put the next scene in Preview and pull the right trigger or turn the TourBox Dial: OBS's T-bar follows." width="900">

1. **Install and open.** Get **Fadester Companion** from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) and open it from the Start menu. (From the ZIP: extract all of it into a folder you keep and open **Fadester Companion.exe**.)
2. **Let it reach OBS.** In OBS, open **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**, keep **Enable Authentication** on and click **OK**. The **OBS** light at the top of Fadester Companion turns green. Amber? Click the button beside it: **Turn on** switches Studio Mode on, **Show me** plays the clicks in OBS.
3. **Pick your controller and throw.** On the **Setup** tab, under **2 Choose your controller**, tick **Use an Xbox or XInput game controller** (keep **Easy mode**), then click **Stop** and **Start** at the bottom left. With a TourBox, follow [Connect a TourBox](#connect-a-tourbox) instead. Press D-pad down (TourBox: turn **Scroll**) to put the next scene in Preview, then pull the right trigger (TourBox: turn the flat **Dial**): OBS’s T-bar follows, and all the way puts Preview on Program.

That's it. Every control, Easy mode and the safety rules: [game controller guide](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/gamepad/README.md).

<a id="first-five-minutes-game-controller"></a>

## Game controller: good to know

- **Why Stop and Start.** The controls start by themselves the first time, before the controller is chosen. **Stop** then **Start** (or **Use it** beside the **Controller** light at the top) starts them again with it. The lights at the top then read *Controller: connected* and *Controls: on*.
- **OBS needs:** OBS 33, **Studio Mode** on, a **Fade** among the scene transitions, and the main OBS window open with its T-bar visible.
- **Let go early** and the T-bar goes back to Program.
- **Closing the window does not stop the controls.** Fadester Companion stays in the notification area beside the clock. To stop, right-click that icon and choose **Quit Fadester Companion**.

## Connect a TourBox

With a full-size TourBox, the Scroll wheel puts the next scene in Preview, the flat Dial drives the T-bar, and the raised Knob rides the speed of the YouTube video in Chrome. Music is on Side + Dial. Press **Tour** for media, overlays, transition settings and capture tools.

1. **Import the preset.** In Fadester Companion click **Import into TourBox Console**: it copies the preset’s path (in your language) and opens TourBox Console. In Console click **Import** beside **Preset List** and paste the path. Import one language only. Do not double-click the `.tb` file: Windows has no app for it.
2. **Select it.** In Console turn **Auto Switch** off and select **OBS Fadester for TourBox**, so it works whichever application is in front. (Or keep Auto Switch on and link the preset to OBS.)
3. **Check the lights.** The controls start by themselves; if the **Controls** light says *off*, click **Start** beside it. The **TourBox** light is green once Console holds the preset; amber *preset not imported* has an **Import** button. (With Auto Switch on, bring OBS to the front.)

OBS needs the same as above: **Tools → WebSocket Server Settings** with authentication, **Studio Mode** (the **OBS** light has **Turn on**), a **Fade** among the scene transitions (it need not be the selected one), and the main window with its white T-bar visible. The manual fader targets OBS Studio **33.x**. To change languages, select the existing preset and use its own menu’s **Import** to replace its contents.

### Chrome videos without OBS

- The Knob’s speed, play and pause work on a video in Chrome whether or not OBS is open. The controls start by themselves at launch, OBS or not, unless you pressed **Stop** last time. While OBS is closed the light reads **Controls: on, waiting for OBS**.
- **Auto Switch off** (recommended): one preset serves every application in front, OBS, Chrome or anything else.
- **Auto Switch on:** Console picks a preset by the application in front, and the TourBox does nothing in front of an application without a linked preset. Link the preset to OBS, and to Google Chrome too to control videos with Chrome in front. The yellow “bring OBS to the front” strip appears only in this case.

### Updating the preset

A new Fadester Companion can ship a new preset (older presets put the whole mix level on the Knob; now it rides the video speed). If Console holds an older copy, the **TourBox** light turns amber: **TourBox: old preset**. Click **Import new preset** and import it into the existing **OBS Fadester for TourBox** preset with that preset’s own menu **Import**, which keeps any link you gave it. The light turns green once Console holds no older copy.

## Rehearse the first throw

1. Use two scenes that look clearly different. Turn **Scroll** until the second one is in Preview; Program still shows the first. Tap Scroll to read both names in the **Activity** tab.
2. Turn the **flat Dial** clockwise in small steps and watch the white slider and Program. Stop partway to hold a blend. Turn back to the start, or hold **Side** and press **Dial**, to cancel.
3. Finish the throw: Preview goes live once and OBS parks its handle at the starting end. Clockwise always moves the T-bar towards Preview. Pause a moment before the next throw: clicks right after a finished throw are ignored as overshoot.

From rest, **Tall** sends Preview to Program with the selected transition and **Top** cuts. During a partial mix, either button finishes the throw. To pick a new scene, first finish or cancel the mix, then turn Scroll.

## Learn the surface

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

Hold one of the four prime buttons while turning a rotary for more controls (some give a second grip for the same task):

| Hold | Raised Knob | Scroll | Flat Dial |
| --- | --- | --- | --- |
| Side | Whole mix level | Previous / next media | Music level |
| Tall | Content level | Previous / next transition | Fine scene blend |
| Short | Fine Music level | Shorter / longer transition | Fine video speed |
| Top | Layer 1 blend mode | Layer 2 blend mode | Layer 2 opacity |

**Holding a button.** Side, Tall, Short and Top use Console’s **UP** mode: their own action happens on release. Hold the modifier first, use the second control, then release. Rehearse these holds on the real device with **REHEARSAL.md** before a show. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

| Combination | Does |
| --- | --- |
| Side + Dial press (or Side + Tall) | Cancel a manual mix |
| Side + Scroll press (or Side + Short) | Set Preview to the current Program scene |
| Side + D-pad Up / Down / Left / Right | Read the video (title, speed, quality) / restart media / previous / next media |
| Side + Knob press | Video back to 1x (like a tap on Side) |
| Side + Top | Save a screenshot |
| Top + Tall / Top + Short | Add a recording chapter / save the running replay buffer |
| Tall + Short | Read the audio levels |
| Top + D-pad Up / Down | Show / hide the assigned overlay |
| Top + D-pad Left / Right | Layer 1 / Layer 2 back to the Normal blend mode |
| Side + C1 / C2 | Fade the whole mix to silence / restore it (whole-mix control on) |

OBS media play/pause is in the Tour menu. The generated reference lists every assigned combination.

**The Tour menu.** **Tour** and **Side + Tour** open the same menu at the pointer. Scroll to an entry, then press **Tall** or click it; **Short** closes the menu. It has scene and fade readouts, soundcheck, Preview sync, duck/restore, whole-mix fades, undo of the last audio change, transition and duration, media transport, overlay visibility, mic mute, screenshot, recording status, chapters, replay and reconnect. **Mute microphone** mutes the assigned mic; unmute it in OBS.

**A compact card.** Open **General HUD** at the top right of Console (it starts hidden) for a short list for this preset. The **Control map** tab and the offline guide have every assignment and menu entry.

### Fade the whole mix

Under **Setup**, tick **All OBS mixer inputs**, then click **Stop** and **Start**. Hold **Side** and turn the **raised Knob** to lower or raise the group (the Tour menu reads its level). For a timed fade, press **Tour** and choose **Fade whole mix to silence** or **Restore whole mix** (600 ms by default; each turn steps 3 dB). Music duck/restore and the Content control stay separate.

- The group scales each public, non-composite OBS audio input in this scene collection from its own starting volume. New eligible inputs join while it is active. Muted inputs stay muted.
- Moving a source’s level by hand releases that input from the group until the next fade cycle. **Restore mix** (**Restore whole mix** in the Tour menu) brings the untouched faders back.
- Stopping Fadester Companion does not raise the sound: restart with the same config and select **Restore whole mix**.
- It moves the input faders feeding every track and monitor, not a separate stream-only master. A new source can be heard briefly before it is found: mute it in OBS when it must enter silently.

**No TourBox?** Stream Deck, OpenDeck and MIDI users can tick **Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)** in Setup and run Fadester Companion without TourBox hardware or global shortcuts (the game controller and VJster are off in this mode). Use a compatible **Fadester for OBS** build with the **All OBS mixer inputs** target. All controllers share one gain setting through the authenticated local OBS connection.

## Drive YouTube and the VJ layers

**The video.** Add the free **VJster** extension to Chrome from the [Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) and play a YouTube video. It connects to Fadester Companion on the **VJster port** in Setup (48150 unless you change it there and on the extension’s options page); OBS can be closed.

| Do | With |
| --- | --- |
| Speed | Turn the **raised Knob**; press and turn for 0.05 steps |
| Read the video | Tap the Knob |
| Back to 1x | Tap **Side** (or hold Side and press the Knob) |
| Quality | Press and turn **Scroll**; **Tour** has quality back to Auto |
| Play / pause | **Side + D-pad Up** |

- With several videos playing, the extension picks the active tab of the focused Chrome window, else the one that started last, so pause the others; the TourBox has no pin.
- In a YouTube playlist the speed carries to the next video, quality returns to Auto, and there is no next or previous.

**Getting the video into OBS.** A plain `https://www.youtube.com/...` Browser Source in OBS cannot be controlled from outside. Either:

- control YouTube in Chrome and add a **Window Capture** of the Chrome window plus an **Application Audio Capture** of Chrome for its sound, or
- use VJster's `/obs` Browser Source page served by the companion. On the **Setup** tab (Windows and Mac) choose a **Target** and click **Copy OBS Browser Source URL**, which makes the page key on first use. By hand: `http://127.0.0.1:<port>/obs?v=<11-character-YouTube-id>#token=<vjsterObsToken>`, with `vjsterObsToken` set to 32 lowercase hex digits in `config.json`; `vjsterTarget` is `"both"` by default and accepts `"browser"`, `"obs"` or `"both"`.

**The VJ layers.** In **Assignments**, set **Layer 1** and **Layer 2** to two items in your mix scene, each appearing once in it.

- Hold **Top** and turn the **Knob** to cycle Layer 1’s blend mode, **Scroll** for Layer 2’s, and the **Dial** to ride Layer 2’s opacity. Tour has both blend modes back to Normal.
- Layers nobody chose fill themselves in the first time a layer control is used (Layer 1 = the topmost visible picture, Layer 2 = the next one down; sound-only and hidden sources are skipped) and are saved to the Assignments tab.
- Opacity uses a Color Correction filter on the source (added when it has none), so it changes that source everywhere it appears, Program included.
- The **Activity** tab reads back the video and each layer after every move.

**VJster: on your Stream Deck.** If the VJster actions of **Fadester for OBS** are on a Stream Deck or OpenDeck page, they hold the port. The **VJster** light then reads *VJster: on your Stream Deck* in grey: the deck controls the video, and nothing is wrong. To control it from this controller instead, remove them from the deck or choose another port in both places. Fadester Companion tries the port again every 30 seconds.

## Assign your show

Open **Assignments** after reading your sources:

- **Music** and **Content:** the audio inputs you want to ride.
- **Mic:** for mute.
- **Media:** a media source or OBS Playlister source for transport (**Side + Scroll** or **Side + D-pad Left / Right** for previous and next, **Side + D-pad Down** to restart, **Tour** to play or pause). There is no speed control for these, and Playlister has not been tested on the hardware yet.
- **Overlay:** both a scene and an item.
- **Scene shortcuts:** up to four, by name.

Empty roles can stay unassigned. **Save** applies assignments, inputs, anchors and steps at once while the controls run; the port, VJster, game controller, mixer mode and fade step still need **Stop** and **Start**.

**Adjust the feel** sets the dB step for level rides, the duck ceiling, ticks per full fade, the transition timing step and the **Opacity step** (one Top + Dial detent on Layer 2). Press and turn moves the Dial a quarter of its normal step and the Knob 0.05 speed. Duck and restore last about 450 ms; duck leaves music already below the ceiling where it is. A separate mixer move can interrupt a fade and disarm its saved restore, and an audio update already sent can still land while two operators move the same fader.

**Examples.** Interview: **C1** ducks the bed as the guest comes up, hold **Tall** and turn the **Knob** to trim Content, **C2** restores. Lower third: **Tour**, then **Show overlay** or **Hide overlay**; check the target item and its scene. Shared media and overlay changes can affect Program.

## Read the desk and recover

**Where to look.** **OBS** shows the real Program, Preview, slider and mixer. **TourBox Console** shows the active preset and assignments. The **Activity** tab lists results and refusals (its Setup scene names are a snapshot from the last scan). The optional last-action strip can appear in a desktop capture.

| What happens | What to do |
| --- | --- |
| A dial changed the wrong thing | Check that **OBS Fadester for TourBox** is the active preset and release any held modifier. With Auto Switch on, another application in front can select another preset; turn Auto Switch off. |
| The manual fade will not start | Check the OBS version, two different scenes, Studio Mode, a Fade among OBS's scene transitions, and a visible T-bar. The Dial mixes with that Fade even while Cut is selected. Clear a conflicting transition override on Preview. If someone moved Preview or the slider, settle the handle in OBS, check Program and Preview, then press Side + Dial to reset. |
| The transition did not change | Right after a fade or cut OBS ignores a change of transition for about a second. **Previous / next transition** keeps asking for up to three seconds, and **Activity** names the transition OBS really has. After a cut, the companion puts your transition back by itself if OBS returns to Cut. |
| Stop says the controls are still finishing | Click **Stop** (or **Quit Fadester Companion**) again: after 3 more seconds Fadester Companion ends them and says so. Then check the T-bar and the selected transition in OBS. |
| A source or scene was renamed | Read the list from OBS again, pick the role under Assignments and click **Save**. Check the media source’s transport support. Chapters need an active, supported recording; saving a replay needs an active replay buffer. |
| No shortcut responds | Check Activity for a connection error, another listener or a shortcut conflict. A shortcut another app already uses is skipped and named; the other controls still work. Stop competing shortcut handlers and restart the controls. Tap Scroll to read the two scene names. |
| Fadester Companion cannot read its settings | It leaves the file as it is, names its folder and shows **Open settings folder**. |

**The selected transition changes and you did not change it.** Click **Stop**, open a terminal in the package folder and run `FadesterCompanionBridge.exe --trace-transitions`. The controls work as usual (it connects with the password OBS saved on this PC) and each change of OBS's selected transition is printed with the time, next to the companion's own requests. `NOT asked by the companion` means something else made it: OBS itself, a click in OBS, another plugin, a script or another controller. Type `quit` to stop, then click **Start** again.

## Languages

The window, the native preset labels and the quick guides come in 13 languages: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese.

- The window follows the Windows display language; to choose one, start **Fadester Companion.exe** with `--language` and a locale code, for example `--language fr`.
- The window is dark when Windows uses dark app mode (Settings → Personalization → Colors), light otherwise; `--theme dark` or `--theme light` picks one.
- **Quick guide** opens the matching offline guide (**START-HERE.html** in English, with an illustrated control layout, a first-minute rehearsal, the complete preset reference and recovery steps).
- The full operator reference and most **Activity** messages are in English; OBS connection problems show in your language.

## Good to know

- **OBS’s port and password fill themselves in** from the settings OBS saved on this PC. Type a port only for another OBS (a portable copy, or a second one); a typed port is kept, and while VJster is on it cannot be the VJster port. Type a password only if the connection fails; it is not saved.
- **Settings file:** `%LOCALAPPDATA%\FadesterTourBox\config.json` (a Microsoft Store install keeps it in its own package folder).

## Stop and uninstall

- **End the session:** click **Stop**, or right-click the Fadester Companion icon in the notification area (beside the clock) and choose **Quit Fadester Companion**, to release the Windows shortcuts. Closing the window alone leaves the controls on.
- **Uninstall:** remove **OBS Fadester for TourBox** in Console, then uninstall **Fadester Companion** in Windows Settings (Store) or delete the extracted package (ZIP).
- **Open when I sign in:** the installer's uninstall removes it too. If you use the ZIP and delete its folder, untick **Open when I sign in** first; if you forgot, switch **Fadester Companion** off under Windows Settings → Apps → Startup (or Task Manager → Startup apps). Windows skips an entry whose program is gone.
- Your settings stay in `%LOCALAPPDATA%\FadesterTourBox` either way.

## For developers

- **This package:** Windows x64. The native preset needs TourBox Console and a full-size desktop TourBox with three pushable rotaries, Side, Tour, C1/C2 and a D-pad. The mixer companion includes its runtime, runs on the OBS computer, and with **Use only Stream Deck, OpenDeck or MIDI** ticked needs neither TourBox Console nor TourBox hardware. Hardware and software checks: the rehearsal notes.
- **Mac:** Fadester Companion for Mac (Apple silicon and Intel) ships as its own ZIP in each release; see [MACOS.md](MACOS.md) and [macos/panel/README.md](macos/panel/README.md).
- **Source:** the native preset generator and validator, the controls' engine, the Fadester Companion window, the C++ slider helper, icons and the guide generator. Rebuilding on Windows needs an 8.x .NET SDK, Node.js, Python 3, PowerShell, Visual Studio 2022 or later C++ build tools with the Windows SDK, and the stock .NET Framework C# compiler. Run `./build.ps1` from the TourBox source folder (`-DotNet C:\path\to\dotnet.exe` picks an SDK). The optional transport integration test uses the Node package `ws`. The distribution includes the source license and separate notices for the .NET runtime.
- **TourBox Console’s own help:** [preset manual](https://www.tourboxtech.com/en/manual/how-to-customize-presets/) and [TourMenu guide](https://www.tourboxtech.com/en/manual/tourmenu/).
