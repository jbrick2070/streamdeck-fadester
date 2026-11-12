# T-bar dial: final go-forward plan (2026-11-12)

Merges Astra's report (Google Doc) and the team report [TBAR-FEASIBILITY-REPORT-2026-11-12.md](file:///C:/streamdeck-fadester/docs/TBAR-FEASIBILITY-REPORT-2026-11-12.md), fact-checked against OBS 33.0.1 source, GitHub and npm today.

## The answer in one paragraph
Yes, a Stream Deck dial can move OBS's real T-bar by hand, with no flash and no OBS plugin. There are two routes:
- **Route A, the clean one:** an OBS build that contains the upstream fix (PR #13143). The plugin then uses ordinary obs-websocket. No permissions and no extra code on the machine.
- **Route B, the bridge until A ships:** a small native library loaded **inside** the Stream Deck plugin. It moves OBS's slider through the system's accessibility interface (Windows UI Automation, macOS Accessibility), then sends one websocket "release" at the end. No helper app, but it needs a one-time Accessibility permission on Mac.

Today's Studio Mode toggle take stays as the fallback. Midi Fadester stays the recommended smooth path until Route A or B passes testing.

## Fact check
| Claim | Verdict | Evidence |
|---|---|---|
| `SetTBarPosition` runs `TBarChanged` but never moves the slider; the getter reads the slider | ✅ True | `frontend/OBSStudioAPI.cpp` @33.0.1 (`invokeMethod(main, &OBSBasic::TBarChanged…)`, `return main->tBar->value()`) |
| Movement is clamped to 0.01–0.99 | ✅ True | `OBSBasic_Transitions.cpp` `TBarChanged`: `clamp(value/1024, 0.01f, 0.99f)` |
| Release: within 102 of max → finish; ≤102 → cancel; in between → stays open | ✅ True (team report exact; Astra only says "1023") | `T_BAR_CLAMP (T_BAR_PRECISION / 10)` in `TBarReleased` |
| Upstream fix PR #13143 exists | ✅ Open, unmerged; 8 lines added, 1 removed, 3 files; by djordje-mancic; opened 2026-02-18, updated 2026-11-10 | GitHub API |
| obs-websocket `release` bug fixed (#1327) | ✅ Merged 2026-02-25 | GitHub API |
| Issue #13887 (frontend API always cancels) | ✅ Open, opened 2026-09-10 | GitHub API |
| Mac OpenGL crash when toggling Studio Mode (#13934) | ✅ Open. **This matters for the Mac: today's toggle take is a crash risk there.** | GitHub API |
| Latest OBS is 33.0.1 | ✅ | GitHub releases |
| koffi 3.3.7 (Nov 5, 2026) | ✅ | npm |
| Stream Deck runs our plugin on Node 24, so a native addon can load | ✅ Our manifest: Node 24, Stream Deck 7.6+, Mac 13.5+, Win 10+ | `manifest.json` |
| Accessibility write moves OBS's slider (Mac) | ✅ Partly: 0 → 512 → 0 recorded on a real Mac with OBS 33.0.1. A full take and sustained dialing are **not** proven | [MACOS.md](file:///C:/streamdeck-fadester/tourbox/MACOS.md) |
| Accessibility write moves OBS's slider (Windows) | ✅ The old helper exe did this with UI Automation | `tourbox/native/NativeSlider.cpp` |
| "#11372 is a PR" (Astra) | ❌ It's an **issue** | GitHub API |
| "Every quick-transition hotkey is harmlessly blocked" (Astra) | ❌ Too broad. A Quick Transition can swap the transition first and may snap back | Team report §4 |
| Astra citation 5 ("Video Compression Algorithms"), CSDN or Reddit sources, "OBS 33 released Oct 2026" | ⚠️ Weak or wrong sources; ignore them | — |
| "Zero flash, zero old frames" for Route B (Astra) | ⚠️ Expected from the source, **not measured**. Has to be proven on recordings | Team report §2 |

## Where the two reports disagree, and the call
| Topic | Astra | Team report | **Decision** |
|---|---|---|---|
| First choice | In-plugin accessibility (koffi) | Fixed OBS (#13143) | **Build the shared controller once, qualify Route A first on a test OBS, and run Route B on Mac in parallel**, because OBS's release date is unknown and you're moving to a Mac now |
| Persistent osascript or PowerShell pipe | Rank 2 | It's a child process | **Drop it.** It's another process and no better than B |
| Fallback when accessibility fails mid-fade | Auto-fallback to websocket | Never switch method mid-fade; go to "Unknown" and reconcile | **Team report wins.** The method is fixed for the whole throw |

## What the operator gets (goals)
- **Feel:** OBS's T-bar moves with the dial, holds when you stop, reverses when you turn back.
- **Look:** no white flash in OBS's window and no old frame on air.
- **Fewer apps:** Stream Deck plus OBS only. No Midi Fadester, no Companion, no helper exe.
- **Less friction:** it just works after install. One Mac permission prompt at setup (Route B only). No backend picker, no calibration.
- **Latency:** measured, not guessed. Target: OBS's slider and picture follow within about one frame of a dial tick. Report the median and worst case.
- **Compatibility:** Windows and Mac both pass the same checklist before release.

## Stages
| # | What | Done when | Needs your OK? |
|---|---|---|---|
| 0 | **Now (done):** e7f898a, plus the Midi Fadester tip. You run tests 3–5 on the PC | Tests 3–5 pass | — |
| 1 | **Test bench:** an isolated OBS 33.0.1 on its own port (never your live OBS), recordings of OBS's window and Program at 60 fps, and a "fixed OBS" mode in the fake OBS | The current flash and the mismatch reproduce on the bench | Yes (small) |
| 2 | **Shared throw controller** in `direct-obs-client.ts`: method picked at rest and fixed for the throw; one in-flight move plus the latest target only; a one-shot finish/cancel step; an "Unknown" state that stops and re-reads. Today's behaviour unchanged | All tests pass plus new tests (backlog, reversal, repeated endpoints, no toggle in no-flash mode) | Yes (big code change) |
| 3 | **Route A trial:** the #13143 build artifact on the test OBS (PC, then Mac) | Holds, reverses, finishes and cancels cleanly on recordings; Transition button always usable | Yes |
| 4 | **Route B, Mac first:** koffi plus macOS Accessibility inside the plugin, on its own worker thread with an ~80 ms timeout; reuse `AXSlider.swift` logic. Then Windows UI Automation, reusing `NativeSlider.cpp` logic | Full take and cancel, 50+ recorded throws, real Stream Deck launch with permission, restart and upgrade | Yes (**Mac port, not yet approved**) |
| 5 | **Qualification on both platforms:** latency numbers, the window states (covered, other monitor, minimised), Windows OBS running as admin, Mac permission denied or revoked, a plugin restart mid-fade | No case needs a recovery step from you | — |
| 6 | **Release:** auto-pick the best tested method at rest (A if your OBS has the fix, else B, else today's take). Then publish to Elgato, the TourBox store and the MS Store **only after full PC and Mac testing** | Your sign-off | Yes |

## Risks to watch
- **Mac:** today's Studio Mode toggle can crash OBS on Mac (#13934). Route B or Midi Fadester matters more there than on Windows.
- **Mac signing:** the native `.node` files must be signed and notarised for downloads outside the Elgato store.
- **Windows:** if OBS runs as administrator, accessibility is blocked, so the dial falls back to today's take.
- **Minimised OBS:** not supported for slider movement, so it falls back.
- **Upstream:** #13143 could be merged late or changed. Route B covers the gap.

## Not doing
Synthetic mouse drags, cancel-then-cut, timed auto-transitions for the dial, OS script pipes, a separate helper exe, contacting upstream CodeYan01, or touching your live OBS or its password.
