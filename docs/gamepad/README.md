# Game controller

Drive OBS from an Xbox controller (or any XInput-compatible pad): the right trigger is a real T-bar, the buttons cue and take scenes. It runs inside the Fadester for TourBox companion on Windows, so you need no TourBox, Stream Deck or MIDI desk, and it keeps working while OBS is in front.

## First five minutes

1. Plug in the controller (USB or Xbox Wireless). Windows needs no extra driver.
2. In OBS, turn on **Tools → WebSocket Server Settings**. Open **Fadester for TourBox** ([setup guide](../../tourbox/README.md)), click **Read scenes and inputs from OBS** on the **Setup** tab, and tick **Use an Xbox or XInput game controller** under **Game controller**.
3. Press **Save & start controls**. The Activity log says *Game controller connected.*
4. In OBS, turn on **Studio Mode**, select the **Fade** transition, and choose a different scene for Preview.
5. Pull the right trigger halfway: OBS's T-bar follows. Let go: it goes back. Pull it all the way: Preview goes to Program.

## The controls

| Control | Does |
|---|---|
| Right trigger | **T-bar.** Pull to mix, all the way to take, let go before the end to go back to Program. |
| A | Take (the selected transition) |
| B | Cut |
| D-pad left / right | Previous / next scene into Preview |
| D-pad up / down | Music up / down one step |
| Left trigger (hold) | Ducks Music; let go to bring it back |
| X | Next item of the media source |
| Y | Play / pause the media source |
| LB / RB | Layer 1 blend mode, previous / next |
| Left stick up / down | Layer 2 opacity (repeats while held) |
| Right stick left / right | VJster video speed slower / faster (repeats while held) |
| Left stick click | VJster speed back to 1x |
| Right stick click | VJster play / pause |
| View | Cancel a manual fade, or reset the T-bar after an error |
| Menu | Set Preview to the Program scene |

Pick **Music / bed**, **Media / Playlister**, and the **Layer 1** and **Layer 2** scene and source on the **Assignments** tab. (The **D-pad** fields there are TourBox scene anchors; the controller uses them only if you map a control to `anchor.1` to `anchor.4`.) VJster's controls need **Enable VJster** ticked and the VJster Chrome extension with a YouTube video open in Chrome.

## Safety

- The trigger only starts a throw from rest. A trigger that is already pulled when the controller connects, when OBS reconnects, or after a take, cancel or Preview cue from the controller or the TourBox does nothing until you let it go. (A take made in OBS itself or from a Stream Deck is not seen by the companion: let go of the trigger before taking there.)
- After a take the spring brings the trigger back without throwing back.
- If the controller is unplugged in the middle of a throw, the throw goes back to Program.
- Releasing the trigger before the end returns to Program at once: the picture snaps back rather than easing.
- The T-bar needs OBS 33.0.0 or 33.0.1, Studio Mode, a Preview different from Program, and the Fade transition with no conflicting scene override. If OBS refuses before a throw starts, the Activity log says why and letting go of the trigger is enough; if a throw is interrupted, press **View** to reset.

## Make it yours

The map lives in the companion's `config.json` (in `%LOCALAPPDATA%\FadesterTourBox`). Close the companion before editing it, or its next save writes over your change. Add a `gamepadMap` entry with only the controls you want to change; `""` leaves a control free:

```json
"gamepadEnabled": true,
"gamepadMap": { "Y": "mix.fadeOut", "X": "", "LeftUp": "music.up", "LeftDown": "music.down" }
```

Control names: `A B X Y LB RB View Menu LS RS DpadUp DpadDown DpadLeft DpadRight`, `LT` (press) and `LTRelease`, and the stick directions `LeftUp LeftDown LeftLeft LeftRight RightUp RightDown RightLeft RightRight`. The right trigger is always the T-bar. Action ids are the ones in [`tourbox/presets/map.json`](../../tourbox/presets/map.json), except `bridge.reconnect`. A wrong name stops the companion at start with a sentence that says which.

## Limits

- Windows only for now. macOS will use Apple's GameController framework through the Mac host.
- XInput pads only (Xbox and compatibles). A DualSense or Switch Pro pad needs Steam Input or a similar XInput layer.
- Not in mix-only mode (**Use only Stream Deck, OpenDeck or MIDI (no TourBox shortcuts)**).
- Why not a web page: a browser only gives pad input to the window in focus, so a page or an OBS dock stops responding the moment you click OBS. The measurements are in [DESIGN.md](DESIGN.md).
