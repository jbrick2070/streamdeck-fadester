# macOS development checks

The [Mac workflow](https://github.com/jbrick2070/streamdeck-fadester/actions/workflows/tourbox-macos.yml) is configured to build and run the shared Fadester control logic on GitHub-hosted Macs. Its output is a **developer core-check bundle**. A usable Fadester for TourBox Mac application is still to be built.

## Cloud builds

The workflow uses standard macOS 15 runners for both architectures:

| Runner | Architecture |
| --- | --- |
| `macos-15` | Apple Silicon / ARM64 |
| `macos-15-intel` | Intel / x64 |

GitHub provides these standard runners free for public repositories. This workflow does not use the paid larger-runner labels. See [GitHub’s runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories). Private forks have different billing rules.

The workflow, **TourBox macOS core checks**, runs for relevant changes on `main` and `codex/tourbox-macos-ci`, and pull requests into `main`. It also supports manual dispatch; the **Run workflow** button becomes available after the workflow is on the default branch.

Open the repository’s **Actions** tab, select that workflow and inspect both architecture jobs. The artifacts **FadesterCoreChecks-osx-arm64** and **FadesterCoreChecks-osx-x64** contain a `.tar.gz` with the test executable, preset map, developer README, license, runtime notices and source commit, plus a SHA-256 checksum file. They are retained for three days and are not product releases. Check the run’s commit and results before relying on it: the workflow definition alone is not passing test evidence.

## What the checks establish

The portable project compiles the shared production OBS connection, audio and whole-mix control logic, and Studio Mode fader state machine. It runs offline behavior checks and an authenticated loopback transport check against a fake OBS server. These exercise the real shared code without registering global shortcuts or operating a user’s OBS installation. The runner reports its operating system, process architecture and .NET version.

Passing these checks establishes that the included shared logic builds and its tests run on the named Mac architecture. It does not establish TourBox hardware input, a visible OBS slider, audible output, or a working Mac desktop application. The Windows-only integrations remain outside this portable target.

## Run the checks locally

With the .NET 8 SDK installed, run from the repository root:

```sh
dotnet run --project tourbox/tests/portable/FadesterCoreChecks.csproj -- --map tourbox/presets/map.json
```

Use the preset map from the same checkout. In an extracted developer bundle, run `./FadesterCoreChecks`; without arguments it uses the bundled `presets/map.json`. `--map PATH` selects another map and `--help` describes usage. A failed assertion returns a nonzero exit code. The project is a test runner, not a background controller or installer.

## Work still needed for a Mac application

- A Mac setup and activity interface to replace the Windows Forms panel, including local settings and credential handling.
- A Mac input layer for TourBox shortcuts, with tested permissions, conflict handling and shutdown behavior. The current listener uses Windows APIs; the Windows preset’s keyboard encoding also needs validation in Mac TourBox Console.
- A verified Mac integration that moves OBS’s real native T-bar and preserves its guards. The current helper uses Windows UI Automation. Passing the portable fader tests does not port that helper.
- Mac packaging, signing/notarization and installation instructions, followed by real OBS and physical TourBox rehearsal on the supported architectures.
