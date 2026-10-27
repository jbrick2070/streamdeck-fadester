# Fadester API contract (draft 1, 2026-10-27)

The agreement between Midi Fadester (inside OBS) and every surface that controls it: Fadester for OBS
(Stream Deck), scripts, Companion. Midi Fadester implements it as an obs-websocket vendor API; the surfaces
call it. Both sides build to this file; changes go here first.

Vendor name: `midi-fadester`. Transport: obs-websocket 5 `CallVendorRequest` and vendor events.
Values are floats 0.0 to 1.0. Slot ids are stable strings, never display names.

## Requests

| requestType | requestData | responseData | Notes |
|---|---|---|---|
| `get_state` | none | `{ version, studio_mode, device: { name, connected, error }, slots: [slot...] }` | The whole picture in one call. Surfaces call it on connect and after any error. |
| `set_fader_value` | `{ slot, value, release? }` | `{ slot, value }` | Moves a slot like a fader would. Goes through the same smoothing and curve as MIDI. `release: true` on a T-bar slot finishes the transition (the same as letting go of the T-bar). Soft takeover does not apply to this call. |
| `nudge_fader` | `{ slot, delta }` | `{ slot, value }` | For endless knobs and dials: adds `delta` (may be negative), clamps to 0..1. |
| `auto_fade` | `{ slot, to, ms }` | `{ slot }` | Timed fade from the current value to `to` over `ms` (50..20000). A new call on the same slot replaces the running one. |
| `set_slot` | `{ slot, target_mode?, source_a?, source_b?, curve?, afv? }` | the updated slot | Same fields as the OBS dialog. Unknown source names are an error, not a no-op. |
| `load_profile` | `{ name }` | `{ loaded }` | `name`: `apc40mk2` for now. |

Slot object:

```json
{
  "id": "crossfader",
  "name": "Crossfader",
  "kind": "crossfader | fader | master",
  "target_mode": "unassigned | tbar | crossfade_ab | layer_opacity | audio_volume",
  "source_a": "Cam 1", "source_b": "Loop 3",
  "curve": "dip_free | full_center | equal_power | linear | cut",
  "afv": false,
  "value": 0.42,
  "takeover_pending": "none | up | down",
  "label": "Cam 1 -> Loop 3",
  "available": true,
  "reason": ""
}
```

`available: false` with a `reason` sentence ("Studio Mode is off", "Source 'Loop 3' not found") is how a
surface learns why a dial does nothing. Surfaces show the reason as text; they never guess.

## Events (Midi Fadester emits, surfaces subscribe)

| eventType | eventData | When |
|---|---|---|
| `fader_changed` | `{ slot, value, origin }` | Any slot value change from any origin (`midi`, `ui`, `api`, `auto_fade`). Coalesced to at most 30 per second per slot. |
| `state_changed` | `get_state` response | Slot assignment, device or Studio Mode changed. |

## Errors

Transport-level errors (unknown `vendorName` or `requestType`) use obs-websocket's outer `requestStatus`.
Because `obs-websocket-api.h`'s `obs_websocket_request_callback_function` (`void (*)(obs_data_t *request_data, obs_data_t *response_data, void *priv_data)`) returns `void` and cannot set the outer `requestStatus`, vendor-level validation errors return `{ "error": "<sentence>", "comment": "<sentence>" }` inside `responseData`, with the sentence giving the fix — for example:
`"Slot 'fader_9' does not exist. Valid slots: crossfader, fader_1 .. fader_8, master."`

## In-process bridge (plugin to plugin, inside OBS)

Plugins in the same OBS do not go through obs-websocket. They use `obs_get_proc_handler()` and
`obs_get_signal_handler()`. One owner per concept: Midi Fadester owns fader slots, Visual Sidechain owns
audio signals. Neither plugin re-exposes the other's data over its own vendor API.

Midi Fadester registers:

| proc or signal | calldata in | calldata out |
|---|---|---|
| proc `midi_fadester_get_slot_value` | `string slot` | `float value`, `bool ok`, `string reason` |
| proc `midi_fadester_set_fader_value` | `string slot`, `float value` | `bool ok`, `string reason` |
| signal `midi_fadester_fader_changed` | `string slot`, `float value`, `string origin` | (emitted on every change, coalesced like the vendor event) |

Visual Sidechain registers:

| proc or signal | calldata in | calldata out |
|---|---|---|
| proc `visual_sidechain_get_signals` | none | `float level, bass, mid, high, kick, snare, beat_phase, bpm`, `bool ok` |
| signal `visual_sidechain_signals` | none | `float` fields as above, emitted at most 30 times per second |

Rules for the bridge:

- A consumer that finds the proc missing shows "Midi Fadester is not loaded" (or "Visual Sidechain is not
  loaded") in its UI next to the source that needs it, and reads 0. Never silent.
- Prefer the signal to polling. If a consumer polls, it polls once per video tick at most.
- Each side has a headless test with a fake proc handler, and the OBS harness loads both plugins and checks
  one value crossing each way.

## Rules

- Every request is covered by a headless test on the Midi Fadester side (fake websocket) and by the OBS
  harness driving `set_fader_value` through real obs-websocket.
- If obs-websocket is not loaded, Midi Fadester logs one line at startup and still works from MIDI.
- Version the contract: `get_state.version` is the plugin version; `api_version` starts at 1 and only moves
  on a breaking change.
