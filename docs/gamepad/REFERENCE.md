# Game controller: reference

The details behind the [game controller guide](README.md): Easy mode, the safety rules, and how to change the controls and the settings file.

## Easy mode

A game controller is easy to bump. Easy mode, on by default, makes sudden switches on air need a short hold, while gradual steps act at once:

| Hold | For |
|---|---|
| 0.15 s | **Preview to Program** as a fade that pushes the T-bar (a Fade selected in OBS). It moves only while you hold, so the short wait is enough to ignore a bump. |
| 0.4 s | **Preview to Program** when OBS plays the transition by itself (Cut or another transition selected), cut, overlay show and hide, media next, previous, restart and play, VJster play / pause, previous or next blend mode, and the T-bar step actions (**T-bar left / right**, **Fine T-bar left / right**). |
| 0.7 s | Fade out the whole mix and mute the mic (neither is on a control by default). |
| None | Putting a scene in Preview, Music duck and restore, volume steps, Layer 2 opacity, blend mode back to Normal, video speed and quality, Cancel, and everything else. |

- The action fires the moment the hold is long enough, not when you let go. On a button or the left trigger it fires once per press; a repeating stick action, such as the Layer 2 blend mode, then repeats every 0.2 s while you hold the stick.
- A tap on a guarded button does nothing, and the **Activity** tab says *Game controller: A was pressed too briefly. Hold it for 0.15 s for Preview to Program (easy mode).* (at most once every 5 s for each control).
- The right trigger is not guarded: pulling it all the way is already deliberate.
- To make every control act at once, untick **Easy mode** on the **Setup** tab and start the controls again.

## Safety

**The trigger**

- It only starts a manual fade (a throw) from rest. A trigger that is already pulled when the controller connects, when OBS reconnects, or after Preview to Program, a cut, a cancel, putting a scene in Preview or a T-bar step from the controller or the TourBox does nothing until you let it go. (A transition made in OBS itself or from a Stream Deck is not seen by Fadester Companion: let go of the trigger before you make one there.)
- After Preview has gone to Program the spring brings the trigger back without throwing back.
- Letting it spring back before the end returns to Program at once: the picture snaps back. Easing it back with your finger eases the mix back.
- If the controller is unplugged in the middle of a throw, or with the T-bar left part-way, it goes back to Program.

**What the T-bar needs.** OBS 33 with its main window open, Studio Mode and a Preview different from Program. It always mixes with a Fade: with Cut or another transition selected in OBS, it selects a Fade for the throw and puts yours back when you let go or reach the end. A transition override on the Preview scene must be that Fade or none. Before every throw Fadester Companion checks that it can reach OBS's T-bar. If something is missing before the T-bar moves, the **Activity** tab says what, and letting go of the trigger is enough. If a throw is interrupted, or the **Activity** tab asks you to cancel or reset the fader, press **View**.

**Preview to Program (A)**

- It pushes the T-bar only when OBS would play a Fade anyway: a Fade selected in the **Scene Transitions** dock and no other transition override on the Preview scene. Otherwise OBS plays its own transition, as with OBS's **Transition** button, and the T-bar stays put. Any control you set to **Preview to Program** does the same, and pushes while that control is held. Transitions from the TourBox, a Stream Deck or OBS itself do not move the T-bar.
- A T-bar you leave part-way stays on air part-mixed until you act: hold **A** to carry on, press **B** to finish at once, or press **View** (Cancel) to go back to Program. Putting a scene in Preview also goes back to Program first, and a T-bar step moves it from where it is. While **A** is pushing it, or has left it part-way, the right trigger does nothing.

**Cut (B)**

- A cut borrows OBS's Cut transition and puts your transition back. OBS will not change transition until the last one has finished, which can be about a second after the picture is done, so a cut right after Preview to Program, or Preview to Program right after a cut, can wait up to a second before it goes out; Preview to Program pressed right after a cut then fades.
- Pressing either again before the first has gone out counts as a double press and does nothing, and the **Activity** tab says it was ignored, with the reason.
- OBS sometimes switches back to Cut as the cut ends, so Fadester Companion looks again about 1.5 s after each cut, and for 30 s after it also checks before each Preview to Program, cut, T-bar move or Cancel, and puts your transition back if OBS is on Cut. To keep Cut selected yourself, choose it with **Previous / next transition** (Fadester Companion leaves that choice alone), or wait 30 s after a cut before choosing it in OBS.

**Music duck (left trigger).** Letting go brings Music back even if the connection to OBS dropped while you held it, or Fadester Companion was busy with a cut: the restore runs as soon as Fadester Companion can, on the new connection if needed. If you hold the trigger again before that, Music stays ducked until you let go. As with every restore, a Music level changed by hand in the meantime is left alone.

## Make it yours

Open the **Game controller** tab of Fadester Companion's window:

- **Action:** pick what each control does, or **(free)** for nothing. **Reset to defaults** puts the controls table of [README.md](README.md#the-controls) back (the speed presets and Easy mode stay as they are).
- **With LB held:** a second action for any other control while LB is held, which doubles what the controller can reach. As soon as one is set, LB becomes the shift button: its own **Action** is greyed out and it does nothing on its own (the **Activity** tab says so at start). Holding LB changes which action a control does, never whether Easy mode guards it.
- **Fast speed preset** and **Slow speed preset:** the speeds for **Video speed: fast preset** and **Video speed: slow preset** (right stick up and down unless you move them): 0.25x, 0.5x, 0.75x, 1.25x, 1.5x, 1.75x or 2x.

Changes apply when the controls start: if they are running, press **Stop**, then **Start**. **LT · let go** offers no guarded actions, and when **LT** ducks Music Fadester Companion sets **LT · let go** to bring Music back. Fadester Companion checks the same rules at start and refuses a map that breaks them, with a sentence that says which.

## The settings file

Fadester Companion keeps these choices in its `config.json` (in `%LOCALAPPDATA%\FadesterTourBox`; a Microsoft Store install keeps it in `%LOCALAPPDATA%\Packages\Fluxxuuss.FadesterCompanion_…\LocalCache\Local\FadesterTourBox`), which you can also edit by hand while Fadester Companion is closed. If Fadester Companion cannot read the file, it names its folder and shows an **Open settings folder** button. `gamepadMap` holds only the changes, with `LB+` before a shifted control and `""` for a free one; `gamepadEasy`, `gamepadFastSpeed` and `gamepadSlowSpeed` hold the rest:

```json
"gamepadEnabled": true,
"gamepadEasy": true,
"gamepadMap": { "Y": "mix.fadeOut", "X": "", "LB+DpadRight": "music.fineUp", "LB+DpadLeft": "music.fineDown" },
"gamepadFastSpeed": 1.5
```

Control names: `A B X Y LB RB View Menu LS RS DpadUp DpadDown DpadLeft DpadRight`, `LT` (press) and `LTRelease`, and the stick directions `LeftUp LeftDown LeftLeft LeftRight RightUp RightDown RightLeft RightRight`. The right trigger is always the T-bar. Action ids are the ones in [`tourbox/presets/map.json`](../../tourbox/presets/map.json) except `bridge.reconnect`, plus the controller's own `vjster.speed.fast` and `vjster.speed.slow`.

