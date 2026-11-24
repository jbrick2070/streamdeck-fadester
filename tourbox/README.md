# Fadester Companion: a game controller or a TourBox for OBS Studio

Fadester Companion lets you mix OBS Studio scenes on Windows with an Xbox or other XInput game controller, a full-size TourBox, or both. The right trigger of the controller, or the flat Dial of the TourBox, drives OBS’s own Studio Mode T-bar.

<a href="https://apps.microsoft.com/detail/9PN7D3P2X7F4?mode=direct"><img src="https://get.microsoft.com/images/en-us%20dark.svg" alt="Get Fadester Companion from Microsoft" width="200"></a>

On a Mac (Apple silicon or Intel), use the `Fadester-Companion-macOS-…` ZIP from the same release, with a TourBox (no game controller on the Mac): [MACOS.md](MACOS.md).

## Quick start

<img src="companion-steps.svg" alt="Fadester Companion in three steps: 1, install it and open it; 2, in OBS turn on the WebSocket server, and the OBS light in Fadester Companion turns green; 3, put the next scene in Preview and pull the right trigger or turn the TourBox Dial: OBS's T-bar follows." width="900">

1. **Install and open.** Get **Fadester Companion** from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) and open it from the Start menu. (From the ZIP: extract all of it into a folder you keep and open **Fadester Companion.exe**.)
2. **Let it reach OBS.** In OBS, open **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**, keep **Enable Authentication** on and click **OK**. The **OBS** light at the top of Fadester Companion turns green. Amber? Click the button beside it: **Turn on** switches Studio Mode on, **Show me** plays the clicks in OBS.
3. **Pick your controller and throw.** On the **Setup** tab, under **2 Choose your controller**, tick **Use an Xbox or XInput game controller** (keep **Easy mode**), then click **Stop** and **Start** at the bottom left. With a TourBox, follow [Connect a TourBox](#connect-a-tourbox) instead. Press D-pad down (TourBox: turn **Scroll**) to put the next scene in Preview, then pull the right trigger (TourBox: turn the flat **Dial**): OBS’s T-bar follows, and all the way puts Preview on Program.

That's it. Every control, Easy mode and the safety rules: [game controller guide](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/gamepad/README.md).

Quick start in other languages: [Deutsch](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/de.md#companion) · [Español](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/es.md#companion) · [Français](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/fr.md#companion) · [Italiano](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/it.md#companion) · [日本語](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/ja.md#companion) · [한국어](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/ko.md#companion) · [Nederlands](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/nl.md#companion) · [Português (Brasil)](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/pt-BR.md#companion) · [Русский](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/ru.md#companion) · [Türkçe](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/tr.md#companion) · [简体中文](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/zh-CN.md#companion) · [繁體中文](https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/quickstart/companion/zh-TW.md#companion)

<a id="first-five-minutes-game-controller"></a>

## Game controller: good to know

- **Why Stop and Start.** The controls start by themselves the first time, before the controller is chosen. **Stop** then **Start** (or **Use it** beside the **Controller** light at the top) starts them again with it. The lights at the top then read *Controller: connected* and *Controls: on*.
- **OBS needs:** OBS 33, **Studio Mode** on, a **Fade** among the scene transitions, and the main OBS window open with its T-bar visible.
- **Let go early** and the T-bar goes back to Program.
- **Closing the window does not stop the controls.** Fadester Companion stays in the notification area beside the clock. To stop, right-click that icon and choose **Quit Fadester Companion**.

## Connect a TourBox

With a full-size TourBox, Scroll puts the next scene in Preview, the flat Dial drives the T-bar, and the raised Knob rides the speed of the YouTube video in Chrome.

1. **Import the preset.** In Fadester Companion click **Import into TourBox Console**: it copies the preset’s path (in your language) and opens TourBox Console. In Console click **Import** beside **Preset List** and paste the path. Import one language only. Do not double-click the `.tb` file: Windows has no app for it.
2. **Select it.** In Console turn **Auto Switch** off and select **OBS Fadester for TourBox**, so it works whichever application is in front. (Or keep Auto Switch on and link the preset to OBS.)
3. **Check the lights.** The controls start by themselves; if the **Controls** light says *off*, click **Start** beside it. The **TourBox** light is green once Console holds the preset; amber *preset not imported* has an **Import** button. (With Auto Switch on, bring OBS to the front.)

OBS needs the same as for the controller: the WebSocket server with authentication, **Studio Mode**, a **Fade** among the scene transitions (it need not be the selected one) and the main window with its white T-bar visible; the manual fader targets OBS Studio **33.x**. To change languages, select the existing preset and use its own menu’s **Import**.

### Chrome videos without OBS

The Knob’s video speed, play and pause work in Chrome whether or not OBS is open; while OBS is closed the light reads **Controls: on, waiting for OBS**. Keep **Auto Switch** off so one preset serves every application. With Auto Switch on: [REFERENCE.md](REFERENCE.md#auto-switch-and-preset-updates).

### Updating the preset

When the **TourBox** light reads **TourBox: old preset**, click **Import new preset** and import it into the existing preset with that preset’s own menu **Import**. Details: [REFERENCE.md](REFERENCE.md#auto-switch-and-preset-updates).

## Rehearse the first throw

1. Use two scenes that look clearly different. Turn **Scroll** until the second one is in Preview; Program still shows the first. Tap Scroll to read both names in the **Activity** tab.
2. Turn the **flat Dial** clockwise in small steps and watch the white slider and Program. Stop partway to hold a blend. Turn back to the start, or hold **Side** and press **Dial**, to cancel.
3. Finish the throw: Preview goes live once and OBS parks its handle at the starting end. Clockwise always moves the T-bar towards Preview. Pause a moment before the next throw: clicks right after a finished throw are ignored as overshoot.

From rest, **Tall** sends Preview to Program with the selected transition and **Top** cuts. During a partial mix, either button finishes the throw. To pick a new scene, first finish or cancel the mix, then turn Scroll.

## Learn the surface

| Control | Action |
| --- | --- |
| Raised Knob | Turn: the video’s speed (needs the VJster extension). Tap: play or pause. |
| Flat Dial | Turn: a manual blend. Tap: read the fade. |
| Scroll wheel | Turn: select Preview. Tap: Program and Preview names. |
| D-pad | Put assigned scenes in Preview (anchors 1–4). |
| C1 / C2 | Duck music / restore it. |
| Tall / Short | Preview to Program / read recording status. |
| Top | Cut Preview live. |
| Side | Video speed back to 1x. |
| Tour | The menu of readouts, transitions, media, overlay and capture tools. |

Holding **Side**, **Tall**, **Short** or **Top** while turning a rotary gives more controls (whole mix, Content, transitions, the VJ layers and more). Every combination, the Tour menu and the HUD: [REFERENCE.md](REFERENCE.md#tourbox-controls).

### Fade the whole mix

Tick **All OBS mixer inputs** under **Setup**, click **Stop** and **Start**, then hold **Side** and turn the **raised Knob** to ride every OBS audio input at once; the Tour menu has timed fades. Stream Deck, OpenDeck and MIDI users can run this mode without a TourBox. How the group behaves and how to restore it: [REFERENCE.md](REFERENCE.md#fade-the-whole-mix).

## Drive YouTube and the VJ layers

With the free [VJster extension](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) in Chrome, the raised Knob rides the speed of a YouTube video, OBS open or not. To show the video in OBS, capture the Chrome window, or use **Copy OBS Browser Source URL** on the **Setup** tab. Hold **Top** to drive the two VJ layers set on the **Assignments** tab. Details: [REFERENCE.md](REFERENCE.md#vjster-and-the-vj-layers).

## Assign your show

On **Assignments**, pick the Music and Content inputs, a mic, a media or Playlister source, an overlay and up to four scene shortcuts; empty roles can stay unassigned. **Save** applies them while the controls run. **Adjust the feel** sets the steps and the duck ceiling. Details: [REFERENCE.md](REFERENCE.md#assignments-and-feel).

## Read the desk and recover

**OBS** shows the real Program, Preview and mixer; **TourBox Console** the active preset; the **Activity** tab every result and refusal.

| What happens | What to do |
| --- | --- |
| A dial changed the wrong thing | Check that **OBS Fadester for TourBox** is the active preset, release any held button, and turn Auto Switch off in Console. |
| The manual fade will not start | Check OBS 33, two different scenes, Studio Mode, a Fade among OBS's scene transitions and a visible T-bar. Then press Side + Dial to reset. |
| No shortcut responds | Check **Activity** for a connection error or a shortcut another app already uses; stop that app and restart the controls. |

More cases, and how to trace who changed OBS's transition: [REFERENCE.md](REFERENCE.md#recovery).

## Languages

The window, the native preset labels and the quick guides come in 13 languages: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese. The window follows the Windows display language, and **Quick guide** opens the offline guide in yours. Choosing a language or theme by hand: [REFERENCE.md](REFERENCE.md#languages-and-theme).

## Good to know

- **OBS’s port and password fill themselves in** from the settings OBS saved on this PC; type them only for another OBS or if the connection fails. More: [REFERENCE.md](REFERENCE.md#settings).
- **Settings file:** `%LOCALAPPDATA%\FadesterTourBox\config.json` (a Microsoft Store install keeps it in its own package folder).

## Stop and uninstall

- **End the session:** click **Stop**, or right-click the Fadester Companion icon in the notification area (beside the clock) and choose **Quit Fadester Companion**, to release the Windows shortcuts. Closing the window alone leaves the controls on.
- **Uninstall:** remove **OBS Fadester for TourBox** in Console, then uninstall **Fadester Companion** in Windows Settings (Store) or delete the extracted package (ZIP).
- **Open when I sign in:** the installer's uninstall removes it too. If you use the ZIP and delete its folder, untick **Open when I sign in** first; if you forgot, switch **Fadester Companion** off under Windows Settings → Apps → Startup (or Task Manager → Startup apps). Windows skips an entry whose program is gone.
- Your settings stay in `%LOCALAPPDATA%\FadesterTourBox` either way.

## For developers

Windows x64 package; the Mac app ships as its own ZIP ([MACOS.md](MACOS.md)). Hardware needs, the source and how to build it with `./build.ps1`: [REFERENCE.md](REFERENCE.md#for-developers).
