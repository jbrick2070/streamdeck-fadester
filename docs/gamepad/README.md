# Game controller

Drive OBS from an Xbox controller (or any XInput-compatible pad): the right trigger is a real T-bar, the buttons cue and take scenes. It runs inside Fadester Companion on Windows, so you need no TourBox, Stream Deck or MIDI desk, and it keeps working while OBS is in front.

<a href="https://apps.microsoft.com/detail/9PN7D3P2X7F4?mode=direct"><img src="https://get.microsoft.com/images/en-us%20dark.svg" alt="Get Fadester Companion from Microsoft" width="200"></a>

## First five minutes

1. Plug in the controller (USB or Xbox Wireless). Windows needs no extra driver.
2. In OBS, open **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**, keep **Enable Authentication** ticked, and click **OK**.
3. Install **Fadester Companion** from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) and open it from the Start menu ([setup guide](../../tourbox/README.md); without a TourBox, skip **1 Import the preset**). It connects to OBS by itself; if the header names a problem, do what it says and click **Read scenes and inputs from OBS** on the **Setup** tab. Tick **Use an Xbox or XInput game controller** under **Game controller**. Leave **Easy mode** ticked.
4. Press **Save & start controls** and keep the companion window open (minimised is fine; closing it stops the controls). The status line at the top says *Game controller: connected*.
5. In OBS 33.0.0 or 33.0.1, with the main window open, turn on **Studio Mode**, select the **Fade** transition, and choose a different scene for Preview.
6. Pull the right trigger halfway: OBS's T-bar follows. Let go: it goes back. Pull it all the way: Preview goes to Program.
7. Press D-pad down to cue the next scene in OBS's list, then hold **A**. After 0.15 s (easy mode) OBS's T-bar starts moving, as if your hand pushed it, and keeps moving while you hold A. When it reaches the end it takes. Let go before then and it stays where it is; hold A again to carry on. From one end to the other takes the **Duration** set in OBS's **Scene Transitions** dock: about 650 ms gives you room to stop halfway.

## The controls

| Control | Does |
|---|---|
| Right trigger | **T-bar.** Pull to mix, all the way to take, let go before the end to go back to Program. |
| A | Take · hold. With a Fade selected in OBS, it pushes the T-bar while you hold it and takes at the end; with Cut or another transition, OBS plays that one and the T-bar stays put |
| B | Cut · hold |
| D-pad up / down | The scene above / below in OBS's list into Preview |
| D-pad left / right | Music down / up one step |
| Left trigger (hold) | Ducks Music; let go to bring it back |
| X | Next item of the media source · hold |
| Y | Play / pause the media source · hold |
| LB / RB | Layer 1 blend mode, previous / next · hold |
| Left stick up / down | Layer 2 opacity (repeats while held) |
| Left stick left / right | Layer 2 blend mode, previous / next · hold, then repeats while held |
| Right stick left / right | VJster video speed slower / faster (repeats while held) |
| Right stick up / down | VJster video speed to the fast / slow preset (2x and 0.5x unless you change them) |
| Left stick click (LS) | VJster speed back to 1x |
| Right stick click (RS) | VJster play / pause · hold |
| View (two squares, sometimes called Back) | Cancel a manual fade, or reset the T-bar after an error |
| Menu (three lines, sometimes called Start) | Set Preview to the Program scene |

**· hold** marks a control that easy mode guards (below). A stick locks to the axis you push it along first (up/down or left/right) until it is back in the centre, so a diagonal thumb does not do two things.

Pick **Music / bed**, **Media / Playlister**, and the **Layer 1** and **Layer 2** scene and source on the **Assignments** tab, then start the controls again. (The **Preview anchor 1** to **4** fields there are the TourBox D-pad's scenes; the controller uses them only if you give a control **Preview anchor 1** to **4**.) VJster's controls need **Enable VJster** ticked on **Setup** and the VJster Chrome extension with a YouTube video open in Chrome itself (capture the Chrome window in OBS; VJster cannot control an OBS Browser Source).

## Easy mode

A game controller is easy to bump. Easy mode, on by default, makes sudden switches on air need a short hold, while gradual steps act at once:

- **Hold 0.15 s:** a take that pushes the T-bar (a Fade selected in OBS) starts moving it. It moves only while you hold, so the short wait is enough to ignore a bump.
- **Hold 0.4 s:** a take that OBS plays by itself (Cut or another transition selected), cut, overlay show and hide, media next, previous, restart and play, VJster play / pause, previous or next blend mode, and the T-bar step actions (**T-bar left / right**, **Fine T-bar left / right**).
- **Hold 0.7 s:** fade out the whole mix and mute the mic (neither is on a control by default).
- **At once:** Preview cues, Music duck and restore, volume steps, Layer 2 opacity, blend mode back to Normal, video speed and quality, Cancel, and everything else.

The action fires the moment the hold is long enough, not when you let go. On a button or the left trigger it fires once per press; a repeating stick action, such as the Layer 2 blend mode, then repeats every 0.2 s while you hold the stick. A tap on a guarded button does nothing, and the **Activity** tab says *Game controller: A was pressed too briefly. Hold it for 0.15 s for Take preview live (easy mode).* (at most once every 5 s for each control). The right trigger is not guarded: pulling it all the way is already deliberate. To make every control act at once, untick **Easy mode** on the **Setup** tab and start the controls again.

## Safety

- The trigger only starts a manual fade (a throw) from rest. A trigger that is already pulled when the controller connects, when OBS reconnects, or after a take, cut, cancel, Preview cue or T-bar step from the controller or the TourBox does nothing until you let it go. (A take made in OBS itself or from a Stream Deck is not seen by the companion: let go of the trigger before taking there.)
- After a take the spring brings the trigger back without throwing back.
- A take pushes the T-bar only when OBS would play a Fade anyway: a Fade selected in the **Scene Transitions** dock and no other transition override on the Preview scene. Otherwise it is OBS's own take, like OBS's **Transition** button, and the T-bar stays put. Any control you set to **Take** does the same, and pushes while that control is held. Takes from the TourBox, a Stream Deck or OBS itself do not move the T-bar.
- A T-bar you leave part-way stays on air part-mixed until you act: hold **A** to carry on, press **B** to finish at once, or press **View** (Cancel) to go back to Program. A Preview cue also goes back to Program first, and a T-bar step moves it from where it is. While a take is pushing it, or has left it part-way, the right trigger does nothing.
- If the controller is unplugged in the middle of a throw, or with the T-bar left part-way, it goes back to Program.
- A cut (**B**) borrows OBS's Cut transition and puts your transition back. OBS will not change transition until the last one has finished, which can be about a second after the picture is done, so a cut right after a take, or a take right after a cut, can wait up to a second before it goes out; a take pressed right after a cut then fades. Pressing take or cut again before the first has gone out counts as a double press and does nothing, and the **Activity** tab says *take ignored* with the reason. OBS sometimes switches back to Cut as the cut ends, so the companion looks again about 1.5 s after each cut, and for 30 s after it also checks before each take, cut, T-bar move or Cancel, and puts your transition back if OBS is on Cut. To keep Cut selected yourself, choose it with **Previous / next transition** (the companion leaves that choice alone), or wait 30 s after a cut before choosing it in OBS.
- Letting go of the left trigger brings Music back even if the connection to OBS dropped while you held it, or the companion was busy with a cut: the restore runs as soon as the companion can, on the new connection if needed. If you hold the trigger again before that, Music stays ducked until you let go. As with every restore, a Music level changed by hand in the meantime is left alone.
- Letting the trigger spring back before the end returns to Program at once: the picture snaps back. Easing it back with your finger eases the mix back.
- The T-bar needs OBS 33.0.0 or 33.0.1 with its main window open, Studio Mode and a Preview different from Program. It always mixes with a Fade: with Cut or another transition selected in OBS, it selects a Fade for the throw and puts yours back when you let go or take. A transition override on the Preview scene must be that Fade or none. Before every throw the companion checks that it can reach OBS's T-bar. If something is missing before the T-bar moves, the **Activity** tab says what, and letting go of the trigger is enough. If a throw is interrupted, or the **Activity** tab asks you to cancel or reset the fader, press **View**.

## Make it yours

Open the **Game controller** tab of the panel:

- **Action:** pick what each control does, or **(free)** for nothing. **Reset to defaults** puts the table above back (the speed presets and Easy mode stay as they are).
- **With LB held:** a second action for any other control while LB is held, which doubles what the controller can reach. As soon as one is set, LB becomes the shift button: its own **Action** is greyed out and it does nothing on its own (the **Activity** tab says so at start). Holding LB changes which action a control does, never whether easy mode guards it.
- **Fast speed preset** and **Slow speed preset:** the speeds for **Video speed: fast preset** and **Video speed: slow preset** (right stick up and down unless you move them): 0.25x, 0.5x, 0.75x, 1.25x, 1.5x, 1.75x or 2x.

Changes apply when the controls start: if they are running, press **Stop controls**, then **Save & start controls**. **LT · let go** offers no guarded actions, and when **LT** ducks Music the panel sets **LT · let go** to bring Music back. The companion checks the same rules at start and refuses a map that breaks them, with a sentence that says which.

The panel writes to the companion's `config.json` (in `%LOCALAPPDATA%\FadesterTourBox`; a Microsoft Store install keeps it in `%LOCALAPPDATA%\Packages\Fluxxuuss.FadesterCompanion_…\LocalCache\Local\FadesterTourBox`), which you can also edit by hand while the companion is closed. If the panel cannot read the file, it names its folder and shows an **Open settings folder** button. `gamepadMap` holds only the changes, with `LB+` before a shifted control and `""` for a free one; `gamepadEasy`, `gamepadFastSpeed` and `gamepadSlowSpeed` hold the rest:

```json
"gamepadEnabled": true,
"gamepadEasy": true,
"gamepadMap": { "Y": "mix.fadeOut", "X": "", "LB+DpadRight": "music.fineUp", "LB+DpadLeft": "music.fineDown" },
"gamepadFastSpeed": 1.5
```

Control names: `A B X Y LB RB View Menu LS RS DpadUp DpadDown DpadLeft DpadRight`, `LT` (press) and `LTRelease`, and the stick directions `LeftUp LeftDown LeftLeft LeftRight RightUp RightDown RightLeft RightRight`. The right trigger is always the T-bar. Action ids are the ones in [`tourbox/presets/map.json`](../../tourbox/presets/map.json) except `bridge.reconnect`, plus the controller's own `vjster.speed.fast` and `vjster.speed.slow`.

## Limits

- Windows only for now. macOS will use Apple's GameController framework through the Mac host.
- XInput pads only (Xbox and compatibles). The companion uses the first connected XInput pad: if another pad or a virtual controller comes first, unplug or turn it off. A DualSense or Switch Pro pad needs Steam Input or a similar XInput layer.
- Not in mix-only mode (**Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)**).
- Why not a web page: a browser only gives pad input to the window in focus, so a page or an OBS dock stops responding the moment you click OBS. The measurements are in [DESIGN.md](DESIGN.md).
