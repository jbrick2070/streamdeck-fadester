# Fadester Suite — T-Bar Safety Contract

Status: **Contract v1 (`P0-5`, owner decisions `DEC-1`–`DEC-4` applied)** — shared across **Fadester for OBS** (`streamdeck-fadester`), **Fadester Companion** (`streamdeck-fadester/tourbox`), and **Midi Fadester** (`midi-fadester`).

Machine-readable vectors: [`tests/vectors/tbar-safety.json`](../tests/vectors/tbar-safety.json) (byte-identical copy in `midi-fadester/tests/vectors/tbar-safety.json`).

---

## 1. Purpose and Non-Negotiable Guarantee

OBS Studio 33's `obs-websocket` `SetTBarPosition` updates the preview/program blend cursor, **not** the visible Qt `slider-tbar` (`SliderIgnoreScroll`) widget (`obsproject/obs-studio#11372`). When `SetTBarPosition { release: true }` (or `obs_frontend_release_tbar()`) runs, `OBSBasic::TBarReleased()` reads that Qt slider:

- `tick >= 921` (`~90.03%`) completes the transition to Preview and parks the slider at `0`.
- `tick <= 102` (`~9.97%`) cancels the transition back to the starting Program and parks the slider at `0`.
- `103 <= tick <= 920` leaves the manual transition open and **locks OBS's Transition button**.

Three independent implementations drive OBS 33's T-bar without sharing runtime code:

| Surface | Repository & Files | How it reaches OBS's Qt slider |
|---|---|---|
| **Midi Fadester** (in-process OBS 33 plugin) | `midi-fadester`: `src/core/tbar-logic.{h,c}`, `src/obs/mfd-engine.c` | Finds `slider-tbar` (`QSlider`) on the Qt UI thread and calls `obs_frontend_set_tbar_position` / `obs_frontend_release_tbar`. |
| **Fadester for OBS** (Stream Deck / OpenDeck plugin) | `streamdeck-fadester`: `src/obs/direct-obs-client.ts`, `src/obs/native-tbar.ts`, `src/obs/uia/uia-worker.ts`, `src/obs/ax/ax-worker.ts` | Dedicated worker thread using Windows UI Automation or macOS Accessibility (`AXUIElement`), paired with `obs-websocket` v5 `SetTBarPosition` for release. |
| **Fadester Companion** (TourBox / gamepad / keyboard bridge) | `streamdeck-fadester`: `tourbox/bridge/StudioFader.cs`, `tourbox/bridge/NativeTBar.cs`, `tourbox/native/NativeSlider.cpp`, `tourbox/macos/native/{MacNativeTBar.cs,AXSlider.swift}` | Child helper (`FadesterNativeSlider`) pinned to the PID owning the authenticated loopback WebSocket port, paired with `SetTBarPosition` for release. |

**Primary safety invariant:** OBS's Transition button must never stay locked because a surface helper stalled, timed out, crashed, reconnected, or lost its controller.

---

## 2. Slider Range, Rounding, and Rail Thresholds

All implementations share the constants in `tests/vectors/tbar-safety.json` (`constants`, `tick_vectors`, and `edge_vectors`):

| Constant | Value | Meaning |
|---|---:|---|
| `slider_max` | `1023` | Integer range of OBS 33's `slider-tbar` (`0..1023`, `1024` steps). |
| `obs_finish_min_tick` | `921` | Minimum Qt slider tick at which `OBSBasic::TBarReleased()` completes (`1023 - 102`). Implementations write `1023` (`1.0`) to finish and verify read-back `>= 921` before trusting `release: true`. |
| `obs_cancel_max_tick` | `102` | Maximum Qt slider tick at which `OBSBasic::TBarReleased()` cancels (`1024 / 10`). Implementations write `0` (`0.0`) to cancel and verify read-back `<= 102` before trusting `release: true`. |
| `controller_rail_zone` | `0.03` | Normalized controller rail width in Stream Deck (`TBAR_RAIL`) and Midi Fadester (`MFD_TBAR_RAIL_ZONE`): `<= 0.03` is the origin rail; `>= 0.97` is the target rail. |
| `midi_start_deadband` | `0.06` | Analog MIDI start band (`Idle -> Throwing` requires `> 0.06` normal or `< 0.94` reversed) so pot jitter near rest never opens a manual transition. Once `Throwing`, `(0.03, 0.06]` stays `Throwing` and aborts only at `<= 0.03`. |
| `companion_edge` | `0.005` | `StudioFader.Edge` (`DEC-2`, matching Stream Deck's finest `0.005` dial step): Companion snaps normalized targets `<= 0.005` to `0.0` (cancel) and `>= 0.995` to `1.0` (finish) while preserving discrete `0.01..0.99` steps. |

### Normalized-to-tick conversion

For any finite normalized position `p` in `[0.0, 1.0]`:

```text
tick = round_half_away_from_zero(p * 1023)
```

Values outside `[0.0, 1.0]` or non-finite values are rejected before any slider write (or clamped at the controller normalization boundary in Midi Fadester before state-machine entry).

---

## 3. Release At Most Once Per Throw

1. **Single release per throw.** A throw that starts from rest and either completes at the target rail or cancels at the origin rail sends `SetTBarPosition { release: true }` (or `obs_frontend_release_tbar()`) **at most once**.
2. **Zero writes while parked.** Repeated ticks or fader overshoot into a rail after completion (`1.0, 1.0, 1.0`) or cancellation (`0.0, 0.0`) emit **zero** slider writes and **zero** release calls until a new throw is armed.
3. **Never release in `103..920`.** No implementation sends `release: true` expecting completion or cancellation while OBS's Qt slider sits in `103..920`.

---

## 4. Pre-Write Refusal vs Uncertain Write (Never Replay a Write)

Every native-slider or frontend guard outcome falls into exactly one of two classes:

### 4.1 Pre-write refusal (nothing reached OBS)

Examples:
- Helper reports the slider was hidden, off-screen, disabled, out of `[0, 1023]`, owned by another PID, blocked by OS permissions/elevation, or moved by hand before the write (`NativeTbarRefusal` in Stream Deck; `NativeRefusal` in Companion).
- Studio Mode is off or Qt `slider-tbar` is absent (`allow_frontend_calls == false` in Midi Fadester).

**Required handling:**
- Replay **zero** writes (`writes_replayed = 0`).
- Set **no** operator-reset latch (`needs_operator_reset = false`).
- Leave OBS untouched (`transition_left_open = false` when refused from rest; an operator hand-moved slider mid-throw is never overwritten or force-released). Stream Deck may fall back cleanly to its `obs-websocket` / Studio Mode toggle path when refused before a native throw starts.

### 4.2 Uncertain write (write may or may not have landed)

Examples:
- Helper call times out, helper process exits or closes stdout mid-call, or helper reports `write unconfirmed` / `prior write unconfirmed` (`NativeTbarUncertain` / `NativeTbarTimeout` in Stream Deck; `IOException` / `InvalidOperationException` after helper dispatch in Companion).

**Required handling:**
- **Never replay the write** (`writes_replayed = 0`).
- Treat the slider position as unknown until reconciled by reading OBS's cursor and/or native slider (Section 5).

---

## 5. Recovery Ladder on Mid-Throw Helper Failure (`DEC-1`)

When a native helper fails mid-throw (at 30%, 60%, 95%, or during release confirmation), shipping surfaces follow this recovery ladder:

1. **Freeze input immediately.** Stop movement writes and drop any queued coalesced encoder/trigger steps so stale deltas cannot reopen a closed blend.
2. **Read OBS's transition cursor (`GetCurrentSceneTransitionCursor`).**
   - If `cursor == 0` or `cursor == 1`, OBS has already finished or cancelled the blend. Reconcile Program/Preview scene names if needed, clear throw state, and **do not** toggle Studio Mode (OBS 33 reports `cursor == 1.0` at rest after a completed transition).
3. **Reconcile on the real slider if reachable without replaying uncertain writes.**
   - Stream Deck checks a fresh `read()` when available (`>= 921` finish, `<= 102` cancel, or one endpoint move when reachable). Companion never replays an uncertain native write.
4. **Guaranteed automatic closeout if still open (`0 < cursor < 1`).**
   - Close the open manual blend automatically via the **Studio Mode toggle** (`SetStudioModeEnabled(false)` closes OBS's locked manual transition, followed unconditionally by `SetStudioModeEnabled(true)` to restore Studio Mode).
   - **Windows Companion (`StudioFader`, `allowAutoCloseout: true` default):**
     - At `Position >= 0.5`: finishes to `Preview` (cues starting `Program` into `Preview`, flips dial direction, arms double-take guard, and repays any lent transition).
     - At `Position < 0.5`: restores starting `Program` and `Preview` after closing the locked manual transition, and repays any lent transition.
   - **Stream Deck (`DirectObsClient`):** closes via `performStudioModeToggleTake` when the native slider remains unreachable.
   - **Acceptance:** OBS's Transition button is usable again within **2 seconds** with **zero operator action** (`transition_left_open = false`, `needs_operator_reset = false`).

### Documented Exception (`macos_host`, `DEC-1`)

The experimental macOS Companion development host (`tourbox/macos/host/HostSession.cs`, `allowAutoCloseout: false`) intentionally retains strict no-fallback behavior: on an uncertain native failure mid-throw it disarms (`needsReset = true`, `outcome = "latched_needs_reset"`) without toggling Studio Mode. This sole exception is recorded under `known_exceptions.macos_host` in `tests/vectors/tbar-safety.json`.

---

## 6. Reconnect Policy (`DEC-1`, `DEC-2`)

When an `obs-websocket` session connects or reconnects in Studio Mode:

1. Read `GetCurrentSceneTransitionCursor` twice across a short sampling window (`100..150 ms`).
2. **Moving cursor (`c1 != c2`):** OBS is running a timed transition of its own. **Leave it alone** (`leave_alone`).
3. **Motionless open cursor (`0 < c1 < 1` and `c1 == c2`):** an unattended manual T-bar blend is open in OBS.
   - **Stream Deck (`DirectObsClient`):** relative rotary encoders adopt the open blend (`adopt_open_throw`) so the next dial turn finishes or cancels it cleanly.
   - **Fadester Companion on Windows (`StudioFader.ResumeAsync`):** because triggers are spring-loaded at `0` and hotkeys are stateless, Companion closes a remembered open sweep automatically using the `DEC-1` half-way rule (`finish_to_preview` at `Position >= 0.5`, `cancel_to_program` below `0.5`), **including when OBS was switched to a non-Fade transition (`Cut`, `Stinger`, etc.) across the disconnect**, provided Program and Preview still belong to the sweep.

---

## 7. Physical Controller Disconnect Policy (`DEC-4`)

If a physical MIDI controller disconnects unexpectedly while a manual T-bar throw is open (`MFD_TBAR_THROWING`):

- **Midi Fadester (`DEC-4`):** Aborts the open throw back to Program (`closed_idle`, `transition_left_open = false`) via `mfd_engine_abort_tbar_for_config_change_locked`, clears stale queued MIDI bytes, resets soft-takeover to pickup-waiting at `0.0`, and emits `state_changed`.
- **One abort per disconnect; no automatic resume:** The disconnect latch fires at most once per disconnect and re-arms only when a MIDI device reopens. Reconnecting the controller never resumes a throw automatically; the crossfader must pick up at the origin rail first.

---

## 8. Process Identity and OBS Version Gate (`DEC-3`)

Out-of-process UIA and Accessibility helpers must verify all of the following before touching any UI element:

1. **Supported OS:** `win32` (Windows UI Automation) or `darwin` (macOS Accessibility `AXUIElement`).
2. **Loopback WebSocket endpoint:** host is `127.0.0.1`, `localhost`, `::1`, or `[::1]`.
3. **Exact PID ownership:** the target process PID uniquely owns the listening TCP port of the authenticated `obs-websocket` connection (`GetExtendedTcpTable` on Windows, `lsof` on macOS). Never match by window title or foreground focus.
4. **Widget identity & range:** Qt slider identifier matches OBS 33's T-bar (`slider-tbar` / `SliderIgnoreScroll`), enabled, horizontal, integer range `0..1023`, expected pre-write value, and confirmed readback.
5. **OBS version gate (`DEC-3`):**
   - Both **Stream Deck** and **Fadester Companion** accept any OBS `33.x` (`/^33\.\d+\.\d+(\D|$)/` — e.g. `33.0.0`, `33.0.1`, `33.0.2`, `33.1.0`) while rejecting `< 33` and `>= 34`, keeping runtime slider validation (`AutomationId`, range, expected value, readback) as the real guard.

---

## 9. Resolved Owner Decisions Summary

| ID | Resolution | Status |
|---|---|---|
| **`DEC-1`** | Windows Companion adopts automatic mid-throw and reconnect closeout (`>= 0.5` finishes to Preview, `< 0.5` restores Program/Preview, including reconnect with a non-Fade transition). Experimental `FadesterMacHost` keeps strict no-fallback (`known_exceptions.macos_host`). | **Implemented** |
| **`DEC-2`** | Companion `StudioFader.Edge` is `0.005` (`<= 0.005` cancels, `>= 0.995` finishes); reconnect closeout codified per surface control model (`adopt_open_throw` on stateful dials, half-rule closeout on Companion). | **Implemented** |
| **`DEC-3`** | Companion accepts any OBS `33.x` for `obs-websocket` and native T-bar features, matching Stream Deck, with runtime widget checks as the real guard. | **Implemented** |
| **`DEC-4`** | Midi Fadester aborts an open T-bar throw to Program once per unexpected MIDI disconnect using `mfd_engine_abort_tbar_for_config_change_locked`, with no automatic resume on reconnect. | **Implemented** |

---

## 10. Running the Shared Vector Suites

- **Stream Deck (`SD`):** `npx vitest run tests/tbar-safety-vectors.test.ts` (included in `npm test`)
- **Fadester Companion (`tourbox`):** `dotnet run --project tourbox/tests/portable/FadesterCoreChecks.csproj -- --strict-contract`
- **Midi Fadester (`MF`):** `MFD_STRICT_TBAR_CONTRACT=1 ctest --test-dir build_x64 -R "test-tbar-logic|test-vendor-api" --output-on-failure`
