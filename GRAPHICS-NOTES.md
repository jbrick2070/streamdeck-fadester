# Graphics on the deck (2026-10-27, ideas for the Stream Deck + plugin)

Canvas facts: Stream Deck + keys are 120 x 120 px LCDs; each dial has a 200 x 100 px touch cell; the four
cells form one 800 x 100 strip. The SDK takes SVG or PNG for keys and JSON "layouts" for dial cells, with
built-in layouts (icon, text, bar, gradient bar, double bar, full canvas) and custom ones made of pixmap,
text and bar items. Updates should stay around 10 per second per cell; thumbnails at 1 to 2 per second.

Look: the Playlister family. Dark background, the blue to violet gradient, white glyphs, orange accents.
Big shapes, two lines of text at most, nothing thinner than 3 px. SVG drawn at runtime so it stays crisp
and can change color.

## Dial cells (200 x 100)

1. **Fader cell.** Slot name, big percent, a gradient bar whose colors are Source A's and Source B's, so
   the bar itself shows the mix. The takeover arrow sits at the bar's end until the hardware catches up.
2. **Crossfade cell with live thumbnails.** Two small live pictures of Source A and Source B (OBS's
   GetSourceScreenshot at 1 to 2 per second, 96 x 54 each) with the fader knob drawn between them. Tap a
   side to snap to it. No other deck plugin shows the sources themselves.
3. **T-bar cell.** Preview scene name in green at the left, program in red at the right, a bar between,
   a glow while a transition runs. Tap to finish the throw.
4. **Auto-fade cell.** While a timed fade runs, the bar sweeps and the remaining time counts down.
5. **Meter cells.** Bass, mid and high as bars from Visual Sidechain's signals; the cell flashes on the
   kick; a thin sweep shows the beat phase.
6. **Idle strip.** When a cell has nothing assigned, the four cells together draw one spectrum across the
   whole 800 px strip. The deck becomes a VU display between songs.

## Keys (120 x 120)

7. **Scene keys with live thumbnails.** The scene's own picture at 1 per second, a red frame when live,
   green when in preview. Elgato's keys are static icons.
8. **Panic key.** Red, one big glyph, inverts while held. Kills every strobe and flash amount.
9. **Freeze key.** Snowflake, turns ice-blue while the analysis is held.
10. **Tap tempo key.** Shows the BPM, flashes on each tap, pulses on the beat afterward.
11. **Fade to black key.** A gradient square that darkens as the fade runs.
12. **Status key.** OBS and APC40 connection state, and a small MIDI activity dot that blinks on input.
    Press to reconnect.

## Rules

- Everything drawn is readable from an arm's length in a dim room: contrast first, decoration second.
- A cell never shows nothing. Unassigned shows "Unassigned, set in OBS"; disconnected shows the one-line
  reason.
- Animations are driven by events (fader_changed, beat), never by polling loops, and each cell caps its
  own update rate.
- Thumbnails are optional per action (they cost websocket traffic); off by default on keys, on by default
  in the crossfade cell.
