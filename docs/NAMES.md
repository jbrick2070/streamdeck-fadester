# Fadester Suite: names, in full

The short table is in [START-HERE.md, section 4](START-HERE.md#4-names). Every piece of the Fadester Suite uses one consistent set of English terms so controls, settings, and logs never say two names for the same thing or one name for two different things:

| Term | What it means | What it is NOT |
|---|---|---|
| **Fadester for OBS** | The Stream Deck and OpenDeck plugin, including the 7 bundled VJster actions | Not called bare `"Fadester"`, `"Stream Deck Fadester"`, or `"Stream Deck companion"` |
| **Fadester Companion** | The desktop app for Xbox / XInput controllers, TourBox, and the whole-mix audio provider | Not Bitfocus Companion, and not the Stream Deck plugin (its Windows app file is `Fadester Companion.exe`) |
| **Whole mix** | Moving every public OBS mixer input together while keeping their balance (`io.github.jbrick2070.fadester.mix.v1`, Midi Fadester `mix_master` target) | **All OBS mixer inputs** is the picker option that selects **Whole mix**; Midi Fadester's **Master** strip is a separate single-slot fader (Desktop Audio by default) |
| **Restore visuals** vs **Restore mix** | **Restore visuals** undoes Visual Sidechain's **Panic** (hold `0.8 s`); **Restore mix** returns **Whole mix** inputs to their pre-fade balance | Never bare `"Restore"` without saying whether it restores visuals or the audio mix |
| **Clean FX** vs **Clean / All FX Off** | **Clean FX** is the short label on deck keys and dials (`0 %`); **Clean / All FX Off** is the full name in settings and sentences for zeroing enabled filter slots (`reset_fx`) | Audio and layer controls stay untouched |
| **Layer 1 / Layer 2** | Two sources inside a scene (for blend modes, single-owner layer opacity, or Midi Fadester `crossfade_ab` A/B layer crossfading) | Scenes are never called layers or `LIVE` / `NEXT` |
| **Program / Preview** | OBS Studio Mode's on-air scene (**Program**) and next scene (**Preview**), matching OBS's own window labels | Never `LIVE` / `NEXT` for scenes; `crossfade_ab` and **A/B crossfader** name the two-layer crossfade mode itself |
| **Cue to start** vs **Preview** | **Cue to start** rewinds a Visual Sidechain **Tape Deck** clip to `0.0 s`; putting an OBS scene on standby in Studio Mode is always called **Preview** | Never bare `"Cue"` for putting a scene in Preview |
