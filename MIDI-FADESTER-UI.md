# Midi Fadester UI, whole-dialog design (2026-10-27, for 0.2.0)

Scope: the Tools > Midi Fadester dialog inside OBS, every mode, every state. Builds on UI-NOTES.md.
Engine rules it depends on (precondition checks, stack-order detection) ship first as 0.1.3.

## Goals

1. A newcomer with an APC40 gets the crossfader fading scenes in under a minute without reading anything.
2. Every state is a sentence that says what is happening and what to do. Never a bare percentage when
   something is wrong, never a silent half-working setup.
3. The dialog cannot build an invalid assignment. Pickers only offer things that work.
4. Plain words. MIDI numbers, curves and calibration live under Advanced.

## Layout: three zones

```
+--------------------------------------------------------------------------------------------+
| Controller: APC40 mkII  * Connected                 [Change controller]  [Show controller]  |
+--------------------------------------------------------------------------------------------+
| Crossfader | 1        | 2        | 3   ...  | 8        | Master   |                        |
|  [=====|  ]|  [==   ] | [      ] | ...      | [      ] | [======] |  <- live bars           |
|  Throwing  |          |          |          |          |          |  <- state word          |
|  63%       |          |          |          |          |          |                        |
|                                                                                             |
|  Switches  | Volume:  | Not used | Not used | Not used | Volume:  |  <- assignment sentence |
|  scenes    | Mic/Aux  | Click to |          |          | Desktop  |                        |
|  (T-bar)   |          | set up   |          |          | Audio    |                        |
|  [Set up]  | [Set up] | [Set up] |          |          | [Set up] |                        |
+--------------------------------------------------------------------------------------------+
| Studio Mode on  *  Preview: Blue -> Program: Red  *  Last move: Crossfader        [Advanced]|
+--------------------------------------------------------------------------------------------+
```

- Zone 1, controller bar: name, green or red dot, one sentence on red ("Another program has the APC40
  open. Close it, then press Reconnect."). "Show controller" opens the SVG picture of the desk with each
  control labelled by its assignment (UI-NOTES item 5).
- Zone 2, strips: one vertical strip per physical control, in hardware order, named as printed on the
  desk. Each strip shows: live bar (calibrated position), takeover arrow when pickup is pending, a state
  word, the assignment as a sentence, a status sentence in amber or red when something needs doing, and
  a Set up button. Unassigned strips are dimmed: "Not used. Click to set up." Knobs join as more strips
  later; nothing in the layout assumes faders only.
- Zone 3, status line: Studio Mode state, Preview and Program names, last control moved. "Advanced"
  opens the current table in a tab (export, import, CC numbers, calibration, smoothing, bulk edits).

## The Set up sheet (one small dialog, three steps, Back and Next)

Step 1, "What should this fader do?" Four cards, one line each, one picture each:

| Card | Line under it | Needs |
|---|---|---|
| Switch scenes | Fade Program to Preview, like OBS's T-bar. | Studio Mode on |
| Mix two layers | In one scene, fade between two layers. Left is one, right is the other. | both layers in that scene |
| Show or hide a layer | Fade one layer in (right) or out (left). | the layer in a scene |
| Volume | Control one audio source, like OBS's mixer slider. | a source with audio |

Step 2, "Which?" Depends on the card. Pickers are filtered; the user cannot pick something that fails.

- Switch scenes: nothing to pick. If Studio Mode is off: "Studio Mode is off." [Turn on Studio Mode].
- Mix two layers: Scene first (dropdown of scenes). Then Left and Right, each a dropdown of that scene's
  layers only, in stacking order. Same layer twice is refused inline. Below: "You will see this when
  scene Red is live." If a chosen layer is also used elsewhere: "Color 2 is also in scene Blue; it will
  fade there too." (OBS opacity is per source, so this is true and must be said.)
- Show or hide a layer: Scene, then one layer of that scene. Same two notes.
- Volume: dropdown of sources that have audio, nothing else. Shows the current dB beside each.

Step 3, "Try it." The finished sentence ("Crossfader mixes Color and Color 2 in scene Red"), a live meter
that moves when the hardware moves, and the few options that belong to this mode:

- Mix two layers: Feel: Dip-free (default; the picture never darkens), Equal power, Linear, Cut.
  One line of description each. "Also fade audio" checkbox, shown only when a layer has audio.
- Show or hide: "Also fade audio" when the layer has audio.
- Volume: no options. The law is OBS's own (cubic), stated in one line.
- All modes: "Reverse direction" checkbox (replaces the Inv column).
- Switch scenes only: "T-bar works in both directions" (default on) and the "Finish now" button.
- Advanced link: "Which hardware control?" with Learn, for desks without a profile.

Done writes the slot and closes. The strip now shows the sentence.

## Status sentences (strip and Advanced table share them; get_state carries the same text in `reason`)

| Situation | Strip shows | Button |
|---|---|---|
| Studio Mode off, Switch scenes | Studio Mode is off. | Turn on Studio Mode |
| Layer removed from the scene | Color 2 is no longer in scene Red. | Set up |
| Scene deleted | Scene Red was deleted. | Set up |
| Source renamed | follows the rename, no message | |
| Source lost its audio | Mic/Aux has no audio. | Set up |
| Nothing assigned | Not used. Click to set up. | Set up |
| Pickup pending | Move the fader down to 12% to pick up. (arrow) | |
| At a rail, parked | At end. | |
| Throwing | Throwing 63% / Fading 63% | |
| Controller unplugged | APC40 mkII not found. Plug it in, then Reconnect. | Reconnect |

When a status sentence is showing, the fader writes nothing to OBS. The live bar still moves, so the
user can see the hardware is alive.

## Engine rules the UI relies on (0.1.3, before the redesign)

1. Each mode checks its preconditions and reports `available` and `reason` (the sentences above).
2. Mix two layers: the engine finds which of the two is higher in the scene's stack, drives that one's
   opacity and leaves the lower at 100% (dip-free). If the user's Left is the higher one, the engine
   inverts (opacity = 1 - t) so left and right still mean what the user chose. Re-evaluated on the
   scene's `reorder`, `item_add`, `item_remove` signals, on `source_destroy` and `source_rename`, and on
   Studio Mode events. Nothing time based.
3. The Output readout is the calibrated position exactly (CC 51 of 127 is 40%), never a carried-over
   rescale from another mode. Switching a slot's mode resets its takeover state to Idle.

## Words

| Stop saying | Say |
|---|---|
| Target Mode | What it does |
| Studio Mode T-Bar | Switch scenes (T-bar) |
| Two-Source Crossfade (A <-> B) | Mix two layers |
| Single Layer Opacity | Show or hide a layer |
| Audio Volume (Cubic dB) | Volume |
| Source A (Bottom / Primary), Source B (Top Layer) | Left, Right (stacking is the engine's job) |
| Inv | Reverse direction |
| AFV | Also fade audio |
| Smoothing (tau) | Smoothing, in ms, under Advanced |
| Bidirectional T-Bar (0->1 then 1->0) | T-bar works in both directions |
| Dip-Free Dissolve (Video) | Dip-free |
| Output 48% (A:100% B:48%) | Color 100%, Color 2 48% / Color 2 48% visible / -12.0 dB |

## First run

Controller detected -> profile loaded -> one offer: "Start with the usual layout? Crossfader switches
scenes, Master is Desktop Audio volume. Change anything by clicking a strip." [Yes] [I'll set it up].
Nothing else asked. The amber Studio Mode banner stays as it is today.

## Tests

- Every status sentence has a headless test that produces it from a fake scene graph.
- Property test: no sequence of picker choices in the Set up sheet yields an unavailable slot.
- Stack-order inversion: Left above Right and Left below Right both end with left = Left source at 100%.
- Existing pixel checks and loopMIDI cases unchanged. Dialog screenshots of each state in TESTING.md.

## Out of scope here

Stream Deck surface, Fadester Remote, knobs as slots, the dock (Phase 4). They reuse the sentences.
