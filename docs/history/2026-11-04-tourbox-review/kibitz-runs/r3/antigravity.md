VERDICT: build-ready as-is? yes-with-fixes. Solid architecture, but hotkey collisions across presets and unsequenced Studio Mode reset state transitions require immediate fixes.

MUST-FIX BEFORE BUILD:
1. [Section 3 / tourbox/presets/map.json] Duplicate bindings between preset and modifier actions trigger race conditions and conflicting semantics. In `tools`, `left` and `scroll ccw` both emit `Ctrl+Alt+Shift+G` (`media.previous`), while `tall` (`Ctrl+Alt+Shift+J`, `media.restart`) overrides normal take behavior without preset-switching safety. Fix: Map distinct global hotkeys or strictly namespace action handlers per active preset in the companion bridge.
2. [Section 6 / Section 1] OBS 33 manual fader reset sequence lacks synchronization and state locking. Toggling Studio Mode off and on during an active fader sweep can drop incoming WebSocket cue events or desync Preview/Program if the operator continues turning the Dial during reset. Fix: Enforce an integration lock in the bridge during Studio Mode toggle: buffer or suppress incoming Dial rotary events until `StudioModeStateChanged` is confirmed true and current scene IDs are re-verified.

SHOULD-FIX:
1. [Section 6 / tourbox/presets/map.json] All-or-nothing global hotkey registration will fail startup if any single key in the large `Ctrl+Alt+Shift` block is claimed by another background app. Fix: Implement graceful partial registration with explicit UI alerts in the Activity log naming the conflicting key.

OPTIONAL / NICE-TO-HAVE:
1. [Section 7] Add an automated heartbeat/ping on the OBS WebSocket connection to prevent silent disconnects during idle rehearsal.

CUT THESE (over-engineering):
1. [Section 7] Isolated fixture requiring packaged Windows listener and private desktop setup for basic smoke tests can be trimmed; standard mock OBS WebSocket fixture is sufficient for CI verification.

[ASSUMPTION] Assumed the companion bridge uses Win32 `RegisterHotKey` based on Section 6 mention of registration and hotkey string definitions in map.json.
