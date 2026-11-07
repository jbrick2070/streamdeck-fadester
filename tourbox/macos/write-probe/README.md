# Explicit native OBS write proof

This separate development app attempts exactly two user-triggered operations:
set the identified native OBS T-bar to 512, then reset it to 0. It does not change
the existing read-only probe or reuse its Accessibility authorization.

Build only (no launch, permission prompt or OBS access):

```sh
cd tourbox/macos/write-probe
/bin/bash build.sh
```

When the operator is ready, launch `build/Fadester Native Write Probe.app`.
Use **Request Accessibility…** and grant this separate app permission manually
through macOS. Its bundle ID is
`io.github.jbrick2070.fadester-tourbox.native-write-probe`. Ad-hoc rebuilds can
require renewed permission. No TCC bypass or automatic grant is provided.

Use only a disposable OBS instance with streaming and recording stopped and
Studio Mode active. The probe does not connect to OBS WebSocket, so the operator
must verify these conditions independently. Place OBS's native T-bar at zero.
Click **Inspect / arm at 0**, check the reported process, then **Set 512**. Observe
the actual OBS handle and renderer independently. Click **Reset 0** explicitly.
It never sends a release/commit, endpoint 1023, keypress or automatic reset.
An AXValue readback alone does not prove that the renderer followed it.

Every attempt re-enumerates only OBS's AX tree and requires exactly one running
OBS process and one OBS window, the full identifier
`OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll`, slider
role, enabled/settable state, exact range 0..1023, original process launch identity,
original window and slider identities, and expected starting value. Traversal is
bounded and an incomplete traversal disarms writes. Values are read again just
before and after setting. AX has no compare-and-swap: an external change in the
final read/write interval remains possible, so do not touch OBS during the proof.

There is no command-line write mode or automatic retry. Any error or mismatch
disarms subsequent writes; if a failed call moved OBS, reset it with OBS's own
controls. Closing the app also leaves OBS unchanged. The original read-only app
has no helper-launch interface; adding one would change its signed bundle, so
this proof deliberately requires its own normal permission grant.

Results and numeric AX error codes are saved only to
`~/Library/Application Support/FadesterTourBox/NativeSliderWriteProbe/latest.json`
and `history.jsonl`. Intent is persisted before a write; reports include the exact
requested value, attempted status, readback and identity metadata. No arbitrary
window text, other-app tree or credentials are collected.
