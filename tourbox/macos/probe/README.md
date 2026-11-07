# Read-only OBS native-slider probe

This development AppKit app reads Accessibility metadata for sliders belonging to
`com.obsproject.obs-studio` only. It does not write OBS controls, send WebSocket
commands, launch OBS, register shortcuts, automate settings, or grant permissions.

Build on a Mac with Swift/Xcode command-line tools already installed:

```sh
cd tourbox/macos/probe
/bin/bash build.sh
"build/Fadester Native Probe.app/Contents/MacOS/FadesterNativeProbe" --trust-status
```

The last command checks permission without a window, prompt, report, or OBS read.
To use the app interactively:

```sh
open "build/Fadester Native Probe.app"
```

Click **Request Accessibility…** only if needed, and complete any macOS permission
step manually. Click **Inspect OBS** to save and display a report. A denied grant
produces a report saying no OBS Accessibility tree was read. The stable bundle ID
is `io.github.jbrick2070.fadester-tourbox.native-probe`; ad-hoc rebuilds can still
require renewed permission. This app is not notarized or a shipping Mac product.

Reports go only to
`~/Library/Application Support/FadesterTourBox/NativeSliderProbe/latest.json`.
They contain trust state, OBS process IDs, and slider identifiers, roles, numeric
values/ranges, enabled/settable flags and bounded traversal diagnostics. They do
not collect arbitrary control text, other application trees, or credentials.

Inspection is limited to four OBS processes, 3,000 queued nodes, 30 levels and
eight seconds per tree, with a 250 ms Accessibility messaging timeout. Individual
AX calls can finish after the traversal deadline. A limit or unreadable subtree
means the report may be incomplete. `valueSettable` is a capability observation;
it does not prove that the T-bar responds or that a write would move the renderer.
