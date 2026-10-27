# Fadester UI notes (2026-10-27, thinking only)

Principle: assign once in OBS, control from anywhere. Midi Fadester holds the slots (Crossfader, Fader 1-8,
Master). Every surface (APC40, Stream Deck, websocket) only moves slot values and shows them. Same names
everywhere.

## Midi Fadester (inside OBS)

1. First run, three screens: "APC40 mkII detected, load its layout?" -> "Move the fader you want for scene
   fades" -> "Fade how: Studio Mode T-bar, or between these two sources" -> Done. Nothing else asked.
2. Strip view, not a table: one vertical strip per fader, drawn like the hardware, with a live bar, the
   takeover arrow, and the assignment under it. Click the assignment to change it. The table stays behind an
   "Advanced" tab for export and bulk edits.
3. Learn everywhere: click a control in the UI, move the hardware. Live "Last MIDI" readout always visible.
4. A status line: "APC40 mkII connected - Studio Mode on - Crossfader -> T-bar".
5. Controller pictures: an SVG of the APC40 with labels showing what each control does. One per profile.
6. Profiles for the common desks: APC40 mkII, APC mini, nanoKONTROL2, Launch Control XL, X-Touch Mini.
7. The dock (Phase 4) is the live view; the Tools dialog is setup only.

## Fadester for OBS (Stream Deck)

1. Connection panel: finds OBS's websocket on the default port, password box, green or red status, Test.
   If Midi Fadester is not installed in OBS, say so, with a link.
2. No typing: the action's slot dropdown fills from Midi Fadester's get_state. Drop "Crossfade" on a dial and
   it is already bound to the crossfader slot.
3. Dial screen: slot name, bar, percent. Dial press: snap to 0 or 100, auto-fade 1 s or 2 s, cut.
4. Touch strip: the T-bar, with the live and preview scene names at each end.
5. Keys: scene buttons with live (red) and preview (green) colors, read from OBS.

## Shared

- One vocabulary: Crossfader, Fader 1-8, Master, Slot, Target, Curve. No MIDI jargon on the first screen
  (CC numbers live under Advanced).
- Errors are sentences with the fix: "Another program has the APC40 open. Close it, then press Reconnect."
- Everything the hardware does, the UI can do with the mouse, so it is testable without the desk.
