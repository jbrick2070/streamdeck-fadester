# Fadester Suite — T-Bar Safety Contract

Status: **Contract v1 (`P0-5`)** — shared across **Fadester for OBS** (`streamdeck-fadester`), **Fadester Companion** (`streamdeck-fadester/tourbox`), and **Midi Fadester** (`midi-fadester`).

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

All implementations share the constants in `tests/vectors/tbar-safety.json` (`constants` and `tick_vectors`):

| Constant | Value | Meaning |
|---|---:|---|
| `slider_max` | `1023` | Integer range of OBS 33's `slider-tbar` (`0..1023`, `1024` steps). |
| `obs_finish_min_tick` | `921` | Minimum Qt slider tick at which `OBSBasic::TBarReleased()` completes (`1023 - 102`). Implementations write `1023` (`1.0`) to finish and verify read-back `>= 921` before trusting `release: true`. |
| `obs_cancel_max_tick` | `102` | Maximum Qt slider tick at which `OBSBasic::TBarReleased()` cancels (`1024 / 10`). Implementations write `0` (`0.0`) to cancel and verify read-back `<= 102` before trusting `release: true`. |
| `controller_rail_zone` | `0.03` | Normalized controller rail width: `<= 0.03` is the origin rail; `>= 0.97` is the target rail. |
| `midi_start_deadband` | `0.06` | Analog MIDI start band (`Idle -> Throwing` requires `> 0.06` normal or `< 0.94` reversed) so pot jitter near rest never opens a manual transition. Once `Throwing`, `(0.03, 0.06]` stays `Throwing` and aborts only at `<= 0.03`. |

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
- Leave OBS untouched (`transition_left_open = false` when refused from rest). Stream Deck may fall back cleanly to its `obs-websocket` / Studio Mode toggle path when refused before a native throw starts.

### 4.2 Uncertain write (write may or may not have landed)

Examples:
- Helper call times out, helper process exits or closes stdout mid-call, or helper reports `write unconfirmed` / `prior write unconfirmed` (`NativeTbarUncertain` / `NativeTbarTimeout` in Stream Deck; `IOException` / `InvalidOperationException` after helper dispatch in Companion).

**Required handling:**
- **Never replay the write** (`writes_replayed = 0`).
- Treat the slider position as unknown until reconciled by reading OBS's cursor and/or native slider (Section 5).

---

## 5. Target Recovery Ladder on Mid-Throw Helper Failure

When a native helper fails mid-throw (at 30%, 60%, 95%, or during release confirmation), the target suite recovery ladder is:

1. **Freeze input immediately.** Mark reconciliation active, stop movement writes, and drop any queued coalesced encoder/fader steps so stale deltas cannot reopen a closed blend.
2. **Read OBS's transition cursor (`GetCurrentSceneTransitionCursor`).**
   - If `cursor == 0` or `cursor == 1`, OBS has already finished or cancelled the blend. Clear throw state, refresh Program/Preview scene names, and **do not** toggle Studio Mode (OBS 33 reports `cursor == 1.0` at rest after a completed transition).
3. **Reconcile on the real slider if reachable (at most one release).**
   - If `release: true` has not yet been sent for this throw and a fresh native `read()` succeeds:
     - If `tick >= 921`, send one `SetTBarPosition { position: 1, release: true }`.
     - Else if `tick <= 102` and the operator was not explicitly taking, send one `SetTBarPosition { position: 0, release: true }`.
     - Else attempt **one** endpoint move (`1` when finishing/taking, `0` otherwise); if the confirmed read-back lands in `>= 921` or `<= 102`, send one matching `release: true`.
4. **Guaranteed close if still open (`0 < cursor < 1`).**
   - Re-read `GetCurrentSceneTransitionCursor`. If `0 < cursor < 1` (helper crashed, timed out, or slider remains stuck in `103..920`), close the open manual blend automatically via the **Studio Mode toggle take** (`SetStudioModeEnabled(false)` commits the blend cleanly in OBS, then `SetStudioModeEnabled(true)` restores Studio Mode and cues Preview).
   - **Acceptance:** OBS's Transition button is usable again within **2 seconds** with **zero operator action** (`transition_left_open = false`, `needs_operator_reset = false`).

> **Note (`DEC-1`):** Stream Deck implements Steps 1–4 today (`src/obs/direct-obs-client.ts:1339-1444`). Fadester Companion currently implements `Disarm()` (`needsReset = true`) without Step 4 (`tourbox/bridge/StudioFader.cs:434-457`); see Section 9.

---

## 6. Reconnect Policy

When an `obs-websocket` session connects or reconnects in Studio Mode:

1. Read `GetCurrentSceneTransitionCursor` twice across a short sampling window (`100..150 ms`).
2. **Moving cursor (`c1 != c2`):** OBS is running a timed transition of its own. **Leave it alone** (`leave_alone`).
3. **Motionless open cursor (`0 < c1 < 1` and `c1 == c2`):** an unattended manual T-bar blend is open in OBS.
   - **Target contract (`DEC-2`, pending owner alignment):**
     - Relative/stateful surfaces that can pick up at `c1` adopt the open blend (`adopt_open_throw`) so the next dial turn finishes or cancels it cleanly.
     - Surfaces whose physical control cannot represent a pre-existing mid-way throw (e.g., an unpulled spring-loaded trigger) must either adopt cleanly or cancel back to Program (`cancel_to_program`) without leaving the Transition button locked.

---

## 7. Physical Controller Disconnect Policy

If a physical controller disconnects while a manual T-bar throw is open (`0 < cursor < 1` / `MFD_TBAR_THROWING`):

- **Target contract (`DEC-4`, pending owner decision):** A controller loss must not leave OBS's manual transition open indefinitely. The surface should deterministically close the throw (`closed_idle` — either aborting cleanly to Program `pos = 0` + single release, or finishing if already in rail) and emit `state_changed`.

---

## 8. Process Identity and OBS Version Gate

Out-of-process UIA and Accessibility helpers must verify all of the following before touching any UI element:

1. **Supported OS:** `win32` (Windows UI Automation) or `darwin` (macOS Accessibility `AXUIElement`).
2. **Loopback WebSocket endpoint:** host is `127.0.0.1`, `localhost`, `::1`, or `[::1]`.
3. **Exact PID ownership:** the target process PID uniquely owns the listening TCP port of the authenticated `obs-websocket` connection (`GetExtendedTcpTable` on Windows, `lsof` on macOS). Never match by window title or foreground focus.
4. **Widget identity & range:** Qt slider identifier matches OBS 33's T-bar (`slider-tbar` / `SliderIgnoreScroll`), enabled, horizontal, integer range `0..1023`.
5. **OBS version gate (`DEC-3`, pending owner alignment):**
   - Target contract accepts OBS `33.x` (`/^33\.\d+\.\d+(\D|$)/`) while rejecting `< 33` and `>= 34` (where Qt widget layout has not been verified), backed by runtime widget identity/range validation on every attach.

---

## 9. Current Divergences Pending Owner Decision

Per the P0-5 rollout rule, existing runtime behavior in **Fadester Companion** and **Midi Fadester** was **not** altered in this pass. Each divergence below is encoded in `tests/vectors/tbar-safety.json` under `known_divergences` so all three test suites execute the vectors today and surface every pass and divergence visibly:

| ID | Scenario | Target Contract (`contract_expected`) | Stream Deck (`SD`) | Fadester Companion (`tourbox`) | Midi Fadester (`MF`) | Question for Owner |
|---|---|---|---|---|---|---|
| **`DEC-1`** | Native helper dies or fails mid-throw (`30%`, `60%`, `95%`) | Auto-close open fade via Studio Mode toggle fallback within 2 s; `transition_left_open = false`, `needs_operator_reset = false` | **Matches** (`direct-obs-client.ts:1339-1444`) | **Diverges** (`StudioFader.cs:434-457`): `Disarm()` sets `needsReset = true`, leaves manual transition open (`transition_left_open = true`), asks operator to press Cancel or drag slider | N/A (in-process Qt `slider-tbar`) | Should Companion adopt Stream Deck's automatic Studio Mode toggle finish when reconciliation cannot park the slider? *(Audit recommendation: yes.)* |
| **`DEC-2`** | Reconnect finds a motionless open manual fade (`0 < cursor < 1`) | `adopt_open_throw` | **Matches** (`direct-obs-client.ts:1074-1103`) | **Diverges** (`StudioFader.cs:79-107`): `ResumeAsync()` cancels a remembered sweep back to Program (`cancel_to_program`) | N/A (in-process lifetime matches OBS) | Should Companion keep `cancel_to_program` (because triggers are spring-loaded at `0`) and codify both per control type, or align with `adopt_open_throw`? |
| **`DEC-3`** | OBS version gate (`33.0.2`, `33.1.0`) | Accept all `33.x` (`true` for `33.0.0`, `33.0.1`, `33.0.2`, `33.1.0`; `false` for `32.1.0`, `34.0.0`) | **Matches** (`native-tbar.ts:70-75`) | **Diverges** (`StudioFader.cs:234,373`): accepts only `"33.0.0"` and `"33.0.1"` (`false` for `33.0.2`, `33.1.0`) | Compiled against OBS 33 `obs-frontend-api` + runtime `slider-tbar` range `[0, 1023]` check | Should Companion widen to `33.x` (relying on `NativeSlider` / `AXSlider` widget validation) or should Stream Deck narrow to explicitly rehearsed OBS 33 patch releases? |
| **`DEC-4`** | Physical USB MIDI controller unplugged mid-throw (`MFD_TBAR_THROWING` at `50%`) | Close open throw (`closed_idle`) so OBS's Transition button does not stay locked | N/A | N/A | **Diverges** (`mfd-engine.c:6448-6455`): `mfd_engine_poll_midi_health_on_ui_thread` marks device disconnected and emits `state_changed`, but leaves `fader_slots[i].tbar_state == MFD_TBAR_THROWING` (`remains_throwing`) | On USB MIDI loss mid-throw, should Midi Fadester abort to Program (`pos = 0` + release once, matching slot-config edits), finish to Preview, or hold? |

---

## 10. Running the Shared Vector Suites

- **Stream Deck (`SD`):** `npx vitest run tests/tbar-safety-vectors.test.ts` (included in `npm test`)
- **Fadester Companion (`tourbox`):** `dotnet run --project tourbox/tests/portable/FadesterCoreChecks.csproj` (pass `-- --strict-contract` to exit non-zero on recorded `DEC-1..3` divergences)
- **Midi Fadester (`MF`):** `ctest --test-dir build_x64 -R "test-tbar-logic|test-vendor-api" --output-on-failure` (set `MFD_STRICT_TBAR_CONTRACT=1` to exit non-zero on recorded `DEC-4` divergence)
