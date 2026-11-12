**Fadester: real-time OBS T-bar control — consolidated investigation and implementation proposal**

Prepared for the Fadester coding team on November 12, 2026. Scope: Stream Deck + dial control in streamdeck-fadester, with relevant existing work in midi-fadester and the Fadester Companion/TourBox code. This document consolidates the investigation and three supplied reports. It proposes changes; it does not record an implemented or production-qualified solution.

**1. The core interaction is possible in principle, but stock OBS 33.0.1 with WebSocket alone does not meet the complete contract.** The preferred route is an official OBS build containing the frontend T-bar correction, qualified with Fadester. The fallback worth investigating is a native Node-API accessibility addon loaded inside the Stream Deck plugin process. A separate executable is not technically necessary for that fallback. Neither architecture has been demonstrated here to satisfy every operating condition and the requirement that the operator never need recovery steps.

The product contract is a hand-controlled transition: each accepted dial movement changes the mix, stopping holds it, and reversing reverses it. OBS's own T-bar must follow. Completion must make the intended Next scene Program, preserve normal Preview behavior, and leave the transition controls usable. Both Program output and the OBS window must remain visually clean. No Midi Fadester or additional third-party OBS plugin may be required. Windows and macOS must each be qualified; a successful Windows result is not Mac certification.

Keep the existing working implementation available for its existing scope while developing and testing the replacement. Do not silently replace it with an unqualified native path. Equally, do not describe the existing Studio Mode toggle as satisfying the new no-flash contract.

| Question | Consolidated answer |
|---|---|
| Can current WebSocket requests, batches or hotkeys satisfy the complete contract? | No supported qualifying sequence has been identified on stock OBS 33.0.1. This is not a mathematical proof against every possible scene manipulation. |
| Can the existing Node process move the widget without a helper process? | Yes architecturally, through a packaged native Node-API library with UIA and AX implementations. Production behavior remains to be qualified. |
| Does an accessibility value write behave like a complete drag? | It drives movement through the normal value-change path, but does not itself generate release. A separate, ordered release is needed. |
| Can batching or Studio Mode options preserve the display during the toggle? | No supported display-preservation mechanism was found. The toggle destroys and recreates the display. |
| Can OBS itself be corrected? | Yes. The existing upstream PR addresses the precise mismatch; it is not yet merged or released as of this report. |
| What should ship? | Prefer the qualified fixed-OBS WebSocket path. Keep native accessibility experimental until it passes the complete platform and failure matrix. |

**2. Evidence has three different strengths.** Tagged source establishes control flow. Existing project records and operator recordings establish limited observations on named fixtures. Proposed implementation and recovery behavior remain hypotheses until tested.

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| OBS 33.0.1 tagged source and its bundled obs-websocket revision | Setter/release mismatch, normal release branches, hotkey paths and display lifetime | Frame-perfect behavior on a particular machine |
| Operator's 14/14 toggle takes | No old-scene frame in those Program recordings | A clean OBS window; the reported window flash remains a failure |
| Operator's cancel-then-Cut trials | An old-scene frame occurred in one of 14 supplied trials | A reliable alternate completion sequence |
| Recorded Mac AX fixtures | Visible native movement, rendered fading, readback and cancellation on the recorded Mac | Full takes, sustained dial performance, or the packaged Stream Deck integration |
| Fake OBS and helper tests already in the repository | Application sequencing, modeled failures and state management | Native accessibility, real rendering, permissions, or actual minimized-window support |
| Source-supported native endpoint sequence | A plausible route through OBS's normal completion code | A production guarantee or universal recovery mechanism |

The Mac record specifically documents OBS 33.0.1 accepting 0 → 512 → 0, and a separate small-movement cancellation rehearsal. It explicitly leaves full endpoints, return throws and sustained rotary use unverified. These are prior project records, not newly repeated tests. [Mac evidence, MACOS.md:32](C:/streamdeck-fadester/tourbox/MACOS.md:32)

**3. Two separate bugs must not be conflated.** The WebSocket release-argument bug was corrected in obs-websocket #1327. The frontend widget-position bug is OBS #11372. Closing the WebSocket issue does not establish that the OBS frontend correction is installed. OBS 33.0.1 bundles obs-websocket commit e28f84975984340e84fc4879cfc05741cc0afde1. [WebSocket fix #1327](https://github.com/obsproject/obs-websocket/pull/1327), [OBS issue #11372](https://github.com/obsproject/obs-studio/issues/11372)

| Verified source behavior | Consequence |
|---|---|
| The frontend setter calls TBarChanged directly; the getter reads the widget. | The mix can move while the visible slider and getter remain unchanged. |
| Movement clamps manual transition time to 0.01–0.99 and applies OBS's own easing. | An endpoint position request alone does not complete the transition. |
| Release reads the real 0–1023 widget. Values 0–102 cancel, 103–920 leave the transition open, and 921–1023 finish. | A WebSocket-controlled fade whose widget remains at zero cancels on release, even when the requested position is one. |

Sources: [OBSStudioAPI.cpp:110–123](https://github.com/obsproject/obs-studio/blob/33.0.1/frontend/OBSStudioAPI.cpp#L110-L123), [OBSBasic_Transitions.cpp:746–827](https://github.com/obsproject/obs-studio/blob/33.0.1/frontend/widgets/OBSBasic_Transitions.cpp#L746-L827), [slider bounds and signal connections:96–103](https://github.com/obsproject/obs-studio/blob/33.0.1/frontend/widgets/OBSBasic_StudioMode.cpp#L96-L103).

A small priming write such as 0.001 does not repair widget synchronization. Do not make mouse activation or a preliminary epsilon write a required operator ritual.

The exact upstream correction already exists in PR #13143: the frontend dispatches to a UI-thread slot that sets the widget value, allowing its existing signal to drive movement. Its current patch is eight added lines and one removed line across three files. Fresh GitHub metadata checked for this report shows it open and unmerged, with approval dated November 10, 2026 and another requested review pending. No release date or future version number is promised. OBS 33.0.1 remains the latest release checked. [PR #13143 and approval](https://github.com/obsproject/obs-studio/pull/13143#pullrequestreview-5848343503), [current setter patch:834–837](https://github.com/obsproject/obs-studio/blob/2786928e28c8b4ce7a1776fea2c2a60049082028/frontend/widgets/OBSBasic_Transitions.cpp#L834-L837), [OBS 33.0.1 release](https://github.com/obsproject/obs-studio/releases/tag/33.0.1)

The fixed setter also changes repeated-write behavior: Qt does not emit valueChanged when its bounded value and position already match. Do not assume the current fake server's unconditional movement semantics represent the corrected build. In particular, a release request still invokes release even if the preceding value write did nothing. Avoid unsolicited cancellation at idle, and test that case explicitly. Endpoint actions must not be treated as idempotent: repeating a finish after the slider has reset can start another throw. [Qt 6.10.1 setValue:466–490](https://github.com/qt/qtbase/blob/v6.10.1/src/widgets/widgets/qabstractslider.cpp#L466-L490), [WebSocket setter/release:304–333](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/requesthandler/RequestHandler_Transitions.cpp#L304-L333)

**4. None of the alternate request sequences is a qualified escape route.** Normal transition requests encounter the active-transition guard. Quick Transition is more complicated: it can replace the output transition before reaching that guard. The reports' suggestion that every quick hotkey is simply a harmless blocked operation is too broad. [Quick Transition:118–131](https://github.com/obsproject/obs-studio/blob/33.0.1/frontend/widgets/OBSBasic_Transitions.cpp#L118-L131)

The source supports a conditional Quick Cut snapback hazard, including an initially inactive Cut with Duplicate Scene disabled. The copied state includes child sources and their active-child flags, but not the complete running-transition state. This is a source prediction, not a measured universal outcome. Quick Cut is unsuitable as a guaranteed finish. [libobs state copy:1014–1052](https://github.com/obsproject/obs-studio/blob/33.0.1/libobs/obs-source-transition.c#L1014-L1052), [start path:327–382](https://github.com/obsproject/obs-studio/blob/33.0.1/libobs/obs-source-transition.c#L327-L382)

Request batches schedule existing operations; they do not create an atomic UI transaction. Vendor requests need a registered implementation and do not provide arbitrary access to OBS frontend functions. [Batch execution:164–229](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/requesthandler/RequestBatchHandler.cpp#L164-L229), [vendor dispatch:168–203](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/requesthandler/RequestHandler_General.cpp#L168-L203)

Studio Mode teardown destroys both the Program display and the T-bar's parent controls. Re-entry creates new objects. Duplicate Scene and Swap Preview/Program affect scene behavior; they do not preserve those objects. Consequently, batching cannot be advertised as a no-flash fix, and native element references must be invalidated after recreation. [OBSBasic_StudioMode.cpp:184–262](https://github.com/obsproject/obs-studio/blob/33.0.1/frontend/widgets/OBSBasic_StudioMode.cpp#L184-L262)

**5. Rank the architectures by the complete user contract, not by an unmeasured speed claim.**

| Rank | Architecture | Platforms and setup | Latency and reliability limits |
|---|---|---|---|
| 1 | Qualified fixed OBS plus ordinary WebSocket | Windows/macOS; update OBS; no accessibility permission or extra process | Fewest integration dependencies. Requires build-specific semantic and failure qualification. Network and OBS rendering latency remain. |
| 2 | In-process Node-API accessibility addon plus WebSocket release | Local Windows/macOS; prebuilt native libraries; Mac permission | Avoids helper startup and helper IPC. Native failures share Node's process, and OS calls may complete late. No measured latency guarantee. |
| 3 | Persistent bundled native helper plus WebSocket release | Local Windows/macOS with separate implementations and packaging | Native faults can be isolated, but IPC and helper lifecycle are added. Helper loss can still strand a fade. |
| Unsuitable for the full contract | Current toggle, cancel/Cut, timed transition, synthetic dragging | Coverage varies | Known visual failures, loss of manual behavior, or unqualified focus/coordinate dependence. |

A Node addon is a native library inside the plugin process. PowerShell, osascript and externally launched JXA are child processes, even when nothing custom is installed. A bundled helper can be one installation, but it does not satisfy the no-helper-process preference. Accessibility controls the local OS desktop, not an arbitrary remote WebSocket host. [Node addon architecture](https://nodejs.org/docs/latest-v24.x/api/addons.html), [Elgato Node configuration](https://docs.elgato.com/streamdeck/sdk/references/manifest/#nodejs)

**6. Keep user setup small and move complexity into qualification.** Proposed normal behavior is automatic selection of a qualified backend before a throw. Do not expose a routine UIA/AX/backend picker, ask users to calibrate screen coordinates, require first-touch activation, or make them choose between hidden recovery strategies.

For a qualified fixed OBS build, use the user's existing Fadester connection and dial configuration. No extra permission flow is needed. For an experimental native build, preflight local process identity and permission before accepting a throw. Provide one clear setup message if unavailable, and request Mac permission during setup rather than during rotation. Package binaries for every architecture claimed as supported; do not ask end users to compile them or install development runtimes.

For native access, ordinary medium-integrity Windows automation must not be assumed to control administrator OBS. Do not elevate the entire Stream Deck application automatically. On Mac, test the actual Stream Deck-launched process and signing identity, including upgrade/restart behavior. Permission granted to the old Swift helper does not prove the new addon works. Apple describes parent-chain attribution with exceptions; a separate helper does not necessarily get its own permission entry. [Microsoft UIA security](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview), [Apple responsibility guidance](https://developer.apple.com/forums/thread/805245)

Covered windows and multiple monitors should be tested independently from minimized/application-hidden windows. The latter remain unqualified: Qt's Mac bridge can filter invisible objects. Checking Qt 6.8.3 alone is not target-build verification for OBS 33, whose release notes removed support for Qt 6.4–6.9. Record the actual OBS/Qt versions in every native fixture. [Qt Cocoa accessibility:205–269](https://github.com/qt/qtbase/blob/v6.10.1/src/plugins/platforms/cocoa/qcocoaaccessibility.mm#L205-L269), [OBS release notes](https://github.com/obsproject/obs-studio/releases/tag/33.0.1)

Use concise ready, moving, settling and unavailable feedback. Show requested movement promptly, but do not represent unconfirmed commands as completed OBS state. Elgato's Marketplace guidelines require showAlert for unsuccessful actions, including dials. Rate-limit repeated alerts appropriately. Its visual-update guidance is not an OBS motion-rate limit. [Elgato feedback guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/#temporary-feedback)

**7. Preserve the working input path and separate backend selection from gesture state.** The following are concrete integration points, not instructions to rewrite the entire plugin.

| Current file/location | Existing behavior | Proposed change |
|---|---|---|
| [obs-fader-dial.ts:100](C:/streamdeck-fadester/src/actions/obs-fader-dial.ts:100) | Converts ticks into acceleration-aware deltas and calls nudgeTbar | Keep this contract; distinguish target position from confirmed position |
| [obs-fader-dial.ts:58](C:/streamdeck-fadester/src/actions/obs-fader-dial.ts:58) | 100 ms limiter controls dial visual feedback | Keep feedback throttling separate from motion dispatch |
| [direct-obs-client.ts:771](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:771) | Position writes, endpoint selection and current compatibility behavior | Route through an explicitly selected backend and shared throw controller |
| [direct-obs-client.ts:1867](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:1867) | Serial promise queue with control-generation checks | Bound pending movement; preserve generation checks after every await |
| [native-tbar.ts:24](C:/streamdeck-fadester/src/obs/native-tbar.ts:24) | Native read/move/close abstraction | Reuse as an adapter boundary; fixed WebSocket should have its own semantics |
| [direct-obs-client.ts:1071](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:1071) | Real-slider endpoint then WebSocket release | Retain sequencing and strengthen operation identity/uncertain-result handling |
| [direct-obs-client.ts:1038](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:1038) | Native park, scene and cursor confirmation | Keep native readback; add qualified fixed-WebSocket confirmation without requiring accessibility |
| [direct-obs-client.ts:1312](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:1312) | Existing Studio Mode toggle take | Preserve for existing compatibility scope; prohibit it inside a mode promising no flash |

Native control is currently disabled by default because loss of the helper during a partial fade can leave that fade open. Keep that default until a replacement passes qualification. [direct-obs-client.ts:304](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:304)

Use read-only version/build discovery to select a tested capability record. GetVersion.availableRequests proves that a request exists, not that #11372 is fixed. Do not guess a future minimum version such as 33.2, use an unrestricted greater-than check, or run a mutating capability probe against the operator's OBS. Unknown/custom builds remain unverified until tested. Pin the selected backend for the entire throw; an active native fade must never silently fall back to the toggle.

Existing Windows setter/identity code and Mac AX code are useful starting points for the native library, without adopting their host-process architecture. [NativeSlider.cpp:101](C:/streamdeck-fadester/tourbox/native/NativeSlider.cpp:101), [AXSlider.swift:145](C:/streamdeck-fadester/tourbox/macos/native/AXSlider.swift:145), [Mac adapter constraints](C:/streamdeck-fadester/tourbox/macos/native/README.md:82)

Keep blocking accessibility calls off Node's event loop. Use one long-lived serialized native worker; initialize Windows UIA on a dedicated COM MTA thread and keep its objects on that thread. Dispatch results back to Node with generation and sequence checks. [Microsoft UIA threading](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading)

**8. Make movement responsive through bounded ordering, not a timed transition.** Proposed dispatch has one outstanding movement operation and at most one latest pending absolute target. Accumulate accepted dial deltas in order before coalescing intermediate positions. Preserve reversal and endpoint intent. Once an accepted input crosses the configured take/cancel rail, latch that terminal operation and close movement admission; later pending targets cannot erase it or enter the next throw. Do not replay a long backlog after the operator stops or turns back.

Each throw should carry a session generation, throw identifier, backend identity, expected scene pair, selected and effective transition identities, command sequence and, for native access, process launch identity and widget identity. A per-scene override or OBS's manual Fade substitution can make the effective transition differ from the UI selection; resolve and validate that identity for lifecycle correlation. Maintain requested, dispatched and confirmed positions separately. A local ownership mechanism can prevent cooperating Fadester actions from competing, but it is not an OBS-wide lock and cannot exclude the operator or another controller. UIA/AX read-then-write is not atomic compare-and-swap.

| Proposed state | Allowed behavior |
|---|---|
| Unavailable | Observe and explain the unmet prerequisite; do not start a new throw |
| Ready | Qualified backend and reconciled idle state; accept a new deliberate movement |
| Moving/Holding | Apply ordered target changes; stopping holds indefinitely apart from OBS easing |
| Completing/Cancelling | Stop movement admission; execute the endpoint barrier once |
| Settling | Observe completion and prepare the intended next Preview |
| Unknown | An operation may have applied; stop additional writes and reconcile before rearming |

Do not add idle-time auto-release. Preserve existing rail behavior intentionally: current Fadester takes in the top 3%, cancels on a backward movement into the bottom 3%, and suppresses trailing ticks after a take. Those are existing product choices, separate from OBS's roughly 10% release zones. Retain them for compatibility initially; any change to exact-endpoint behavior needs explicit product testing. [direct-obs-client.ts:781](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:781), [backward rail:1131](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:1131)

The current settling window is a useful trailing-input guard, but elapsed time alone must not become proof that OBS finished. Define which fresh gesture starts the next throw, test it at real dial speeds, and ensure ticks queued before completion cannot become a second take.

**9. Completion needs an explicit barrier and more than a Program-name check.** OBS can report the destination as Program before the blend has visually finished. Widget reset and control unlock can also precede rendered completion because the renderer follows the transition target asynchronously. A cursor value alone is not a universal idle detector. [Frontend scene getter:57–64](https://github.com/obsproject/obs-studio/blob/33.0.1/frontend/OBSStudioAPI.cpp#L57-L64), [manual target and cursor implementation:393–472](https://github.com/obsproject/obs-studio/blob/33.0.1/libobs/obs-source-transition.c#L393-L472)

The proposed native finish sequence is:

1. Close admission for the current gesture and remove its pending movement targets.
2. Recheck the session, selected scene pair and actual control identity.
3. Move the native widget to 1023 and positively confirm the value.
4. Send exactly one SetTBarPosition request with position 1 and release true.
5. Reconcile native reset, intended Program, expected Preview policy and transition completion.
6. Mark the throw complete before accepting fresh input for another one.

Native cancellation follows the equivalent zero-position sequence only for an owned active throw. Movement itself uses accessibility; it should not also send redundant WebSocket movement writes on every tick. For the fixed-WebSocket backend, use position updates with release false and an ordered endpoint request with release true. Do not add accessibility merely to verify that backend at runtime.

The controller should correlate the release attempt with its expected scene pair, effective transition and connection generation, then combine lifecycle events with stable post-release reads. Events are evidence, not transactional receipts. Do not assume one strict order between Program/Preview changes, SceneTransitionEnded and SceneTransitionVideoEnded. Test missing, delayed and reordered delivery. Native reset checks are available only to native backends; the fixed-WebSocket backend relies on behavior established for its qualified build. Fixture testing must independently inspect the actual widget and button state. [WebSocket event wiring:173–177](https://github.com/obsproject/obs-websocket/blob/e28f84975984340e84fc4879cfc05741cc0afde1/src/eventhandler/EventHandler.cpp#L173-L177), [existing native confirmation](C:/streamdeck-fadester/src/obs/direct-obs-client.ts:1038)

Keep the active throw's destination distinct from a Preview selected for the next throw. Confirm behavior with Swap Preview/Program and Fadester auto-queue both on and off. Do not infer completion just because Program and Preview already have the same name.

**10. Unknown outcomes are the largest unresolved release risk.** A JavaScript timeout does not cancel a UIA/AX call already sent to OBS. A late native write can still apply. Generation checks prevent a late callback from advancing JavaScript state; they cannot undo an OS operation. Killing an in-process native thread is not a safe cancellation strategy.

| Failure | Required proposed response | Remaining qualification issue |
|---|---|---|
| Refusal positively known to precede this command's write | Before a throw, refuse admission. During an existing throw, stop further writes and reconcile the still-open transition | A refused latest command does not prove the previous transition is idle; distinguish no-write from unknown-write |
| Setter/release timeout or lost reply | Enter Unknown; stop new commands; do not replay the endpoint | Drain/quarantine pending work and reconcile actual state before another session |
| Widget recreation or OBS restart | Invalidate cached references and queued commands | Rediscovery must not resume a stale gesture |
| Unexpected manual move or scene change | Stop competing writes and reconcile ownership | No cross-process atomic ownership guarantee exists |
| Permission loss or WebSocket disconnect mid-fade | Preserve evidence and stop unsafe retries | Cleanup may be impossible; this is not automatically a passing recovery outcome |
| Graceful plugin shutdown | Attempt the agreed policy only while access and ownership are verified | Must be tested independently from abrupt termination |
| Forced termination | No cleanup promise | A dead process cannot send a release |

Do not compensate for an uncertain write by issuing a second write from another worker. Do not allow a new session until the old native operation has completed and state has been reconciled, or a verified new OBS process identity establishes that the old target no longer exists.

An automatic finish may take an unintended scene; an automatic cancel may restore an old scene. Therefore “always finish/cancel on disconnect” is not an adequate design. Node exit handlers cannot await asynchronous cleanup, and termination can bypass them. [Node exit semantics](https://nodejs.org/api/process.html#event-exit)

Safe refusal and an alert are necessary safeguards, but they do not satisfy the owner's no-recovery requirement after a transition is already stranded. If required failure cases cannot return to an acceptable state without operator intervention and without violating the visual contract, the native fallback does not pass release. The same failure matrix must be applied to the fixed-OBS path; the upstream patch repairs the mismatch, not every possible client failure.

**11. Qualification must measure the actual result, including user friction.** No per-tick timing numbers were measured in this investigation. Set response and reversal budgets before the fixture run, using the supported OBS frame rates and operator expectations. Report median, tail and worst-case latency rather than claiming that native calls or a helper are inherently fast enough.

Measure dial receipt, target calculation, dispatch, API completion, readback, visible slider response, rendered mix response and final completion. Record pending-command age, maximum backlog, coalesced inputs, direction changes and writes that arrive after timeout. Measure under representative OBS render load. Keep Stream Deck feedback update rate distinct from the motion-control rate.

| Test group | Required cases and acceptance evidence |
|---|---|
| Manual behavior | Fresh start, small moves, long hold, reversals, both rails, cancellation, repeated throws and a press-to-take path; no automatic run to the opposite rail after stopping, while allowing OBS's normal easing to the last requested target |
| Completion | Correct final Program/Preview policy, slider reset, Transition button usable, no queued second take |
| Visual correctness | Synchronized recordings of Program and OBS's window; no old-scene frame and no white/unpainted panel |
| Transition options | Fade baseline, supported manual transitions, scene overrides, Duplicate Scene and Swap combinations, auto-queue on/off |
| Window/platform | Windows and Mac separately; covered, minimized and hidden states separately; multiple monitors/DPI; each declared architecture |
| Permissions/packaging | Actual installed Stream Deck launch, first consent, restart, upgrade, denied/revoked Mac permission, Windows integrity mismatch |
| Ownership | Mouse interaction, another cooperating dial, another OBS controller, scene/transition changes during a throw |
| Faults | Delayed reads/writes, uncertain replies, transport loss, OBS restart, Studio Mode recreation, addon/helper failure and forced plugin termination |
| Compatibility | Existing legacy behavior preserved; fixed and faulty frontend semantics both represented in tests; unknown builds not auto-certified |

Fifty clean takes are a useful initial smoke test, not proof of zero failures. Run a declared repeated-operation/soak and fault-injection suite on both platforms, retain recordings and environment manifests, and record every failure. Passing Windows plus accepting a Mac permission prompt is not a Mac release gate.

Extend the existing tests rather than replacing their faulty-frontend model globally:

- [native-tbar.test.ts:163](C:/streamdeck-fadester/tests/native-tbar.test.ts:163): native endpoint ordering, parked readback and absence of toggle.
- [tbar-recovery.test.ts:61](C:/streamdeck-fadester/tests/tbar-recovery.test.ts:61): restart/open-fade state and misleading early Program naming.
- [scene-cycle.test.ts:80](C:/streamdeck-fadester/tests/scene-cycle.test.ts:80): retain compatibility coverage.
- [scene-cycle.test.ts:313](C:/streamdeck-fadester/tests/scene-cycle.test.ts:313): existing restore-exhaustion case demonstrates why a fallback cannot be advertised as infallible.

Add meaningful tests for bounded backlog and reversal, late native application after timeout, repeated endpoint commands, idle release, stale-generation events, backend loss, strict no-toggle behavior and selected-next-scene preservation. A fake test described as “minimized” does not establish actual minimized-window support.

**12. Deliver in stages, with a decision after each stage.**

| Stage | Deliverable | Exit condition |
|---|---|---|
| A: evidence and fixtures | Version/commit manifest, source references, separate faulty/fixed fake semantics, isolated OBS fixtures | Reproduce the current mismatch and establish trustworthy visual capture |
| B: fixed-OBS qualification | Exercise the existing upstream patch with a minimal test-only protocol harness or injectable Fadester backend, without a new fork/branch | Manual behavior, both endpoints, ordering and initial failure tests pass on both platforms |
| C: controller separation | Backend selection, throw identity, bounded motion dispatcher and endpoint barrier behind a development gate | Existing compatibility tests and new semantic tests pass; repeat the fixed-path fixtures end to end through the integrated Fadester controller |
| D: native contingency, only if needed | Mac-first Node-API proof, then Windows; reuse existing identity/setter code | Full take/cancel and actual launch permissions established, not just widget movement |
| E: platform/failure qualification | Recordings, latency distributions, fault matrix and documented supported configurations | No unresolved failure violating the required operator contract |
| F: release and rollback | Enable only qualified builds/configurations at idle; retain compatibility handling for its existing scope | No silent backend switch during a throw; upgrade and rollback behavior verified |

Prefer an upstream-provided test artifact when available. Do not install an experimental OBS build over the operator's live setup. A development implementation can prepare the fixed-backend route before an official release, but production availability still depends on an eligible OBS build. Do not make the native contingency a prerequisite for a helper-free fixed-OBS release.

The OBS patch is small; elapsed upstream release time is unknown. The earlier one-to-two-week estimate is only a provisional allowance for focused integration and qualification with ready fixtures. It is not a delivery commitment for signing, Mac permission work, native failure recovery or upstream release. Re-estimate after the first end-to-end Mac fixture and fault tests.

**13. Submission policies do not require abandoning the preferred route.** OBS requires content submitted to its project to be human written. This investigation needs no upstream submission: the existing human-authored patch can be evaluated, and an official release can later be consumed. Do not contact CodeYan01. No upstream contact was made. [OBS contribution policy](https://github.com/obsproject/obs-studio/blob/fe1ed7955f300efd17fc59f65938388e43d8bb06/CONTRIBUTING.md#L126-L138)

Marketplace distribution requires its normal review. The cited guidelines do not establish a special prior-approval requirement for a private native experiment, and Elgato also documents direct plugin distribution. Verify signing and packaging in the actual target environment; do not claim that one helper signature resolves permissions or guarantees acceptance. [Elgato distribution](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/)

**14. The team's immediate decision is whether to qualify the existing upstream fix before investing in another control mechanism.** The recommendation is yes. Prepare the shared controller safeguards and regression fixtures, qualify the fixed-WebSocket path, and pursue the native addon only if an interim delivery need justifies its additional lifetime and permission risks.

The unresolved items are explicit: release availability of the OBS correction; full Mac endpoint and sustained-input proof; actual addon launch permissions; supported hidden/minimized behavior; measured responsiveness; and safe outcomes after loss of control mid-transition. Until those are resolved, the feature can be described as feasible and under qualification, not recovery-free.

This investigation inspected source and existing records. It did not connect to live or test OBS, read or use the operator's WebSocket password, execute new runtime tests, recursively delete a test folder, create a fork/branch, change implementation, or contact upstream. Only this report was added to the current main checkout. Future testing must use fake or isolated test OBS, keep production credentials untouched, preserve test artifacts, and remain on the owner's single-branch workflow.
