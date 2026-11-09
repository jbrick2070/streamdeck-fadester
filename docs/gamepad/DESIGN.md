# Fadester Pad: a game controller as a Fadester surface

## Draft 3 (2026-11-08): measured on hardware, the page is out

Measured with the operator's Xbox Series controller (USB) on Windows 11, OBS 33.0.1:

| Host | Pad input while OBS is in front |
|---|---|
| Chrome window (`release/pad-probe.html`) | None: updates only while Chrome is the active window |
| Chrome with `--disable-features=EnableWindowsGamingInputDataFetcher` | None |
| OBS Custom Browser Dock, floating | None unless the dock window is active |
| OBS Custom Browser Dock, attached to the main window | None unless the dock itself has focus |
| **Native XInput (`XInputGetState`, slot 0) from a background process** | **Full travel (255 of 255) with OBS in front and with another app in front** |

So the pad is read natively. Recommended host: **the Fadester companion** (today's Fadester for TourBox bridge, `tourbox/bridge/`, .NET 8 Windows), which already holds the OBS connection, the T-bar (`StudioFader`), Preview cueing, take and cut, media, layers, the whole mix and the VJster link, all behind `DeskActions.Dispatch(id)`. A pad module polls XInput (about 120 Hz) on its own thread, turns buttons into those action ids from a remappable map (the same ids as `tourbox/presets/map.json`), and drives the T-bar from the right trigger with the arm, throw, take and cancel rules below, through `StudioFader`. No TourBox needed: the companion runs without one. macOS later through the experimental Mac host with Apple's GameController framework (`GCController.shouldMonitorBackgroundEvents = true`).

Everything below from draft 2 still holds for the map, the T-bar machine and the safety rules; the browser-specific parts (Gamepad API, page hosting, porting `ObsVendorClient`) are superseded.

---

Draft 2, 2026-11-08. Draft 1 was reviewed by agy (Gemini 4 Argon) and Claude Fable (Codex was out of credits until 2026-11-10). This draft folds in the findings both reviewers agreed on and the ones checked against the code.

## Goal

Let anyone with an Xbox-style game controller drive OBS like a small VJ desk: the analog triggers as faders and the buttons as scene and cue keys. No Stream Deck, TourBox or MIDI desk needed. Windows and macOS. Open source and easy to remap. It is one more surface under the Fadester brand and follows the shared manners in [docs/ADD-YOUR-OWN-CONTROLLER.md](../ADD-YOUR-OWN-CONTROLLER.md).

## Where it runs

A page built from TypeScript (rollup, like `vjster-page/`) that reads the pad with the browser's Gamepad API and talks to obs-websocket 5.

**Primary host: an OBS Custom Browser Dock.** Chromium's Gamepad API itself only requires the page to be visible, but the operating system may only give pad input to the app in front: on Windows, Xbox pads are read through Windows.Gaming.Input, which serves the foreground process only, while HID pads (DualSense, Switch Pro) go through Raw Input, which does not. A VJ's hands are on OBS, so OBS is in front, and a page inside OBS keeps the pad. A Chrome window beside OBS is the expected bad case for an Xbox pad on Windows. **To be measured on hardware before it is promised** (`release/pad-probe.html`): Xbox pad and one HID pad if available; dock and Chrome; OBS in front and not.

Later: the Stream Deck plugin's loopback server can serve the same page (`src/vjster/plugin/obs-page.ts` already serves a built page). A native helper waits for a measured need.

Whatever the host, the page treats a stalled `gamepad.timestamp` (250 ms watchdog), a hidden page, or a disconnected pad the same way: it freezes every value, cancels a T-bar throw that was not taken, and says so in one line.

## Reusing Fadester's OBS code (not a fresh client)

Fadester's `DirectObsClient` already knows OBS 33's quirks (the take workaround, NotReady retries, generation guards). The page reuses it rather than relearning them. What has to change so it also runs in a browser:

- `packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts`: a `SocketLike` adapter (as `vjster-extension/src/link-client.ts`) instead of the `ws` API (`on("message")`, `toString("utf8")`, `terminate()`, `removeAllListeners()`, `WebSocket.OPEN`); the Identify SHA-256 becomes an async step (`crypto.subtle` in the browser); a small portable emitter instead of `node:events`.
- `src/obs/whole-mix.ts` and `src/control/layer-controller.ts`: guard `unref` like the rest; `globalThis.crypto.randomUUID()`.
- **Node defaults stay**: the Stream Deck plugin keeps `ws` and `createHash`, so its behaviour and its 1791 tests are unchanged. The suite must be green before any pad code lands.

## Version 1: what it controls (Studio Mode)

Standard mapping: buttons 0 to 16; triggers read from `buttons[6]` and `buttons[7]` (0 to 1).

| Control | Action | How |
|---|---|---|
| D-pad left / right | Previous / next scene into Preview | `SetCurrentPreviewScene` |
| A | Take | Fadester's take |
| B | Cut | `performSceneAction` (temporary Cut override on the destination) |
| X | Playlister Next on the chosen Playlister | `TriggerMediaInputAction` NEXT by `inputUuid` |
| Y | Toggle the chosen filter | `SetSourceFilterEnabled` |
| View + Menu together | **Visual Panic, at once**; held 0.8 s while latched: **Restore** | `visual_sidechain_panic` / `visual_sidechain_restore` (`src/control/visual-safety.ts`); Panic latches the pad's filter writes until Restore succeeds |
| Right trigger | **T-bar** (below) | `SetTBarPosition`, Fadester's take, a new `cancelTbar()` |
| Left trigger | **Punch-in**: rides one chosen filter setting from where it is up to a chosen peak while held, back on release | `FilterController` (its 50 ms coalescing, 10 % step cap, trailing drain, owner and deny lists, 200 ms for an Audio Modulator) |

Targets are chosen by UUID from pickers filled from OBS; names are shown, never used to resolve. Refusals are shown as OBS's or Fadester's sentence.

Deferred: stick rate controls, LB/RB blend modes (they need `sceneName` + `sceneItemId`, not a source UUID), the whole mix, layout import and export, a remembered password.

## The T-bar on a spring-loaded trigger

States: **Disarmed → Armed → Throwing → Taking → Disarmed-until-rest**, and **Throwing → Cancelling → Armed**.

- **Arm** only when the trigger reads at most 0.03, Studio Mode is on, Preview differs from Program, and the current transition can be driven manually (Fade with no conflicting override; a Cut cannot). Snapshot Program and Preview at arm time: OBS 33 reports the destination as Program as soon as a manual transition starts.
- **Throwing**: writes coalesced at 50 ms. The first write waits for OBS to report the cursor between 0 and 1 before more are sent.
- **Take** at 0.97 or more, or on A during a throw: Fadester's take (leave and re-enter Studio Mode). Samples during the take and the spring-back are discarded at the pad, never queued. Stay disarmed until the trigger reads at most 0.03.
- **Cancel** when the trigger returns to 0.03 or less without a take, or on pad loss: one `SetTBarPosition {position 0, release true}` (as `tourbox/bridge/StudioFader.cs`), then confirm Program is unchanged and the cursor parked. With a fast spring the last write may be 30 to 50 %, so the audience sees a snap back, not an ease. B or a D-pad cue during a throw cancels first.

## Safety rules

- Soft takeover: the punch-in starts from the filter's value read at the moment of the pull, never from a stored rest.
- Discrete actions: one request per press, 150 ms repeat guard.
- The password is kept in `sessionStorage` unless the operator ticks "Remember on this computer"; never logged; never in an exported layout.
- Studio Mode is a precondition, not something the pad switches on.

## Build order

1. Portable `ObsVendorClient` (Node defaults), full suite green.
2. `gamepad/` bundle: connect form, status sentence, live raw view, stall watchdog. Hardware probe decides the documented host.
3. Discrete keys.
4. T-bar: `cancelTbar()` in `DirectObsClient`, the state machine, scripted-pad tests.
5. Punch-in through `FilterController`.

## Testing

Unit tests (vitest) on the pure core with a scripted pad: the T-bar machine (arm, throw, take, cancel, pad loss, spring-back), the panic chord, the watchdog, discrete repeat guard. The page in a browser against the test OBS with a stubbed pad. Hardware: the operator's Xbox Series controller (USB) on Windows; the Mac when it arrives.

## Code layout

`gamepad/src/core/*.ts` (pure), `gamepad/src/page/*.ts` (DOM), `gamepad/pad.html`, `gamepad/rollup.config.mjs`; tests in `tests/gamepad-*.test.ts`; docs in `docs/gamepad/README.md`.
