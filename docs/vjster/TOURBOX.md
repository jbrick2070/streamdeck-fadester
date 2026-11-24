# VJster from the TourBox

The one VJster Chrome extension works from the Stream Deck, OpenDeck and the TourBox. With a TourBox, Fadester Companion hosts the extension's link itself; the extension did not change for this.

## Quick start

1. **Set up the TourBox.** Install Fadester Companion and import its preset: [Connect a TourBox](../../tourbox/README.md#connect-a-tourbox).
2. **Add the Chrome extension.** Add [VJster from the Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) and play a YouTube video in Chrome.
3. **Turn the raised Knob.** The video's speed follows. Tap **Side** for 1x.

That's it. OBS can be closed.

Quick start in other languages: [Deutsch](../quickstart/companion/de.md#vjster-tourbox) · [Español](../quickstart/companion/es.md#vjster-tourbox) · [Français](../quickstart/companion/fr.md#vjster-tourbox) · [Italiano](../quickstart/companion/it.md#vjster-tourbox) · [日本語](../quickstart/companion/ja.md#vjster-tourbox) · [한국어](../quickstart/companion/ko.md#vjster-tourbox) · [Nederlands](../quickstart/companion/nl.md#vjster-tourbox) · [Português (Brasil)](../quickstart/companion/pt-BR.md#vjster-tourbox) · [Русский](../quickstart/companion/ru.md#vjster-tourbox) · [Türkçe](../quickstart/companion/tr.md#vjster-tourbox) · [简体中文](../quickstart/companion/zh-CN.md#vjster-tourbox) · [繁體中文](../quickstart/companion/zh-TW.md#vjster-tourbox)

## The controls

One preset, `OBS Fadester for TourBox`:

| Control | Does |
|---|---|
| Raised Knob turn | video speed, 0.25 per detent |
| Knob press and turn | video speed, 0.05 |
| Knob press | play or pause the video |
| Side tap | speed back to 1x |
| Side + Knob press | speed back to 1x |
| Side + Dial turn | Music |
| Scroll press and turn | video quality down / up |
| Side + D-pad Up | read the video (title, speed, quality) |
| Short + Dial turn | video speed, 0.05 (fine) |
| Top + D-pad Left / Right | Layer 1 / Layer 2 blend mode Normal |
| Top + Knob turn | Layer 1 blend mode previous / next |
| Top + Scroll turn | Layer 2 blend mode previous / next |
| Top + Dial turn | Layer 2 opacity down / up |
| Tour menu | video status, speed 1x, quality Auto, both blend modes Normal, media play/pause, whole-mix level |

Everything else is as before. Pin is not on the hardware: the extension pins only while Chrome is the focused window, and with Auto Switch off (the recommended setup) the one preset works whichever app is in front.

## Good to know

- **Which video.** With several videos open, the extension chooses the one playing; among several playing, the active tab of the focused Chrome window, else the one that started last. Pause the others.
- **Getting it into OBS.** Nothing can reach a plain YouTube browser source in OBS from outside. Either show Chrome with a **Window Capture** of the Chrome window plus an **Application Audio Capture** of Chrome for its sound, or use VJster's `/obs` Browser Source page: choose a **Target** on the **Setup** tab of Fadester Companion (Windows or Mac) and click **Copy OBS Browser Source URL**. The page is served when `vjsterObsToken` is set in `config.json` (that button sets it), or by the VJster Stream Deck plugin.
- **The VJ layers** are OBS actions: Top + Knob and Top + Scroll cycle the blend modes, Top + Dial rides Layer 2's opacity through a Color Correction filter. Layers nobody chose fill themselves in from the live scene the first time a layer control is used (Layer 1 = the topmost visible picture, Layer 2 = the next one down; sound-only and hidden sources are skipped) and are saved to the Assignments tab.
- **Not yet checked on hardware** (see `tourbox/REHEARSAL.md` steps 4, 7 and 11): the Top holds against Top's own Cut on release, press-and-turn on the Knob, opacity and the blend modes in a real OBS, and transport on an OBS Playlister source.

## For developers

**The link.** `tourbox/bridge/VjsterLink.cs` is a port of the Stream Deck plugin's link server (`src/vjster/plugin/link-server.ts`) and protocol v1 (`src/vjster/shared/protocol.ts`): a loopback WebSocket on 127.0.0.1, port 48150 unless the panel says otherwise. It applies the same rules:

- the gate on the HTTP upgrade: one Host header naming the server, an extension origin, the pinned id when one is set, 403 for anything else, 426 for plain HTTP;
- one connection: a newer extension replaces the older with close 4000; the replaced one asks again with `standby=1` and is refused with 409 while the newer one holds the link;
- keepalive: a ping every 20 s, closed after 60 s of silence;
- a malformed report is dropped, with one warning without its content, and state is asked for again at most every 2 s.

Logs never carry a title, a URL or a message body.

**The actions.** `tourbox/bridge/VjsterDesk.cs` turns the `vjster.*` actions into intents and waits up to 600 ms for the report that answers each one, so the panel's Activity line says what the video is doing now ("Video 1.25x · 1080p · playing"). `VjsterHost` keeps the link bound and runs those actions on their own queue, outside the companion's OBS loop: the video works with OBS closed, and a port already in use is reported every 30 s, never seized.

**The layers.** `layer1.*` and `layer2.*` in `DeskActions.cs` use obs-websocket: `SetSceneItemBlendMode` cycles Normal, Additive, Subtract, Screen, Multiply, Lighten, Darken; opacity rides the source's first Color Correction filter (`color_filter_v2`, 0 to 1; the legacy `color_filter`, 0 to 100) through `SetSourceFilterSettings` with `overlay`, adding a filter named "Fadester opacity" when the source has none, and refusing a disabled filter rather than switching it on.

**The shortcuts.** Every original action keeps its Ctrl+Alt+Shift chord; the VJ actions use Ctrl+Shift+F1–F12 and Alt+Shift+F1–F3 and F5–F7, which `tourbox/presets/build.py` accepts (modifier subsets in Console's order). Alt+Shift+F4 is never used: with the companion stopped, Windows could read it as Alt+F4 and close the window in front.

**Checks.**

- `FadesterCompanionBridge --self-test` and `tourbox/tests/portable` (any OS): the gate and the parser case by case, a loopback connection with a stand-in extension (ClientWebSocket), and the layer actions against a fake OBS.
- `tests/tourbox-vjster-link.test.ts`: the built bridge, the real extension logic (Router, LinkClient, Adapter over a fake player) and `dispatch <action>` on the bridge's stdin, which runs an action exactly as the hotkey would. Skipped when the bridge is not built.

**What comes next.**

- New intents for every deck (seek, frame step, loop in/out, tap tempo), which means a Chrome Web Store update.
- A "desk client" role on the link, so the Stream Deck plugin and Fadester Companion share one host instead of one holding the port.
- MIDI.
