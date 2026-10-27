# Fadester for OBS

**Fadester for OBS** turns the Stream Deck +'s four rotary dials, `200 × 100` touch strip cells, and `120 × 120` keypad buttons into direct, zero-configuration fader controls for OBS Studio (**requires Midi Fadester in OBS Studio 33**). Rather than routing virtual MIDI ports or translation apps, Fadester for OBS connects directly to OBS over `obs-websocket` 5 and calls Midi Fadester's `midi-fadester` vendor API (`API-CONTRACT.md`): drop **Fader** onto a dial or **Auto-fade** onto a key, pick any Midi Fadester slot (`Crossfader`, `Fader 1–8`, or `Master`) from a live dropdown, and your Stream Deck + and physical MIDI desk stay in lockstep with runtime-drawn Playlister-styled SVG cells (A-to-B gradient fader bars with soft-takeover arrows, Studio Mode T-bar cells with green Preview and red Program names, and optional live `96 × 54` source thumbnails in the crossfade cell).

> **Disclaimer:** Fadester for OBS is an independent third-party plugin and is not made, endorsed, or supported by the OBS Project or Elgato.

## Development & AI Disclosure

This plugin is written with AI coding tools under human direction, review, and hardware verification on a real Stream Deck + and OBS Studio 33.

## Documentation

- [REQUIREMENTS.md](REQUIREMENTS.md) — Numbered requirements covering identity and branding (`R-ID-*`), licensing (`R-LIC-*`), runtime stack (`R-STK-*`), connection and status reporting (`R-CON-*`), `API-CONTRACT.md` vendor API compliance (`R-API-*`), launch actions (`R-ACT-*`), Playlister-styled runtime SVG graphics and rate limiting (`R-GFX-*`), testing and mutation checks (`R-TST-*`), and operator decisions (`D-1..D-4`).
- [PLAN.md](PLAN.md) — Local environment audit, architecture, file layout, phased implementation plan (Phase 1 launch set and Phases 2–4 roadmap from `GRAPHICS-NOTES.md` and `IDEAS.md`), per-step unit tests and mutation checks, manual hardware verification checklist, and operator decisions (`D-1..D-4`).
- [API-CONTRACT.md](API-CONTRACT.md) — Shared `midi-fadester` `obs-websocket` 5 vendor API contract between Midi Fadester and Fadester for OBS.
- [LICENSE](LICENSE) — GNU General Public License v2.0 (source headers `GPL-2.0-or-later`).
