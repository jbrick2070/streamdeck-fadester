# Fadester Companion on the Mac

**Fadester Companion for Mac ships in every release**, next to the Windows Companion ZIP: `Fadester-Companion-macOS-arm64-<version>.zip` for Apple silicon and `Fadester-Companion-macOS-x64-<version>.zip` for Intel Macs. The version is Fadester Companion's in `installer/components.json`, the same as the Windows ZIP and the Store package. Each ZIP holds `Fadester Companion.app` (the AppKit panel, the self-contained .NET 8 `FadesterMacHost` and the native slider and shortcut helpers), the Mac TourBox preset `OBS Fadester for TourBox.tb`, the quick guide `START-HERE.html`, the read-me ([macos/panel/README.md](macos/panel/README.md)) and the license. There are two ZIPs rather than one universal app because the .NET single-file host cannot be merged with `lipo`.

The app is ad-hoc signed and **not notarized**. macOS will refuse to open it the first time. To allow it, right-click (or Control-click) the app and choose **Open**, then **Open** again; or try to open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.

## What is verified, and what still needs a real Mac

**Verified on GitHub's macOS runners, for both architectures, on every change and every release:** `tourbox/macos/package.sh` builds the complete app, packs the ZIP, extracts it again and, from the extracted app, checks the deep strict code signature and the architecture of every binary, then runs the panel's `--self-test`, the host's `--self-test`, both helpers' `--self-test` and the fake-OBS discovery check (`macos/panel/tests/discovery-server.mjs`: 12 authenticated read-only requests). The shared control logic, preset parity, helper protocols and fake-OBS host checks below run in the same job.

**Not yet verified, needs a real Mac:**
- Opening a downloaded copy past Gatekeeper, and the app window on screen (layout, the 10 panel languages, the Setup diagram).
- The Accessibility prompt and its attribution to the bundled native helper when the panel starts it.
- Physical TourBox control of OBS end to end (every modifier combination, the Tour menu, VJster and Layer 1/2 actions), and full native T-bar throws.
- Keychain: Fadester Companion keeps a typed OBS password in memory only and does not use the Keychain. The Fadester for OBS plugin's macOS Keychain save failed with `-25293` in the November test ([docs/CROSS-PLATFORM-CANDIDATE.md](../docs/CROSS-PLATFORM-CANDIDATE.md)) and is still unverified.

The rest of this page covers the CI checks and the hardware evidence gathered so far.

## Cloud builds

The workflow uses standard macOS 15 runners for both architectures:

| Runner | Architecture |
| --- | --- |
| `macos-15` | Apple Silicon / ARM64 |
| `macos-15-intel` | Intel / x64 |

GitHub provides these standard runners free for public repositories. This workflow does not use the paid larger-runner labels. See [GitHub’s runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories). Private forks have different billing rules.

The workflow, **Fadester Companion macOS core checks**, runs for relevant changes on `main` and pull requests into `main`. It also supports manual dispatch; the **Run workflow** button becomes available after the workflow is on the default branch.

Open the repository’s **Actions** tab, select that workflow and inspect both architecture jobs. The artifacts **FadesterCoreChecks-osx-arm64** and **FadesterCoreChecks-osx-x64** contain a `.tar.gz` with the test executable, preset map, developer README, license, runtime notices and source commit, plus a SHA-256 checksum file. The current workflow also places the optional grouped-mix CLI in a separately labeled `developer-mix-host` subfolder. These developer artifacts are retained for three days and are not product releases. The same jobs also upload **Fadester-Companion-macOS-osx-arm64** and **Fadester-Companion-macOS-osx-x64**, each holding the release ZIP (`Fadester-Companion-macOS-<arm64|x64>-<version>.zip`) and its `.sha256`, retained for seven days; the draft-release workflow builds the same ZIPs from the tag. Check the run’s commit and results before relying on it: the workflow definition alone is not passing test evidence.

**Verified November 4, 2026:** [CI run 41934438238](https://github.com/jbrick2070/streamdeck-fadester/actions/runs/41934438238), commit `7838b3d`, passed on both Apple Silicon and Intel. Each job ran the checks from source and again through its published native developer executable.

That run predates the expanded probe, mix-host, preset, native-slider, shortcut-input, action-host and full app checks. Check a current run for those.

## What the checks establish

The portable project compiles the shared production OBS connection, audio and whole-mix control logic, and Studio Mode fader state machine. It runs offline behavior checks and an authenticated loopback transport check against a fake OBS server. These exercise the real shared code without registering global shortcuts or operating a user’s OBS installation. The runner reports its operating system, process architecture and .NET version.

Passing these checks establishes that the included shared logic builds and its tests run on the named Mac architecture. It does not establish TourBox hardware input, a visible OBS slider, audible output, or a working Mac desktop application. The Windows-only integrations remain outside this portable target.

On November 4, 2026, the core checks also passed on an actual rented Apple Silicon Mac running **macOS 27.2** and **.NET 8.0.33**. With Accessibility permission, the read-only native probe in `tourbox/macos/probe` found one enabled, settable OBS Studio Mode slider with range 0–1023.

A separate developer write probe then exercised **OBS 33.0.1** with test scenes on that Mac. Accessibility writes **0 → 512 → 0** succeeded and read back correctly. Direct visual observation confirmed OBS’s native handle moving halfway, the Program picture fading to gray, and the reset. The zero write left OBS's transition cursor near 0.01; a guarded WebSocket release at zero returned it to zero and restored the original Program scene. The action host (then experimental) integrates a separate native helper; its full-endpoint behavior and physical TourBox control of OBS remain unverified.

Also verified on November 4, 2026: the FlexiHub free demo forwarded the physical TourBox USB device from Windows to the rented Mac. The Mac preset imported into TourBox Console and was linked to OBS. A count-only listener received one `preview.status` for a physical Scroll press and `fader.back` and `fader.forward` events from the Dial. These checks establish the individual input path; they do not establish that the physical controller operated OBS end to end, or that every combination works.

The Mac action host (then experimental) also passed a controlled real-OBS cancellation rehearsal on November 4. With streaming, recording, replay and virtual-camera outputs inactive, one stdin `fader.forward` command followed by one host `fader.cancel` command produced native slider readbacks **0 → 51 → 0**. An independent OBS connection observed the renderer settle at **0.0498046875** before cancellation; the test used a bounded read-only wait because the renderer can lag behind the native handle. The original Program and Preview scenes, source settings and transforms were verified restored, outputs stayed inactive, and the host reported a clean disarmed shutdown. The fixture used an empty Program scene and a gray Color source in Preview. Shortcut input and the whole-mix provider were disabled for this test.

This establishes the host's small native move and explicit cancellation path on that Mac, including permission for its actual helper launch. It does not establish full endpoints, return throws, sustained rotary performance, or physical TourBox control of OBS end to end. The separate hardware checks above were count-only. These November 4 results predate the released app and were not repeated with it.

The self-contained ARM64 `FadesterMixHost` also built and passed its shared mix/audio and authenticated fake-OBS transport tests on that Mac. Separate private-endpoint checks verified explicit opt-in, loopback validation, duplicate-owner rejection, configuration preservation, `quit` and SIGTERM shutdown. It resolves OBS settings under `~/Library/Application Support/obs-studio`, but these checks did not read the installed OBS credentials or operate real OBS. This is a headless grouped-input mix provider with no hotkeys or native T-bar control; see [its developer usage notes](macos/bridge/README.md).

## Run the checks locally

With the .NET 8 SDK installed, run from the repository root:

```sh
dotnet run --project tourbox/tests/portable/FadesterCoreChecks.csproj -- --map tourbox/presets/map.json
```

Use the preset map from the same checkout. In an extracted developer bundle, run `./FadesterCoreChecks`; without arguments it uses the bundled `presets/map.json`. `--map PATH` selects another map and `--help` describes usage. A failed assertion returns a nonzero exit code. The project is a test runner, not a background controller or installer.

## Work still needed on the Mac

- Rehearse the released app on a real Mac: Gatekeeper first open, the window, the Accessibility prompt, then VJster video control (Chrome extension and `/obs` Browser Source) and Layer 1/2 scene-item actions from the physical TourBox.
- Finish validating the Mac shortcut input and Mac preset, including modifier releases, menu actions, conflicts and shutdown behavior on physical hardware. Mac Console's acceptance of the Control+Shift and Option+Shift F-key chords in an imported preset is unproven, as mask 7 was before the 4 November check.
- Extend native T-bar rehearsal beyond the verified small move/cancel to full endpoints, return throws, operator interference and sustained physical rotary performance. The Windows UI Automation helper is separate.
- Developer ID signing and notarization, so the app opens without the Open Anyway step.
