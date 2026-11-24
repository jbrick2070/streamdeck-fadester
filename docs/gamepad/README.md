# Game controller

Drive OBS from an Xbox controller (or any XInput-compatible pad): the right trigger is a real T-bar, the buttons put a scene in Preview and send Preview to Program. It runs inside Fadester Companion on Windows, so you need no TourBox, Stream Deck or MIDI desk, and it keeps working while OBS is in front.

<a href="https://apps.microsoft.com/detail/9PN7D3P2X7F4?mode=direct"><img src="https://get.microsoft.com/images/en-us%20dark.svg" alt="Get Fadester Companion from Microsoft" width="200"></a>

## First five minutes

<img src="controller-map.svg" alt="The default controls on an XInput controller: right trigger is the T-bar, A is Preview to Program, B is Cut, D-pad up and down put the scene above or below in Preview, D-pad left and right step Music, the left trigger ducks Music, View cancels a manual fade and Menu sets Preview to the Program scene." width="900">

1. **Plug in and turn on OBS's link.** Plug in the controller (USB or Xbox Wireless; Windows needs no extra driver). In OBS, open **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**, keep **Enable Authentication** ticked and click **OK**.
2. **Open Fadester Companion** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4), then the Start menu; [setup guide](../../tourbox/README.md)). The **OBS** light at the top turns green (amber: click **Show me** beside it). If the **Controller** light says your controller is plugged in but not in use, click **Use it**. Otherwise, on the **Setup** tab under **2 Choose your controller**, tick **Use an Xbox or XInput game controller**, keep **Easy mode** ticked, and click **Start** if the **Controls** light is not green.
3. **Throw.** In OBS 33 turn on **Studio Mode**, select the **Fade** transition, and press D-pad down to put the next scene in Preview. Pull the right trigger halfway: OBS's T-bar follows. Let go: it goes back. Pull it all the way: Preview goes to Program.

That's it. The lights at the top read *Controller: connected* and *Controls: on*.

Quick start in other languages: [Deutsch](../quickstart/companion/de.md#gamepad) · [Español](../quickstart/companion/es.md#gamepad) · [Français](../quickstart/companion/fr.md#gamepad) · [Italiano](../quickstart/companion/it.md#gamepad) · [日本語](../quickstart/companion/ja.md#gamepad) · [한국어](../quickstart/companion/ko.md#gamepad) · [Nederlands](../quickstart/companion/nl.md#gamepad) · [Português (Brasil)](../quickstart/companion/pt-BR.md#gamepad) · [Русский](../quickstart/companion/ru.md#gamepad) · [Türkçe](../quickstart/companion/tr.md#gamepad) · [简体中文](../quickstart/companion/zh-CN.md#gamepad) · [繁體中文](../quickstart/companion/zh-TW.md#gamepad)

**Try A too.** With a scene in Preview, hold **A**. After 0.15 s (Easy mode) OBS's T-bar starts moving as if your hand pushed it, and keeps moving while you hold A; at the end, Preview is on Program. Let go before then and it stays where it is; hold A again to carry on. The trip lasts the **Duration** set in OBS's **Scene Transitions** dock: about 650 ms gives you room to stop halfway.

**Closing the window** while the controls are on hides it in the notification area beside the clock (the icon there has Open, Start / Stop and Quit); the controls keep running.

## The controls

| Control | Does |
|---|---|
| Right trigger | **T-bar.** Pull to mix, all the way to put Preview on Program, let go before the end to go back to Program. |
| A | Preview to Program · hold. With a Fade selected in OBS, it pushes the T-bar while you hold it and ends with Preview on Program; with Cut or another transition, OBS plays that one and the T-bar stays put |
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

- **· hold** marks a control that Easy mode guards (below).
- A stick locks to the axis you push it along first (up/down or left/right) until it is back in the centre, so a diagonal thumb does not do two things.
- **Assignments tab:** pick **Music / bed**, **Media / Playlister**, and the **Layer 1** and **Layer 2** scene and source, then start the controls again. (**Preview anchor 1** to **4** there are the TourBox D-pad's scenes; the controller uses them only if you give a control **Preview anchor 1** to **4**.)
- **VJster's controls** need **Enable VJster** ticked on **Setup** and the VJster Chrome extension with a YouTube video open in Chrome itself (capture the Chrome window in OBS; VJster cannot control an OBS Browser Source).

## Easy mode

A game controller is easy to bump, so Easy mode (on by default) makes sudden switches on air need a short hold, while gradual steps act at once: 0.15 s for **A** pushing the T-bar, 0.4 s for a cut and the other **· hold** controls. A tap that is too short does nothing and the **Activity** tab says so. To make every control act at once, untick **Easy mode** on the **Setup** tab and start the controls again. Every hold time: [REFERENCE.md](REFERENCE.md#easy-mode).

## Safety

- The trigger only starts a throw from rest: a trigger already pulled (when the controller connects, OBS reconnects, or after a transition from the controller or TourBox) does nothing until you let it go.
- Letting the trigger spring back before the end snaps back to Program; easing it back eases the mix back. Unplugging the controller mid-throw also goes back to Program.
- A T-bar left part-way stays on air part-mixed: hold **A** to carry on, press **B** to finish, or press **View** to go back to Program.
- The T-bar needs OBS 33 with its main window open, Studio Mode and a Preview different from Program; it always mixes with a Fade and puts your transition back. If something is missing, the **Activity** tab says what.

How A, B and the Music duck behave around OBS's transitions, in full: [REFERENCE.md](REFERENCE.md#safety).

## Make it yours

On the **Game controller** tab of Fadester Companion's window, pick an **Action** for each control, a second action **With LB held**, and the **Fast** and **Slow speed preset**; then press **Stop** and **Start**. **Reset to defaults** puts the table above back. The rules and the `config.json` keys: [REFERENCE.md](REFERENCE.md#make-it-yours).

## Limits

- Windows only for now. macOS will use Apple's GameController framework through the Mac host.
- XInput pads only (Xbox and compatibles). Fadester Companion uses the first connected XInput pad: if another pad or a virtual controller comes first, unplug or turn it off. A DualSense or Switch Pro pad needs Steam Input or a similar XInput layer.
- Not in mix-only mode (**Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)**).
- Why not a web page: a browser only gives pad input to the window in focus, so a page or an OBS dock stops responding the moment you click OBS. The measurements are in [DESIGN.md](DESIGN.md).
