# Bring your own controller, platform or robot

Fadester is not tied to the Stream Deck, the TourBox or the APC40. Every surface in the suite drives OBS through the same few doors, and all of them are open to you: a new hardware controller, a control platform that does not exist yet, a web page, a script, or a robot (an automated agent, with or without an AI behind it). This page says where the doors are, what goes through each, and the manners that keep a live show safe.

## The picture

OBS Studio is the hub. Its built-in WebSocket server (obs-websocket 5, **Tools > WebSocket Server Settings**, port 4455, password on) is the one connection every surface makes. Through it there are four doors, from the most general to the most specialized:

| Door | What it drives | Who answers | You need |
|---|---|---|---|
| 1. Plain OBS requests | Scenes, transitions, Studio Mode, sources, layers, audio levels, filter settings | OBS itself | Nothing but OBS |
| 2. The Midi Fadester vendor API | 18 fader and FX slots: T-bar throws, A/B crossfades, layer opacity, audio volume, any numeric filter setting, timed fades, Clean / All FX Off | The [Midi Fadester](https://github.com/jbrick2070/midi-fadester) OBS plugin | Midi Fadester in OBS |
| 3. The shared whole-mix protocol | The whole mixer as one fader: level, steps, fade to silence, restore | The Fadester for TourBox companion (Windows) whenever **All OBS mixer inputs** is on, with or without a TourBox; also the experimental macOS mix host | The companion running on the OBS computer |
| 4. Keystrokes to the companion | Every TourBox action: Preview cueing, the native T-bar, media, overlays, recording, the YouTube video in Chrome through VJster, the two VJ layers | The same companion, in its normal mode | The companion, and a device that can press keys (Windows) |

A controller that only needs door 1 does not need anything from this repository at all. If your platform can host Stream Deck plugins (as [OpenDeck](OPENDECK.md) does), run Fadester for OBS as it is and you are done.

## Door 1: plain OBS requests

Fadester for OBS uses only standard obs-websocket requests for scenes, transitions, sources, audio and filters: `SetCurrentPreviewScene`, `SetCurrentProgramScene`, `SetTBarPosition`, `SetInputVolume`, `SetSourceFilterSettings` and friends (the TourBox companion also uses `TriggerStudioModeTransition`). Any controller platform with an OBS connection already has these; the request list is obs-websocket's own protocol document, or `GetVersion.availableRequests` from a running OBS. Two things OBS does not offer over that connection: a layer's opacity (Fadester rides a Color Correction filter instead, see **OBS Filter** in the README) and an A/B crossfade between two sources (Midi Fadester adds it, door 2).

## Door 2: the Midi Fadester vendor API

When Midi Fadester is loaded, it registers an obs-websocket vendor named `midi-fadester`. Call it with `CallVendorRequest`; values are floats from 0.0 to 1.0, and slot ids are stable strings, never display names: `crossfader`, `fader_1` to `fader_8`, `master`, `fx_1` to `fx_8`.

| Request | Does |
|---|---|
| `get_state` | The whole picture: version, Studio Mode, the active controller layout, the MIDI device, and all 18 slots with their job, value, readout and availability. Call it on connect and after any error. |
| `set_fader_value` | Moves a slot to a value. On a T-bar, `release: true` finishes the throw; `release: false` with `value: 0` cancels it. |
| `nudge_fader` | Adds a delta (may be negative), for endless encoders and dials. |
| `auto_fade` | Fades a slot to a value over 50 to 20 000 ms. A new call on the same slot replaces the running one. |
| `set_slot` | Gives a slot a job, with the same fields as the OBS dialog. Unknown names come back as an error sentence, never as a silent no-op. |
| `load_profile` | Loads a controller layout (`apc40mk2`, `apcminimk2`, `midimix`, `nanokontrol2`, `launchcontrolxl`, `generic`). Replaces all 18 slots. |
| `get_catalog` | Scenes, layers, audio sources, filters and their numeric settings with ranges and current values, so your controller can build its own pickers. |
| `reset_fx` | Clean / All FX Off, instant or over a timed ramp. |

One request, as the inner part of an obs-websocket `CallVendorRequest`:

```json
{
  "vendorName": "midi-fadester",
  "requestType": "auto_fade",
  "requestData": { "slot": "fader_2", "to": 1.0, "ms": 1500 }
}
```

Two events keep your controller's LEDs, rings and screens honest: `fader_changed` on every value change from any origin (`midi`, `ui`, `api`, `auto_fade`, `obs`), at most 30 per second per slot, with `slot`, `value`, `display_value` and `origin`; and `state_changed` whenever a job, device, layout or Studio Mode changes. They arrive as obs-websocket `VendorEvent` events, so subscribe to the Vendors category.

Validation errors come back inside `responseData` as `{ "error": "...", "comment": "...", "error_code": "..." }`: the two sentences name the fix, and `error_code` is a stable slug you can match on (`unknown_slot`, `missing_parameter`, `invalid_parameter`, `unknown_profile`, ...). A slot that cannot act right now reports `available: false`, a `reason` sentence ("Studio Mode is off") and a `reason_code` slug; show the sentence, never guess. Every field and rule is in [API-CONTRACT.md](../API-CONTRACT.md).

## Door 3: the shared whole-mix protocol

"Fade the whole mix" moves every public OBS mixer input together while keeping their relative levels. One provider owns it: the Fadester for TourBox companion with **All OBS mixer inputs** enabled; it answers in its normal mode and in its mix-only mode, which needs neither TourBox Console nor a TourBox. The Stream Deck plugin's **OBS Fade** and **OBS Fader** controls and the Midi Fadester mix master talk to that provider through this protocol, and so can you; the TourBox itself reaches the same mix inside the companion through its chords (door 4).

The transport is obs-websocket's `BroadcastCustomEvent`: you broadcast a request envelope, the provider broadcasts a reply, and you read it from the `CustomEvent` events on your connection (the General subscription). The namespace is `io.github.jbrick2070.fadester.mix.v1`.

Request (the `eventData` of your `BroadcastCustomEvent`):

```json
{
  "namespace": "io.github.jbrick2070.fadester.mix.v1",
  "id": "3f0c6e7e-2b7a-4a1a-9b36-7c3f0c8d2a11",
  "op": "mix.down",
  "sentAtMs": 1794160800000,
  "steps": 2
}
```

| Field | Rule |
|---|---|
| `id` | A fresh UUID per request; the reply echoes it. The provider ignores a repeated id for 12 s. |
| `op` | `mix.status`, `mix.set`, `mix.up`, `mix.down`, `mix.fadeOut` or `mix.restore`. |
| `sentAtMs` | Unix milliseconds. Envelopes older than 10 s or more than 1.5 s in the future are dropped, so keep your clock right. |
| `steps` | `mix.up` and `mix.down` only: 1 to 32 (default 1); one step is the companion's configured step, 3 dB by default. |
| `db`, `durationMs` | `mix.set` only: a level from −100 to 0 dB and a duration from 0 to 10 000 ms. |

Reply (`eventData` of a `CustomEvent` you receive):

```json
{
  "namespace": "io.github.jbrick2070.fadester.mix.v1",
  "id": "3f0c6e7e-2b7a-4a1a-9b36-7c3f0c8d2a11",
  "op": "reply",
  "ok": true,
  "enabled": true,
  "db": -12.0,
  "message": "All mixer inputs: -12.0 dB.",
  "active": true, "silent": false, "gain": 0.2512, "fading": false, "targetDb": -12.0,
  "managed": 4, "skipped": 0, "recovering": false
}
```

Read `enabled` first: `false` means the companion runs but **All OBS mixer inputs** is off, and only `mix.status` is answered with `ok: true`. `db` is the group level in dB and `gain` the same level as the linear multiplier (0 to 1) applied to every managed input's own level; `targetDb` is where a running fade is heading and equals `db` when nothing is fading; `db` and `targetDb` are `null` when that level is silence. `message` is a sentence from the provider ("All mixer inputs: fading to -20.0 dB over 600 ms.", or "Group fade paused. Check Activity before continuing." with `ok: false`). Match replies to your request by `id`, not by order. The request's acknowledgement from OBS only says the envelope was delivered; the deck waits 4 s for a status reply and 12 s for a command reply before showing the control as offline, and sends a `mix.status` probe every 2.5 s while a mix control is visible. Do not set the `client` field: it is the receipt channel for the Midi Fadester plugin inside OBS, which cannot see broadcast events.

## Door 4: keystrokes to the companion

The Fadester for TourBox companion turns global Windows shortcuts into OBS actions: TourBox Console sends the chord, the companion does the work. Any device or program that can press keys can send the same chords: a macro pad, a foot switch, a Bitfocus Companion keyboard action, AutoHotkey, or a robot pressing keys through an input library. This is the quickest way to a new controller on Windows, because the whole TourBox action set comes with it, including the actions no other door offers: the native Studio Mode T-bar, Preview cueing with anchors, media transport, overlays, recording chapters and replays, the speed and quality of the YouTube video in Chrome (through the companion's own VJster link), and the two VJ layers. The whole mix is here too, though door 3 serves it without keystrokes.

1. Install [Fadester Companion](../tourbox/README.md) on the OBS computer (from the Microsoft Store, or extract the ZIP and run **Fadester for TourBox.exe**). Set the OBS WebSocket port if it is not 4455. Leave **OBS password (optional)** empty: the companion uses the password OBS saved on this PC. Pick your sources under Assignments. Leave **Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)** unticked even if you have no TourBox: that option starts the companion in mix-only mode, which registers no chords and hosts no VJster link. Press **Save & start controls**; the chords are registered only while the controls run.
2. Send the chord for the action you want. The action names, labels and chords live in one file, [`tourbox/presets/map.json`](../tourbox/presets/map.json), and nowhere else: the OBS actions use **Ctrl+Alt+Shift** plus a key or F-key (`Ctrl+Alt+Shift+F3` and `F4` move the T-bar, `F5` and `F6` cue the previous and next Preview scene, `F7` takes, `C` cuts, `V` reads recording status), the video actions use **Ctrl+Shift+F1** to `F6` and `F9` to `F11` plus `Alt+Shift+F7` (quality back to Auto), the layer actions **Alt+Shift+F1**, `F2`, `F3`, `F5`, `F6` and `Ctrl+Shift+F7`, `F8`, `F12`. The package's `START-HERE.html`, generated from the same map, shows each control and its action label and links to the map for the chords.
3. Read the companion's Activity log while you rehearse. Every refused action says why in a sentence.

Rotary gestures (turn one detent) are plain repeated presses. Each chord waits in the companion's queue behind earlier actions: a T-bar, layer or video tick that is older than 180 ms when its turn comes is dropped (any other action after 1.5 s), and a T-bar tick within 400 ms of a Music or Layer 2 opacity tick is ignored. Send one press per detent as the control moves, not in a burst. On a Mac the experimental, unreleased shortcut helper registers the same chords as Control, Option and Shift, but the Mac host has no VJster link yet, so the video chords are refused there, and none of it is verified on hardware ([tourbox/MACOS.md](../tourbox/MACOS.md)).

## Robots: through the API, or through MCP

A robot here means an automated agent: a cue list, a show-control system, a script reacting to a timer, or an AI agent deciding what to do next. Everything above is already an API for it. The rules are the same as for a human's controller, with one more: a robot must read the reply before it acts again, because a request that OBS accepted is not yet an action that happened.

**Through the API.** Open one obs-websocket connection (any language with a WebSocket library: the `Hello`, `Identify` with the SHA-256 challenge, then requests and events), call `get_state` once, then use doors 1 to 3 as described. Keep one connection per robot and let it own its subscriptions; do not open a connection per action.

**Through MCP.** The Model Context Protocol is how AI agents are given tools. An MCP server for OBS that passes arbitrary obs-websocket requests through already gives an agent doors 1 to 3 today: it calls `CallVendorRequest` for Midi Fadester and reads the vendor's answer from that request's `responseData`; for the whole mix it calls `BroadcastCustomEvent` and reads the provider's reply from the `CustomEvent` stream, matched by `id`. A Fadester MCP server of its own does not exist yet. When it is built it will be thin and will expose tools with these names and shapes, each a direct translation of one door, so an agent never improvises an envelope:

| Tool | Sends |
|---|---|
| `obs_request(requestType, requestData)` | Door 1, passed through, with obs-websocket's protocol document as the agent's reference |
| `fadester_get_state()`, `fadester_set(slot, value, release?)`, `fadester_nudge(slot, delta)`, `fadester_fade(slot, to, ms)`, `fadester_catalog(source?)`, `fadester_reset_fx(ms?)` | Door 2, one vendor request each, errors returned as the contract's sentence |
| `mix_status()`, `mix_set(db, durationMs)`, `mix_step(direction, steps)`, `mix_fade_out()`, `mix_restore()` | Door 3, one envelope each, resolved by the matching reply or a timeout |
| `tourbox_action(action)` | Door 4, the chord looked up in `map.json` and pressed on the companion's computer; Windows only |

Until then, treat this table as the vocabulary to give your agent, and point it at the JSON examples on this page.

## Manners that keep a show safe

These are the rules every Fadester surface follows, taken from the contracts the suite is built to. A new controller that follows them fits in without anyone noticing.

- **Show the reason, never guess.** Every refusal comes with a sentence (`reason`, `error`, `message`). Put it on your display or in your log as it is.
- **Wait for the answer that matters.** OBS's request acknowledgement is not the result. For the vendor API read `responseData`; for the whole mix wait for the `reply` with your `id`; for keystrokes read the companion's Activity log.
- **Coalesce where values stream.** VJster and OBS Filter send at most one write per 50 ms per target (200 ms for an Audio Modulator), always carrying the newest wanted value, and a filter write moves at most 10 % of the range at a time; discrete nudges (Midi Fadester slots, volume, T-bar, whole mix) are one request per detent. Midi Fadester emits at most 30 `fader_changed` events per second per slot. A controller that floods OBS slows the show for everyone.
- **One owner per thing.** Midi Fadester owns the fader and FX slots; the companion owns the whole mix; the Stream Deck plugin never writes a filter setting a fader or an Audio Modulator already drives. If two of your controls would move the same OBS value, pick one.
- **Studio Mode is a precondition, not an error.** T-bar throws, Preview cueing and the scene mixer need it. Say so on the control; do not switch modes on the operator's behalf. One exception you will observe: Fadester's own T-bar take briefly leaves and re-enters Studio Mode, because OBS 33 cannot finish a throw over obs-websocket; a controller that watches UI events should expect that off/on pair of `StudioModeStateChanged` during a take and not read it as the operator leaving Studio Mode. Likewise, the TourBox companion's T-bar (the Dial or a controller's trigger), finding Cut or another non-Fade transition selected, selects a Fade for the throw and puts the operator's transition back afterwards, so expect a pair of `CurrentSceneTransitionChanged` events around it.
- **Never log a password, a URL or a video title.** The password rule is Fadester's (its diagnostics never include it), the URL and title rule is VJster's; your controller should follow both.
- **Fail visibly, recover quietly.** When OBS goes away, show one line and reconnect by yourself. Do not retry a wrong password: the operator will fix it.

## A worked example: a four-knob box

Say you have a USB box with four endless knobs and four LEDs, and a small program on the OBS computer that reads it.

1. Connect to OBS, identify, subscribe to General and Vendors. Call `CallVendorRequest` `midi-fadester` `get_state`; if it fails, say "Midi Fadester is not loaded" on the box and use door 1 only.
2. Map knob 1 to `nudge_fader` on `fader_1`, knob 2 to `fader_2`, knob 3 to `fx_1`, knob 4 to door 3: `mix.up` and `mix.down` with `steps: 1`.
3. Turn an LED on when the slot reports `available: true`, off with the `reason` in your log when it does not. Light the fourth LED from the mix `reply`'s `enabled`.
4. Update the LEDs from `fader_changed`, not from the values you sent: another surface or the operator may have moved the same slot.
5. Press-and-hold on knob 3 first remembers the slot's current value (the last `fader_changed` you received before the hold began), then calls `auto_fade` to `0.0` over 800 ms. The ramp keeps emitting `fader_changed` with `origin: "auto_fade"`, so leave the remembered value alone while the hold lasts. Release calls `auto_fade` back to it.

That is the whole program. The same shape works for a web page, a MIDI desk Midi Fadester does not know, or a cue list. A game controller is already built in: the companion reads Xbox and XInput pads natively ([docs/gamepad/README.md](gamepad/README.md)), because a browser page only gets pad input while it has focus.

## Where to read the code

| What | Where |
|---|---|
| Vendor API contract (every field, every rule) | [API-CONTRACT.md](../API-CONTRACT.md); the plugin side is `src/obs/mfd-vendor-api.c` in the Midi Fadester repository |
| Whole-mix client (what a surface sends and accepts) | [`src/obs/whole-mix.ts`](../src/obs/whole-mix.ts) |
| Whole-mix provider (what the companion accepts and answers) | [`tourbox/bridge/MixProtocolServer.cs`](../tourbox/bridge/MixProtocolServer.cs) |
| The TourBox action map, chords and labels | [`tourbox/presets/map.json`](../tourbox/presets/map.json); the actions are dispatched in [`tourbox/bridge/DeskActions.cs`](../tourbox/bridge/DeskActions.cs) |
| How the companion registers the chords | [`tourbox/bridge/Bindings.cs`](../tourbox/bridge/Bindings.cs) and `Hotkeys.cs` |
| VJster's link protocol, if you build a new video target or a new deck for it | [`src/vjster/shared/protocol.ts`](../src/vjster/shared/protocol.ts) and [docs/vjster/REQUIREMENTS.md](vjster/REQUIREMENTS.md) section 2 |
| What the Midi Fadester vendor API allows and what the plugin does with it | [FEATURE-AUDIT.md](../FEATURE-AUDIT.md) |

If you build one, open an issue with what you connected and which door you used. A controller that works is the best documentation this page can get.
