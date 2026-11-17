# Fadester Suite Setup (Windows x64)

One guided installer for any mix of the Fadester suite on Windows. It is built per
[docs/COMBINED-INSTALLER-DESIGN.md](../docs/COMBINED-INSTALLER-DESIGN.md) **Option B**: it runs each plugin's own standalone installer, so nothing is merged.

| Component | How it is installed | Uninstall |
| --- | --- | --- |
| Midi Fadester, Visual Sidechain, Playlister | Each plugin's own released installer, run silently | Its own entry in **Installed apps**, as if installed alone |
| Fadester Companion | Its own installer (`FadesterCompanion.iss`), built from this repository | Its own **Fadester Companion** entry |
| Fadester for OBS (Stream Deck, OpenDeck; includes VJster) | The `.streamDeckPlugin` is staged and opened, so Stream Deck imports it itself. An optional task adds it to OpenDeck. | Removed inside Stream Deck or OpenDeck |
| VJster Chrome extension | Unpacked to `ProgramData\Fadester Suite\vjster-extension` for **Load unpacked** | **Fadester Suite shared files** entry |

Each component keeps its real version. The setup file is named by build date, for example `Fadester-Suite-Setup-2026.11.15-Windows-x64.exe`.

## Safety rules

- **OBS and the Companion are never closed for you.** If `obs64.exe` is running and a plugin is selected, setup stops before changing anything and asks you to close OBS. The same applies to Fadester Companion and OpenDeck.
- **No silent downgrades.** A component whose installed version is newer than the bundled one starts unticked, and is skipped even if it is selected. Pass `/ALLOWDOWNGRADE` to override.
- **Microsoft Store edition.** If the Store's Fadester Companion (`Fluxxuuss.FadesterCompanion`) is installed, the standalone Companion starts unticked: two copies would fight over the OBS connection and VJster port 48150.
- **Standalone VJster plugin.** If `com.jbrick2070.vjster.sdPlugin` is installed in Stream Deck or OpenDeck, setup warns. Fadester for OBS already includes VJster, and keeping both conflicts on port 48150.
- **User data is never deleted.** Uninstalling any component leaves these alone:
  - `%APPDATA%\obs-studio` (including `plugin_config` and scene collections)
  - `%LOCALAPPDATA%\FadesterTourBox`
  - Stream Deck and OpenDeck profiles
- **Portable OBS.** Not handled here. Use each plugin's `-Portable.zip`.

## Build

You need Windows, Inno Setup 6, and a finished `tourbox\build.ps1` run (its folder holds `build-complete.txt`).

```powershell
.\tourbox\build.ps1 -OutDir $env:TEMP\companion
.\installer\build-suite.ps1 -CompanionBuild "$env:TEMP\companion\build-<id>\Fadester Companion"
```

- **Pinned inputs.** Everything else comes from the releases pinned in [components.json](components.json), and each file is checked against its SHA-256. A mismatch stops the build.
- **Local builds.** `-LocalArtifacts <folder>` uses files from a folder instead of downloading them, but they must still match the pinned hashes.
- **Shipping a new plugin version.** Publish the plugin's release first, then run `node installer/update-pins.mjs --midi 0.7.2 --vs 0.7.2 --playlister 0.5.2 --sd 0.12.4` (name only what changed). It downloads each published file and rewrites its `version`, `file`, `url` and `sha256` in `components.json`.
- **Releases.** Pushing a tag such as `v0.12.4` runs `.github/workflows/release.yml`, which builds the `.streamDeckPlugin`, the VJster extension zip, the Companion ZIP and its Store MSIX (version from `components.json`) into a **draft** release. Nothing is published until someone tests the draft and publishes it.
- **Signing (optional).** Set `FADESTER_SIGN_CMD` to a signing command that uses `$f` for the file. With it, the Companion's executables, both uninstallers and both setups are signed. Without it, the build is unsigned. Unsigned setups trigger SmartScreen, so do not publish one widely until a certificate is chosen.

## Test

The **Fadester Suite Setup (Windows)** workflow (`.github/workflows/suite-installer.yml`) runs manually, and on pull requests that change the installer.

1. **Build.** One job builds the setup, plus one copy per guard with that guard switched off.
2. **End-to-end tests.** On a fresh runner, `tests/Test-Suite.ps1` really installs and uninstalls everything and checks:
   - checksum rejection
   - refusal while OBS runs (OBS is left running)
   - the Store-edition skip
   - each plugin keeping its own entry and version
   - the Companion's exact executable names
   - the downgrade guard
   - the VJster warning
   - clean per-component uninstall that keeps user settings
3. **Mutation runs.** Four more fresh runners run each guard test against the setup with that guard broken. Each run must report the failure, which proves the tests can catch a regression.

The tests refuse to run outside CI, because they install into `C:\ProgramData` and `Program Files`.

## Not verified yet

- **No real-PC run yet.** The CI runners have no OBS, Stream Deck or OpenDeck. So nobody has yet seen Stream Deck's own import, the OpenDeck task with OpenDeck itself, or the plugins loading in OBS after a suite install.
- **Code signing and Smart App Control** behaviour are untested until a certificate exists.
- **Pins wait for publication.** Until Midi Fadester 0.7.2, Visual Sidechain 0.7.2, Playlister 0.5.2 and Fadester for OBS 0.12.4 are published, `components.json` still pins the earlier releases.
