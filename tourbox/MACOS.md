# macOS development checks

The [Mac workflow](https://github.com/jbrick2070/streamdeck-fadester/actions/workflows/tourbox-macos.yml) is configured to build and run the shared Fadester control logic on GitHub-hosted Macs. Its output is a **developer core-check bundle**. A usable Fadester for TourBox Mac application is still to be built.

> **Status, 2026-11-12.** Everything under `tourbox/macos/` and `tourbox/presets/macos/` is experimental. The Mac preset generator, Mac preset, Mac shortcut helper, Mac action host and Mac setup panel follow the unified master map: `FadesterMacHost` hosts the loopback VJster link (serving both the Chrome `VJster` extension and the bundled `/obs` YouTube Browser Source page so TourBox users never need Midi Fadester), and `macos/panel` configures VJster port/target/extension-pin/OBS-URL copy as well as Layer 1 & Layer 2 scene-item assignments and opacity step. Physical rehearsal of every modifier combination on Mac hardware remains in progress.

## Cloud builds

The workflow uses standard macOS 15 runners for both architectures:

| Runner | Architecture |
| --- | --- |
| `macos-15` | Apple Silicon / ARM64 |
| `macos-15-intel` | Intel / x64 |

GitHub provides these standard runners free for public repositories. This workflow does not use the paid larger-runner labels. See [GitHub’s runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories). Private forks have different billing rules.

The workflow, **TourBox macOS core checks**, runs for relevant changes on `main` and pull requests into `main`. It also supports manual dispatch; the **Run workflow** button becomes available after the workflow is on the default branch.

Open the repository’s **Actions** tab, select that workflow and inspect both architecture jobs. The artifacts **FadesterCoreChecks-osx-arm64** and **FadesterCoreChecks-osx-x64** contain a `.tar.gz` with the test executable, preset map, developer README, license, runtime notices and source commit, plus a SHA-256 checksum file. The current workflow also places the optional grouped-mix CLI in a separately labeled `developer-mix-host` subfolder. These artifacts are retained for three days and are not product releases. Check the run’s commit and results before relying on it: the workflow definition alone is not passing test evidence.

**Verified November 4, 2026:** [CI run 41934438238](https://github.com/jbrick2070/streamdeck-fadester/actions/runs/41934438238), commit `7838b3d`, passed on both Apple Silicon and Intel. Each job ran the checks from source and again through its published native developer executable.

That run predates the expanded probe, mix-host, preset, native-slider, shortcut-input and action-host checks. The current workflow changes have not yet been run in GitHub Actions; their presence in the workflow is not evidence that either CI job has passed.

## What the checks establish

The portable project compiles the shared production OBS connection, audio and whole-mix control logic, and Studio Mode fader state machine. It runs offline behavior checks and an authenticated loopback transport check against a fake OBS server. These exercise the real shared code without registering global shortcuts or operating a user’s OBS installation. The runner reports its operating system, process architecture and .NET version.

Passing these checks establishes that the included shared logic builds and its tests run on the named Mac architecture. It does not establish TourBox hardware input, a visible OBS slider, audible output, or a working Mac desktop application. The Windows-only integrations remain outside this portable target.

On November 4, 2026, the core checks also passed on an actual rented Apple Silicon Mac running **macOS 27.2** and **.NET 8.0.33**. With Accessibility permission, the read-only native probe in `tourbox/macos/probe` found one enabled, settable OBS Studio Mode slider with range 0–1023.

A separate developer write probe then exercised **OBS 33.0.1** with test scenes on that Mac. Accessibility writes **0 → 512 → 0** succeeded and read back correctly. Direct visual observation confirmed OBS’s native handle moving halfway, the Program picture fading to gray, and the reset. The zero write left OBS's transition cursor near 0.01; a guarded WebSocket release at zero returned it to zero and restored the original Program scene. The experimental action host now integrates a separate native helper, but its full-endpoint behavior and physical TourBox control of OBS remain unverified; the complete Mac application is still pending.

Also verified on November 4, 2026: the FlexiHub free demo forwarded the physical TourBox USB device from Windows to the rented Mac. The Mac preset imported into TourBox Console and was linked to OBS. A count-only listener received one `preview.status` for a physical Scroll press and `fader.back` and `fader.forward` events from the Dial. These checks establish the individual input path; they do not establish that the physical controller operated OBS end to end, or that every combination works.

The experimental Mac action host also passed a controlled real-OBS cancellation rehearsal on November 4. With streaming, recording, replay and virtual-camera outputs inactive, one stdin `fader.forward` command followed by one host `fader.cancel` command produced native slider readbacks **0 → 51 → 0**. An independent OBS connection observed the renderer settle at **0.0498046875** before cancellation; the test used a bounded read-only wait because the renderer can lag behind the native handle. The original Program and Preview scenes, source settings and transforms were verified restored, outputs stayed inactive, and the host reported a clean disarmed shutdown. The fixture used an empty Program scene and a gray Color source in Preview. Shortcut input and the whole-mix provider were disabled for this test.

This establishes the host's small native move and explicit cancellation path on that Mac, including permission for its actual helper launch. It does not establish full endpoints, return throws, sustained rotary performance, or physical TourBox control of OBS end to end. The separate hardware checks above were count-only. These components remain experimental and are not a finished or released Mac application.

The self-contained ARM64 `FadesterMixHost` also built and passed its shared mix/audio and authenticated fake-OBS transport tests on that Mac. Separate private-endpoint checks verified explicit opt-in, loopback validation, duplicate-owner rejection, configuration preservation, `quit` and SIGTERM shutdown. It resolves OBS settings under `~/Library/Application Support/obs-studio`, but these checks did not read the installed OBS credentials or operate real OBS. This is a headless grouped-input mix provider with no hotkeys or native T-bar control; see [its developer usage notes](macos/bridge/README.md).

## Run the checks locally

With the .NET 8 SDK installed, run from the repository root:

```sh
dotnet run --project tourbox/tests/portable/FadesterCoreChecks.csproj -- --map tourbox/presets/map.json
```

Use the preset map from the same checkout. In an extracted developer bundle, run `./FadesterCoreChecks`; without arguments it uses the bundled `presets/map.json`. `--map PATH` selects another map and `--help` describes usage. A failed assertion returns a nonzero exit code. The project is a test runner, not a background controller or installer.

## Work still needed for a Mac application

- Validate VJster video control (Chrome extension and `/obs` Browser Source) and Layer 1/2 scene-item actions end to end from the physical TourBox on Mac hardware.
- Finish validating the experimental Mac shortcut input and Mac preset, including modifier releases, menu actions, conflicts and shutdown behavior on physical hardware. Mac Console's acceptance of the Control+Shift and Option+Shift F-key chords in an imported preset is unproven, as mask 7 was before the 4 November check.
- Extend native T-bar rehearsal beyond the verified small move/cancel to full endpoints, return throws, operator interference and sustained physical rotary performance. The Windows UI Automation helper is separate.
- Mac packaging, signing/notarization and installation instructions, followed by real OBS and physical TourBox rehearsal on the supported architectures.
