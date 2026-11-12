# Mac Handoff Prompt (2026-11-12)

You are picking up the Fadester suite on the operator's new physical Mac. The operator types fast and phonetically — read intent, not spelling. Keep replies short and plain.

## Core Priorities
1. **Rock solid over features:** the operator must never need recovery steps, and OBS's Transition button must never stay locked.
2. **Fewest apps, least friction:** consolidate into as few installs, permissions, and steps as possible.

## Repos (all on GitHub, single branch `main` everywhere — no forks, no helper branches)
- `https://github.com/jbrick2070/streamdeck-fadester` (`cb55439` — 1874 tests pass, Win + Mac CI green)
- `https://github.com/jbrick2070/midi-fadester` (`bba6071` — CoreMIDI macOS port merged)
- `https://github.com/jbrick2070/visual-sidechain` (`a595426`)
- `https://github.com/jbrick2070/obs-playlister` (`9d4ac00`)

## Start Here (all in `streamdeck-fadester`)
Read:
- `docs/TBAR-GO-FORWARD-PLAN-2026-11-12.md`
- `docs/TBAR-FEASIBILITY-REPORT-2026-11-12.md`
- `docs/TBAR-WINDOWS-INPLUGIN-DESIGN.md`
- `src/obs/native-tbar.ts`, `src/obs/uia/uia-slider.ts`, `src/obs/uia/uia-worker.ts`, `scripts/native/stage-koffi.mjs`
- `tourbox/macos/native/AXSlider.swift`, `tourbox/MACOS.md`, and `scripts/macos/README.md`

## Where Things Stand (Windows 100% complete & hardware-verified on 2026-11-12)
- Commit `cb55439` built the in-process Windows T-bar slider mover inside the Stream Deck plugin (`koffi@3.3.7` on a `worker_threads` COM MTA calling `IUIAutomation2` with `AutoSetFocus=FALSE`). Zero helper exe (`FadesterNativeSlider.exe` stays unbundled), 2.8 ms median write latency, zero Studio Mode toggle flash.
- Passed all 5 hardware tests on real Windows OBS 33.0.1 ("smooth as butter"):
  1. Turn right to the end repeatedly -> clean take, slider resets to 0, Transition button unlocks, trailing spin ignored.
  2. Pick a different scene into Preview mid-fade -> current fade finishes to original target, new pick waits in Preview.
  3. Restart plugin/Stream Deck mid-fade -> picks up open fade and never ignores turns silently (`e7f898a`).
  4. Mouse-drag OBS's own T-bar halfway, then turn dial -> picks up from halfway and finishes cleanly with zero flash.
  5. Press dial mid-fade (and from rest) -> finishes cleanly with zero flash and zero Studio Mode toggles.

## First Tasks on This Mac
1. **Verify baseline:** ensure Node >= 24 (Stream Deck 7.6+ bundles Node 24 inside `/Applications/Elgato Stream Deck.app` if system Node isn't installed), run `npm ci && npx vitest run` (expect 86 files / 1874 tests passing).
2. **Build Stage 4 — the macOS in-plugin T-bar mover** (`koffi@3.3.7` + macOS Accessibility `AXUIElement` / `CoreFoundation` on a `worker_threads` worker, plugging into `NativeTbar` in `src/obs/native-tbar.ts`):
   - Stage SHA-512-verified `koffi` `darwin-arm64` and `darwin-x64` tarballs in `vendor/koffi/` alongside `win32-x64` and `win32-arm64` in `scripts/native/stage-koffi.mjs` so both Windows and macOS builds stay self-contained. Strip `com.apple.quarantine` where appropriate.
   - Reuse slider discovery rules from `tourbox/macos/native/AXSlider.swift`: match connected local OBS PID, `AXMinimized == false`, non-dock horizontal `AXSlider` with `AXMinValue == 0` and `AXMaxValue == 1023`, `AXUIElementSetMessagingTimeout` ~0.08 s, latest-target coalescing.
   - Check `AXIsProcessTrustedWithOptions` (prompt once on setup, never per tick; TCC permission goes to `Elgato Stream Deck.app` / `OpenDeck.app`).
   - Same hybrid finish/cancel as Windows: write 1023 (confirm >= 921) then send one `SetTBarPosition { position: 1, release: true }`; cancel writes 0 (confirm <= 102) then `{ position: 0, release: true }`. Avoid rapid Studio Mode toggling on macOS OpenGL (`obsproject/obs-studio#13934`).
   - Update `nativeTbarBlocker` / inspector status strings if needed so macOS shows accurate status (following vs Accessibility permission needed vs minimised). Show a brief plan before large code changes if anything deviates from this architecture.
3. **Test virtually/automated first, then install into macOS Stream Deck** (`~/Library/Application Support/com.elgato.StreamDeck/Plugins/io.github.jbrick2070.fadester-for-obs.sdPlugin` — no old backup folders needed) and have the operator run hardware Tests 1–5 on Mac OBS 33.0.1.
   - Note: the operator pre-approves automated testing and starting/restarting OBS when not live. You MAY read the local OBS WebSocket password from OBS's config into memory for tests — NEVER print, log, write to disk, or commit it.

## Later / Ask Before Starting
- Testing/packaging `midi-fadester`, `visual-sidechain`, and `obs-playlister` on macOS.
- Whether to build a macOS Fadester Companion app (only needed if TourBox or Xbox controller will be used on Mac; if built, keep both Chrome VJster and local OBS Browser-source video speed inside Companion so TourBox/Xbox users never need Midi Fadester).
- **Hold all store publishing** (Elgato Marketplace, TourBox store, Microsoft Store) until BOTH Windows and Mac hardware testing are 100% complete and signed off by the operator.

## Standing Rules
- One branch (`main`) everywhere. UTF-8 without BOM everywhere.
- After every coding step: run full test suite + build + portability checks, run an independent subagent QA review on `git diff`, commit via `git commit -F <file>` (ending with your model's `Co-Authored-By` line), push to `origin main`, verify `HEAD == origin/main`, and verify GitHub Actions CI passes on both Windows and macOS.
- Every new or changed foreign-language string in the nine `<lang>.json` files must regenerate `ui/i18n.js` (`node --import tsx scripts/generate-ui-i18n.ts`) and pass a Gemini 4 Argon (`agy`) translation review before commit.
- Format C/C++ with `clang-format 17.0.3` ONLY (never 19.x) and CMake with `gersemi 0.21.0`.
- Never use the banned 5-letter placeholder word starting with `du` and ending with `mmy` (use `placeholder` or `stub`). Never contact upstream `CodeYan01`. Keep the operator's email private. Delete scratch/temp files when done so disk space stays clean.
