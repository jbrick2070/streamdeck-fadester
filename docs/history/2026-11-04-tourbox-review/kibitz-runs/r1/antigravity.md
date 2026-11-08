VERDICT: build-ready as-is? no.
The plan relies on tearing down and recreating live OBS Studio Mode to finish a T-bar sweep, hardcodes an unreleased OBS version check, contradicts its own preset map on rotary presses, and the native `.tb` delivery files are missing from the repo.

MUST-FIX BEFORE BUILD:
1. [Section 1 & Section 4] Destructive Studio Mode toggle hack and unreleased OBS version gate in manual crossfader.
   - Defect: In `tourbox/bridge/StudioFader.cs#L93-96`, manual T-bar operation hardcodes an exact version match (`if (version != "33.0.0" && version != "33.0.1") throw ...`), failing immediately on any standard OBS release (e.g. OBS 30.x or 31.x). More critically, `StudioFader.FinishSweepAsync` (`tourbox/bridge/StudioFader.cs#L178-182`) finishes a manual sweep by executing `await rpc("SetStudioModeEnabled", new() { ["studioModeEnabled"] = false })` followed immediately by `RestoreStudioAsync()`. Toggling Studio Mode off and on during a live broadcast collapses the preview canvas, triggers video rendering hitches, resets operator UI state, and risks leaving Studio Mode permanently disabled if the restoration call fails.
   - Concrete fix: In `tourbox/bridge/StudioFader.cs#L94`, remove the hardcoded `"33.0.0"` / `"33.0.1"` check and support standard OBS releases. Replace the live Studio Mode disable/enable cycle with standard OBS WebSocket transition completion semantics (e.g. `SetTBarPosition` with `release: true`, or triggering `TriggerStudioModeTransition` once `Position == 1.0`).

2. [Section 2 & Section 5] Spec text contradicts `tourbox/presets/map.json` on rotary press bindings.
   - Defect: Section 2 claims "Dial press cancels an in-flight mix, Scroll press resets Preview to Program", and Section 5 mandates verifying "all three standalone presses". However, in `tourbox/presets/map.json#L27-32`, standalone `dial` press and `scroll` press are completely unmapped in the Show preset. Cancel is mapped to `side+dial` press (line 31), sync is mapped to `side+scroll` press (line 32), and same-spindle press+turn is mapped to fine fade (lines 27-28). Standalone dial and scroll presses do not exist in the shipping preset map.
   - Concrete fix: Align Section 2 and Section 5 with `tourbox/presets/map.json`. Update Section 2 to specify that standalone Dial and Scroll presses are unmapped in Show to prevent accidental mix aborts during rotary scrubbing, and that cancel/sync require the `Side` modifier chord (`side+dial` and `side+scroll`). Update Section 5 to verify standalone Knob press plus the chorded cancel/sync presses rather than non-existent standalone presses.

3. [Section 4 & Section 5] Missing native `.tb` binary preset files.
   - Defect: Section 4 specifies delivering "two native Windows .tb files", which are referenced in `tourbox/presets/map.json#L6,L43` as `Fadester - Show.tb` and `Fadester - Tools.tb`. Neither `.tb` file exists in `tourbox/presets/` or anywhere in the repository. Users cannot complete the "First minute: import Show and Tools as additional TourBox Console presets" step.
   - Concrete fix: Author and commit the concrete `Fadester - Show.tb` and `Fadester - Tools.tb` binary preset files into `tourbox/presets/`, and add an automated test in `tourbox/tests/` asserting that both `.tb` files exist and correspond to the actions in `map.json`.

4. [Section 1 & Section 4] 34-hotkey global Win32 registration failure surface.
   - Defect: Section 1 asserts "Scene navigation requires no named hotkey setup", obscuring that the bridge registers 34 global Windows hotkeys (`Ctrl+Alt+Shift+F1..F12`, `Ctrl+Alt+Shift+1..4`, `Ctrl+Alt+Shift+A..Z`) via Win32 `RegisterHotKey` (`tourbox/bridge/Hotkeys.cs#L76-79`). If any third-party app [ASSUMPTION: Discord, GeForce Experience, or Elgato Stream Deck] has registered even one of those chords, `RegisterHotKey` fails and `Hotkeys.Start` throws a fatal `Win32Exception`, preventing bridge startup. Additionally, TourBox Console only sends preset hotkeys when the linked application has OS focus [ASSUMPTION: unless explicitly mapped as global shortcuts].
   - Concrete fix: Update `tourbox/bridge/Hotkeys.cs#L76-80` to handle registration collisions gracefully by logging a warning and disabling only the contested shortcut rather than crashing the entire process. Explicitly document the global shortcut footprint and TourBox Console window focus behavior in Section 4.

SHOULD-FIX:
1. [Section 3] Blind status actions provide zero feedback on headless hardware.
   - Defect: Section 3 assigns `recording.status` to Dial press in Tools (`tourbox/presets/map.json#L54`) and `soundcheck` to Knob press (`map.json#L34,L53`). The TourBox controller has no LCD, OLED, or LEDs. The bridge outputs status strings strictly to stdout or the background WinForms ListBox (`tourbox/bridge/DeskActions.cs#L67,L84`; `tourbox/panel/FadesterTourBox.cs#L153`), which the operator cannot see during a live broadcast without switching focus away from their stream.
   - Concrete fix: Either cut blind status queries from the hardware mapping or route them through an active visual mechanism (e.g. updating an OBS text GDI source or displaying a non-stealing Windows notification toast).

2. [Section 1 & Section 3] High-risk rotary collision across modal presets without hardware indicators.
   - Defect: Switching between Show and Tools via `side+tour` changes the Dial rotary from manual T-bar crossfading in Show (`map.json#L11-12`) to cycling transition types (Cut, Fade, Stinger) in Tools (`map.json#L48-49`). Because the TourBox hardware has no physical or visual mode indicator, an operator intending to crossfade who does not realize the console is in Tools will switch the active OBS transition rather than fading.
   - Concrete fix: Keep bare Dial rotation dedicated to fader/scrub actions across all modes, or require a chord (such as `side+dial`) to change transition types in Tools.

3. [Section 4] Hardcoded loopback restriction prevents dual-PC streaming setups.
   - Defect: In `tourbox/bridge/BridgeConfig.cs#L29-30`, `BridgeConfig.Load` rejects any host other than `localhost`, `127.0.0.1`, or `::1`. Dual-PC streaming setups (where TourBox runs on the gaming PC and OBS runs on a dedicated encoding PC on the LAN) are artificially blocked.
   - Concrete fix: Allow valid LAN IP addresses or hostnames in `BridgeConfig.cs#L29`, logging a latency advisory rather than aborting.

4. [Section 1 & Section 4] Input queue saturation and lag during rapid rotary scrubbing.
   - Defect: Rapid spinning of Dial or Knob produces dozens of hotkey triggers per second into `tourbox/bridge/Program.cs#L68`. In `tourbox/bridge/StudioFader.cs#L118-122`, the bridge waits up to 300ms for OBS cursor confirmation on the first move. Subsequent events accumulate in the bounded channel (`Program.cs#L68-74`), causing visible fader latency and overshoot after the physical dial stops moving.
   - Concrete fix: Implement event coalescing in `tourbox/bridge/Program.cs` for continuous rotary actions (`fader.forward`/`fader.back`, `music.up`/`music.down`) to collapse pending delta ticks into batched RPC calls.

OPTIONAL / NICE-TO-HAVE:
- Add an audible notification (Windows system sound) when `fader.cancel` or `soundcheck` executes.
- Add a system tray icon for `FadesterTourBoxBridge` to provide visual confirmation of OBS connection state.

CUT THESE (scope / over-engineering):
1. [Section 3] Screenshot capture (`capture.screenshot`) — Safe to cut because saving program screenshots to `MyPictures\Fadester TourBox` (`tourbox/bridge/DeskActions.cs#L69-75`) is completely outside Fadester's core mission of scene transitions and audio riding, while consuming a primary face button (`c2` in Tools).
2. [Section 3] Redundant media transport controls — Safe to cut because media actions (`media.previous`, `media.next`, `media.play`, `media.restart`) consume 6 separate bindings across Show and Tools (`map.json#L29-30,L35-38,L50-52,L55,L60-61`), duplicating standard OS media keys and cluttering an analog mixer interface.
3. [Section 4] Extraneous "YouTube/VJ idea" disclaimer — Safe to cut because referencing internal repository experiments (`src/vjster/`) in a user-facing release document creates confusion for community users with no relevant context.
