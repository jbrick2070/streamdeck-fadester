# Fadester for OBS

**Fadester for OBS 0.2.0** turns the Stream Deck +'s four rotary dials, `200 × 100` touch strip cells, and `120 × 120` keypad buttons into direct fader and FX controls for OBS Studio (**requires Elgato Stream Deck 7.1 or later — Stream Deck 6.x is not supported**). It connects directly to OBS over `obs-websocket` 5 and calls Midi Fadester's `midi-fadester` vendor API (`API-CONTRACT.md`), so the property inspector always uses the live slot catalog rather than asking for an opaque slot ID.

## 0.2.0: live Faders, FX & Knobs, and Clean actions

Midi Fadester `0.4.0+` exposes all 18 slots: `Crossfader`, `Fader 1–8`, `Master`, and `FX 1–8`. The Stream Deck property inspectors group them as **Faders** and **FX & Knobs**, keep a saved selection visible, and show **All FX — Clean / All FX Off** only when FX slots are available. A dial press can use **Clean (0 %)** for a released zero value, and a long press can use **Clean All FX** without touching ordinary faders.

FX cells use the engine's human-readable value (for example, `14.1 px` or `-6.0 dB`) and update immediately when the operator changes a bound filter in OBS. Auto-fade keys can also run an immediate clean with a `0 ms` duration.

Midi Fadester `0.3.0` remains compatible with normal fader controls. It has no FX catalog or reset operation; a saved All FX key makes that limitation explicit with an update message instead of falling back silently.

> **Disclaimer:** Fadester for OBS is an independent third-party plugin and is not made, endorsed, or supported by the OBS Project or Elgato.

## Development & AI Disclosure

This plugin is written with AI coding tools under human direction, review, and hardware verification on a real Stream Deck + and OBS Studio 33.

## Documentation

- [REQUIREMENTS.md](REQUIREMENTS.md) — Numbered requirements covering identity and branding (`R-ID-*`), licensing (`R-LIC-*`), runtime stack (`R-STK-*`), connection and status reporting (`R-CON-*`), `API-CONTRACT.md` vendor API compliance (`R-API-*`), launch actions (`R-ACT-*`), Playlister-styled runtime SVG graphics and rate limiting (`R-GFX-*`), testing and mutation checks (`R-TST-*`), and operator decisions (`D-1..D-4`).
- [PLAN.md](PLAN.md) — Local environment audit, architecture, file layout, phased implementation plan (Phase 1 launch set and Phases 2–4 roadmap from `GRAPHICS-NOTES.md` and `IDEAS.md`), per-step unit tests and mutation checks, manual hardware verification checklist, and operator decisions (`D-1..D-4`).
- [API-CONTRACT.md](API-CONTRACT.md) — Shared `midi-fadester` `obs-websocket` 5 vendor API contract between Midi Fadester and Fadester for OBS.
- [LICENSE](LICENSE) — GNU General Public License v2.0 (source headers `GPL-2.0-or-later`).
