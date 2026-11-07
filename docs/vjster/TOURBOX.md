# VJster from the TourBox: as built (2026-11-06)

The one VJster Chrome extension works from the Stream Deck, OpenDeck and the TourBox. The extension never changed for this: it connects to whatever listens on the VJster port on your own computer, and the TourBox companion now hosts that link itself.

## What the companion does

`tourbox/bridge/VjsterLink.cs` is a port of the Stream Deck plugin's link server (`src/vjster/plugin/link-server.ts`) and protocol v1 (`src/vjster/shared/protocol.ts`): a loopback WebSocket on 127.0.0.1, port 48150 unless the panel says otherwise. It applies the same gate on the HTTP upgrade (one Host header naming the server, an extension origin, the pinned id when one is set, 403 for anything else, 426 for plain HTTP), the same one-connection rule (a newer extension replaces the older with close 4000), the same keepalive (a ping every 20 s, closed after 60 s of silence), and the same handling of a malformed report (dropped, one warning without its content, state asked for again at most every 2 s). Logs never carry a title, a URL or a message body.

`tourbox/bridge/VjsterDesk.cs` turns the `vjster.*` actions into intents and waits up to 600 ms for the report that answers each one, so the panel's Activity line says what the video is doing now ("Video 1.25x · 1080p · playing"). `VjsterHost` keeps the link bound and runs those actions on their own queue, outside the companion's OBS loop: the video works with OBS closed, and a taken port is reported every 30 s, never taken over.

The two VJ layers (`layer1.*`, `layer2.*` in `DeskActions.cs`) are OBS actions over obs-websocket: `SetSceneItemBlendMode` cycles Normal, Additive, Subtract, Screen, Multiply, Lighten, Darken; opacity rides the source's first Color Correction filter (`color_filter_v2`, 0 to 1; the legacy `color_filter`, 0 to 100) through `SetSourceFilterSettings` with `overlay`, adding a filter named "Fadester opacity" when the source has none, and refusing a disabled filter rather than switching it on.

## The layout

One preset, `OBS Fadester for TourBox`. Every original action keeps its Ctrl+Alt+Shift chord; the VJ actions use Ctrl+Shift+F1–F12 and Alt+Shift+F1–F6, which `tourbox/presets/build.py` now accepts (modifier subsets in Console's order).

| Control | Does |
|---|---|
| Raised Knob turn | video speed, 0.25 per detent |
| Knob press and turn | video speed, 0.05 |
| Knob press | read the video (title, speed, quality) |
| Side + Knob press | speed back to 1x |
| Side + Dial turn | Music (moved here from the Knob) |
| Scroll press and turn | video quality down / up |
| Side + D-pad Up | play or pause the video |
| Top + Knob turn | Layer 1 blend mode previous / next |
| Top + Scroll turn | Layer 2 blend mode previous / next |
| Top + Dial turn | Layer 2 opacity down / up |
| Tour menu | video status, speed 1x, quality Auto, both blend modes Normal, media play/pause, whole-mix level |

Everything else is as before. Pin is not on the hardware: the extension pins only while Chrome is the focused window, and Console switches presets to follow OBS.

## Checks

- `FadesterTourBoxBridge --self-test` and `tourbox/tests/portable` (any OS): the gate and the parser case by case, a loopback connection with a stand-in extension (ClientWebSocket), and the layer actions against a fake OBS.
- `tests/tourbox-vjster-link.test.ts`: the built bridge, the real extension logic (Router, LinkClient, Adapter over a fake player) and `dispatch <action>` on the bridge's stdin, which runs an action exactly as the hotkey would. Skipped when the bridge is not built.
- Not yet checked on hardware (see `tourbox/REHEARSAL.md` steps 4 and 10): the Top holds against Top's own Cut on release, press-and-turn on the Knob, opacity and the blend modes in a real OBS.

## What comes next

- New intents for every deck (seek, frame step, loop in/out, tap tempo), which means a Chrome Web Store update.
- A "desk client" role on the link, so the Stream Deck plugin and the TourBox companion share one host instead of one holding the port.
- MIDI.
