# Ideas: hands on the visuals (2026-10-27, brainstorm, nothing planned)

The glue that makes all of these cheap: **signals and slots are one vocabulary**. Visual Sidechain
produces signals (level, bass, mid, high, kick, snare, beat phase). Midi Fadester owns slots (faders).
Let a fader be a signal, and let a signal be shown on a fader's screen, and the three plugins become one
instrument. Two additions do it: Visual Sidechain's modulator lists "Fader: Crossfader", "Fader 1 .." as
sources, and emits its signals as events the surfaces can draw.

## Performance moves

1. **Ride the reactivity.** Fader = amount of audio drive on an effect (0 = still, 1 = full). Knob =
   sensitivity. The crossfader morphs between effect preset A and preset B (every numeric setting
   interpolated). A VJ's basic controls, which no OBS plugin has.
2. **Fade on the one.** A dial press or key starts an auto-fade that waits for the next downbeat from the
   beat phase, so scene changes land on the music. Bar count selectable (next beat, next bar, next 4 bars).
3. **Visual EQ.** The eight APC40 faders scale the eight FFT band groups before they reach the shaders:
   pull the bass fader down and the kick stops driving the zoom, without touching the sound.
4. **Freeze and panic.** One key freezes the analysis (the picture holds its current reactive state); one
   key zeroes every strobe and flash amount at once. The panic key is a safety feature, not a toy.
5. **Tap tempo and nudge.** A key taps the tempo to override tracking; a dial nudges the beat phase.
6. **Recorded rides.** Record a fader move for N bars and loop it: a hand-drawn LFO, so an unattended
   stream keeps performing.

## Meters on the hardware

7. **Dial screens as meters.** Bass, mid, high and kick as bars on the Stream Deck + dial screens; the
   APC40's knob LED rings show the same. The desk becomes a channel strip for the picture.
8. **Pad grid as a bar counter.** Eight pads light in turn with the beats; the ninth flashes on the
   downbeat. A visual metronome for cueing fades.

## Playlister tie-ins

9. **Cut on the kick.** Playlister advances to the next clip on the kick, every N bars, in a folder of
   loops. One checkbox in Playlister reading the beat signal.
10. **Scrub the folder.** A dial steps through the playlist; a fader sets the still duration live.

## Keep in mind

- Every idea above is a slot, a signal, or a key action; none needs a new kind of plumbing.
- Strobe rate caps and the panic key stay on in every mode.
- Ship the three plugins' basics first; these come after, one at a time, each with its own test.
