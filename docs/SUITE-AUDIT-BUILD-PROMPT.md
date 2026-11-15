# Build prompt for the Fadester Suite audit (2026-11-14)

Paste the block below into the coding agent. It expects all four repositories checked out side by side.

```text
You are implementing the Fadester Suite audit. Read this file first, in full, before touching code:

  streamdeck-fadester/docs/SUITE-AUDIT-2026-11-14.md

Repositories (work in all four, checked out side by side):
  jbrick2070/streamdeck-fadester   (SD)  Stream Deck / OpenDeck plugin, VJster, Fadester Companion (tourbox/)
  jbrick2070/midi-fadester         (MF)  OBS 33 C++ plugin
  jbrick2070/visual-sidechain      (VS)  OBS 33 C++ plugin
  jbrick2070/obs-playlister        (PL)  OBS 33 C++ plugin

SCOPE FOR THIS RUN: the P0 section only (P0-1 through P0-6). Do not start P1 or P2. Stop and report when P0
is done. Each P0 item is its own branch and its own draft pull request, in the repo(s) it names.

ORDER
  1. P0-6  Documentation truth pass (all four repos; also remove the dead proc call in
           MF src/obs/mfd-vendor-api.c:339 and fix the PL macOS bundleId).
  2. P0-2  VS: freeze beat in silence; add audio_present and beat_confidence.
  3. P0-1  VS: one process-wide flash clock; *_safe transient uniforms and modulator sources; audit all 11
           built-in shaders; modulator Flash guard.
  4. P0-3  VS vendor requests panic / restore / get_safety and event safety_changed; SD reads real state
           and keeps the hotkey fallback for older Visual Sidechain builds.
  5. P0-4  Whole-mix protocol written into SD API-CONTRACT.md; provider identity in every reply; clients
           refuse to act when two providers answer.
  6. P0-5  docs/TBAR-SAFETY-CONTRACT.md plus tests/vectors/tbar-safety.json, loaded by the SD, Companion and
           MF test suites. Write the contract and vectors and make the existing behaviour pass or fail them
           visibly. Do NOT change Companion's recovery behaviour or any OBS version gate in this run: list
           each divergence and wait for the owner's decision.

NON-NEGOTIABLES
  - Rock solid over clever. OBS's Transition button must never stay locked. Panic, Restore and flash caps
    only ever get stricter. Failures say their cause in one plain sentence.
  - Zero feature loss. No capability, supported hardware (Stream Deck, +, Mini, Neo, OpenDeck, TourBox,
    Xbox/XInput, APC40 mkII and generic MIDI), protocol or language is removed. Every protocol change is
    additive: new fields and new requests only, api_version stays 1, older peers keep working.
  - One owner per concept. Midi Fadester owns slots, Visual Sidechain owns signals. Neither re-exposes the
    other's data.
  - Audio may shape or time an action the operator armed. Audio never originates a Program change.
  - Saved user settings load unchanged. New settings default to the safer value.
  - Contract first: change API-CONTRACT.md (or the new T-bar contract) before the code that implements it.
  - Every new user-facing string goes into every existing locale file for that component and passes the
    existing locale key checks.

HOW TO WORK
  - Before each item, re-read the cited files and confirm the audit's claim still holds at HEAD. If a claim
    is wrong or already fixed, say so in the pull request and skip or adjust; do not implement against a
    stale description.
  - Follow each repo's own PLAN.md, REQUIREMENTS.md and TESTING.md conventions and its existing test style.
  - Every change ships with the headless tests named under "Steps and acceptance" for that item. Run the
    full existing test suite of each repo you touch and report the real output.
  - You cannot run OBS, a Stream Deck, a TourBox, a MIDI desk or a Mac from here unless they are present.
    Do not claim a live or hardware result you did not observe. For each item, end the pull request with a
    short "Still to verify by hand" checklist split into Windows and macOS, taken from the audit's
    acceptance tests.
  - Never skip, disable or loosen a test to get green.
  - No version bumps, tags, releases or store submissions. Add changelog entries under Unreleased.

REPORT WHEN DONE
  One table: item, repo, pull request, tests added, tests passing, what remains for hand verification, and
  any audit claim you found to be wrong. Then list the open decisions for the owner (at minimum: whether
  Companion adopts the automatic T-bar finish, and how the OBS version gates should be aligned).
```

## Later runs

Use the same prompt with the scope line changed, one group per run, in this order:

1. `P1-2`, then `P1-3` and `P1-4` (tempo foundation, then meters and quantized actions that depend on it).
2. `P1-1` (native whole-mix provider in Midi Fadester; depends on P0-4).
3. `P1-5`, `P1-6`, `P1-7`, `P1-8` (setup pass, players, glossary, layer opacity owner).
4. `P2` items one at a time, only after the P0 and P1 hand verification is signed off.
