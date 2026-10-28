# Fadester for OBS

**Fadester for OBS 0.3.0** turns the Stream Deck +'s four rotary dials, `200 × 100` touch strip cells, and `120 × 120` keypad buttons into direct fader and FX controls for OBS Studio (**requires Elgato Stream Deck 7.1 or later — Stream Deck 6.x is not supported**). It connects directly to OBS over `obs-websocket` 5 and calls Midi Fadester's `midi-fadester` vendor API (`API-CONTRACT.md`), so the property inspector always uses the live slot catalog rather than asking for an opaque slot ID.

## 0.3.0: configure slots, controller, and connection from the Property Inspector

Every Fadester action's Property Inspector now has four clearly scoped sections:

| Section | Scope | What you can do |
|---|---|---|
| **Fader dial / Auto-fade key** | this action | Slot, label override, readout style (engine value or percent), step per tick (0.5 % to 10 %), acceleration, press and hold behaviour, thumbnails; fade target, duration (0 ms = instant). "Fade to" hides itself for **All FX**. |
| **Slot assignment in OBS** | shared by every surface | See what the slot does in plain words and change it: **Switch scenes (T-bar)**, **Mix two layers**, **Show or hide a layer**, **Volume**, **Filter setting (FX)**. Scenes, layers (with "has audio"), audio sources (with dB), filter hosts, filters and numeric settings (with range and unit) come from Midi Fadester's live `get_catalog`; **Apply in OBS** calls `set_slot` and shows the engine's own error sentence if it refuses. Feel (curve), "Also fade audio", filter range and "Bypass at 0 %" are exposed where the mode uses them. |
| **Controller** | shared | Active profile with its tier (**Verified on hardware** for APC40 mkII; **Beta, untested on hardware** for the others; **Custom** for generic), MIDI device connected or the device's error sentence, Studio Mode state. A guarded profile switch (`load_profile`) says up front that it resets slot defaults. |
| **OBS connection** | shared | Host, port, password, live status sentence. The stored password is never sent back to the inspector (it shows "Password saved"), and re-saving host or port never wipes it. **Save & test** re-reads `get_state` over the live socket instead of dropping it. |

Menus rebuild only when the option set changes and never while you have one open, so `state_changed` events from OBS (profile change, filter removed, Studio Mode toggled) update the lists live without fighting the mouse. Offline, the slot list is labelled as contract defaults; live names and availability replace it on connect.

Robustness: settings are applied with a change-only reconnect, offline dial ticks and key presses nudge a reconnect at most once per 2 s (never while halted on a wrong password), an unavailable slot alerts locally instead of sending a request OBS would reject, and terminating a still-connecting socket no longer risks an uncaught `ws` error.

What the Midi Fadester API does not offer, and therefore the inspector cannot: mixer layers or banks (18 flat slots, no bank concept), auto-fade easing (`auto_fade` has only `to` and `ms`; the slot's curve shapes the fade), and a `list_profiles` request (the switcher's list is the contract's documented set, marked as such; only the active profile is read from the device).

Hardware: verified on a physical Akai APC40 mkII and Stream Deck + only. Other profiles are shown as Beta and have not been tested on real desks.

`npm run pi:harness [-- --page auto-fade-key]` serves the real inspector pages at `http://127.0.0.1:4480/` against the fake OBS server for development without Stream Deck or OBS.

## 0.2.0: live Faders, FX & Knobs, and Clean actions

Midi Fadester `0.4.0+` exposes all 18 slots: `Crossfader`, `Fader 1–8`, `Master`, and `FX 1–8`. The Stream Deck property inspectors group them as **Faders** and **FX & Knobs**, keep a saved selection visible, and show **All FX — Clean / All FX Off** only when FX slots are available. A dial press can use **Clean (0 %)** for a released zero value, and a long press can use **Clean All FX** without touching ordinary faders.

FX cells use the engine's human-readable value (for example, `14.1 px` or `-6.0 dB`) and update immediately when the operator changes a bound filter in OBS. Auto-fade keys can also run an immediate clean with a `0 ms` duration.

Midi Fadester `0.3.0` remains compatible with normal fader controls. It has no FX catalog or reset operation; a saved All FX key makes that limitation explicit with an update message instead of falling back silently.

> **Disclaimer:** Fadester for OBS is an independent third-party plugin and is not made, endorsed, or supported by the OBS Project or Elgato.

## Development & AI Disclosure

This plugin is written with AI coding tools under human direction, review, and hardware verification on a real Stream Deck + and OBS Studio 33.

## Documentation

- [FEATURE-AUDIT.md](FEATURE-AUDIT.md) — Ranked feature audit behind 0.3.0: what the API allows, what was missing, what was done, and what is blocked by the contract.
- [REQUIREMENTS.md](REQUIREMENTS.md) — Numbered requirements covering identity and branding (`R-ID-*`), licensing (`R-LIC-*`), runtime stack (`R-STK-*`), connection and status reporting (`R-CON-*`), `API-CONTRACT.md` vendor API compliance (`R-API-*`), launch actions (`R-ACT-*`), Playlister-styled runtime SVG graphics and rate limiting (`R-GFX-*`), testing and mutation checks (`R-TST-*`), and operator decisions (`D-1..D-4`).
- [PLAN.md](PLAN.md) — Local environment audit, architecture, file layout, phased implementation plan (Phase 1 launch set and Phases 2–4 roadmap from `GRAPHICS-NOTES.md` and `IDEAS.md`), per-step unit tests and mutation checks, manual hardware verification checklist, and operator decisions (`D-1..D-4`).
- [API-CONTRACT.md](API-CONTRACT.md) — Shared `midi-fadester` `obs-websocket` 5 vendor API contract between Midi Fadester and Fadester for OBS.
- [LICENSE](LICENSE) — GNU General Public License v2.0 (source headers `GPL-2.0-or-later`).
