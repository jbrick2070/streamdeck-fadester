# Fadester Suite Setup (Windows x64)

One guided installer for any mix of the Fadester suite on Windows. It is built per
[docs/COMBINED-INSTALLER-DESIGN.md](../docs/COMBINED-INSTALLER-DESIGN.md) **Option B**: it runs each plugin's own standalone installer, so nothing is merged.

| Component | How it is installed | Uninstall |
| --- | --- | --- |
| Midi Fadester (includes Visual Sidechain since 0.9.0), Playlister | Each plugin's own released installer, run silently | Its own entry in **Installed apps**, as if installed alone |
| Fadester Companion | Its own installer (`FadesterCompanion.iss`), built from this repository | Its own **Fadester Companion** entry |
| Fadester for OBS (Stream Deck, OpenDeck; includes VJster) | The `.streamDeckPlugin` is staged and opened, so Stream Deck imports it itself. An optional task adds it to OpenDeck. | Removed inside Stream Deck or OpenDeck |
| VJster Chrome extension | Unpacked to `ProgramData\Fadester Suite\vjster-extension` for **Load unpacked** (the all-sites build; the Chrome Web Store copy is YouTube only and is not installed by setup) | **Fadester Suite shared files** entry |

Each component keeps its real version. The setup itself carries the release's number (the `version` in `package.json`, which is the tag's and Fadester for OBS's), for example `Fadester-Suite-Setup-1.5.0-Windows-x64.exe`. Up to 0.12.16 it was named by its build date.

## Languages

The setup and the Fadester Companion installer open in the Windows display language when it is one of the suite's 13 (English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese, Traditional Chinese), otherwise in English. They do not ask. `/LANG=de` (or `es`, `fr`, `it`, `ja`, `ko`, `nl`, `ptbr`, `ru`, `tr`, `zhcn`, `zhtw`, `en`) chooses one.

- English is in each script's `[CustomMessages]`. The other twelve are in `lang/<code>.isl`, one file per language for both scripts; `lang/languages.iss` lists them. `tests/companion-installer-languages.test.ts` fails when a language lacks a message or fills in different values.
- Inno Setup's own pages (Next, Install, Finish) come from its language files. It ships none for Chinese, so `lang/zh-CN-pages.isl` and `lang/zh-TW-pages.isl` translate the pages these setups show; a rare error message stays English there.
- The log (`/LOG=`) and its markers are English in every language.
- Midi Fadester's and Playlister's own installers run silently, so their language does not show.
- Written without a check against the programs themselves: the names of OBS's and Chrome's own menu items in each language (File > Exit, Tools, Sources, Developer mode, Load unpacked).

The last page offers **Open Fadester Companion** when this run installed it.

## Safety rules

- **OBS and the Companion are never closed for you.** If `obs64.exe` is running and a plugin is selected, setup stops before changing anything and asks you to close OBS. The same applies to Fadester Companion and OpenDeck.
- **No silent downgrades.** A component whose installed version is newer than the bundled one starts unticked, and is skipped even if it is selected. The same holds for the parts setup handles itself: a newer Fadester for OBS already in OpenDeck's plugins folder and a newer unpacked VJster extension are kept, and Stream Deck is not asked to import the bundled Fadester for OBS when it already holds a newer one (`SKIP-NEWER` in the log, and a line on the **Before you choose** page). Pass `/ALLOWDOWNGRADE` to override.
- **The signed-in person's settings, not the administrator's.** Setup runs as administrator. When a standard user types an administrator's name and password, the Store-edition check, the standalone-VJster check, the Marketplace-edition check and the OpenDeck copy use the folders and settings of the person who is signed in (`ORIGINAL-USER` in the log), not those of the administrator account. That person is the account that owns the desktop (Explorer) of the Windows session; if that cannot be asked, the account whose settings carry the session.
- **Ticked from what the PC has.** On a first run with the wizard on screen, setup looks for OBS Studio, for the Stream Deck app or OpenDeck, and for TourBox Console or a plugged-in game controller. What it does not find starts unticked (the OBS plugins, Fadester for OBS, Fadester Companion; the VJster extension when there is neither a deck app nor a controller), each with a line on the **Before you choose** page, and can be ticked again. A part of the suite that is already installed counts as found. When nothing at all is found, everything stays ticked. A silent run, `/COMPONENTS=` or `/TYPE=`, and a PC where Suite Setup ran before keep the choice already made (`DETECTED` and `PRETICK` in the log).
- **Microsoft Store edition.** If the Store's Fadester Companion (`Fluxxuuss.FadesterCompanion`) is installed, the standalone Companion starts unticked: two copies would fight over the OBS connection and VJster port 48150.
- **Elgato Marketplace edition of Fadester for OBS.** The Marketplace sells the same plugin under another ID (`com.jbrick2070.fadester-for-obs`), and Stream Deck holds the two IDs as two plugins. If Stream Deck has the Marketplace edition and not this setup's, setup does not ask Stream Deck to import its own copy and says so on the first and the last page: update the plugin in Stream Deck's Marketplace, or remove it there and run setup again. If Stream Deck has both already, setup handles its own copy as always and says on both pages that one of the two should be removed. The edition is known by its folder in Stream Deck when the folder has something in it (an empty folder is not a plugin); its version is shown when its manifest can be read (a Marketplace plugin can come with one that cannot). `/ALLOWDOWNGRADE` does not make setup add its copy beside a Marketplace edition: it is only about an older copy of this setup's own edition, also where both are there. A leftover folder with files in it that Stream Deck no longer lists still counts as the edition (not checked against a real removal in Stream Deck); delete that folder and run setup again. OpenDeck is not affected. Log markers: `MARKETPLACE-EDITION`, `BOTH-EDITIONS`.
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
- **Shipping a new plugin version.** Publish the plugin's release first, then run `node installer/update-pins.mjs --midi 0.9.0 --playlister 0.5.2 --sd 0.12.16` (name only what changed). It downloads each published file and rewrites its `version`, `file`, `url` and `sha256` in `components.json`.
- **Built from the commit.** With `-Candidate release\candidates\windows-macos` (the folder `node --import tsx scripts/suite/package-candidate.ts` writes), Fadester for OBS and the VJster extension in the setup are this commit's own build, checked against the hashes in its `CANDIDATE.json`, as Fadester Companion already is. Without it they are the pinned published files. Every setup the workflow builds uses `-Candidate`, so the `fadesterForObs` and `vjsterExtension` pins do not decide what a release's setup carries: they are what a build by hand without `-Candidate` downloads, and what the checksum test downloads to see that the pinned files still match (`tests/Test-Suite.ps1`, "build accepts the pinned inputs"). That is why `vjsterExtension` can sit behind the extension's own version (0.1.3 from release v0.11.0, while the extension went on to 0.1.6 and 1.5.0) without a wrong file in any release; the release it points to must stay published until the pin moves.
- **Releases.** Pushing a tag such as `v0.12.14` runs `.github/workflows/release.yml`, which builds the `.streamDeckPlugin`, the VJster extension zip, the Companion ZIP and its Store MSIX (version from `components.json`) into a **draft** release. The same tag runs `.github/workflows/suite-installer.yml`: it builds the suite setup from that commit, runs every test below on it, and only then attaches `Fadester-Suite-Setup-<version>-Windows-x64.exe` and its `.sha256` to that draft and puts a **Which file do I need?** table (by hardware) at the top of the release text. A manual run with `release_tag` does the same for an existing release. Nothing is published until someone tests the draft and publishes it.
- **Signing (optional).** Set `FADESTER_SIGN_CMD` to a signing command that uses `$f` for the file. With it, the Companion's executables, both uninstallers and both setups are signed. Without it, the build is unsigned. Unsigned setups trigger SmartScreen, so do not publish one widely until a certificate is chosen.

## Test

The **Fadester Suite Setup (Windows)** workflow (`.github/workflows/suite-installer.yml`) runs manually, for every version tag, and on pull requests that change the installer or what goes into it.

1. **Build.** One job builds the setup, plus one copy per guard with that guard switched off.
2. **End-to-end tests.** On a fresh runner, `tests/Test-Suite.ps1` really installs and uninstalls everything and checks:
   - checksum rejection
   - refusal while OBS runs (OBS is left running)
   - the Store-edition skip
   - each plugin keeping its own entry and version
   - the Companion's exact executable names
   - the downgrade guard
   - the VJster warning
   - the Elgato Marketplace edition of Fadester for OBS: no second copy beside it (also when its manifest cannot be read), the copy offered as always beside an empty folder, and both editions reported when both are there; what the last page says is read from the log
   - a newer Fadester for OBS in OpenDeck and a newer VJster extension kept, older ones replaced
   - clean per-component uninstall that keeps user settings
3. **Mutation runs.** Five more fresh runners run each guard test against the setup with that guard broken. Each run must report the failure, which proves the tests can catch a regression.

The tests refuse to run outside CI, because they install into `C:\ProgramData` and `Program Files`.

## Not verified yet

- **Ticking from what the PC has**: compiled, never run (the wizard is not shown in CI, where every run is silent). To check by hand on a PC where Suite Setup never ran: start setup with `/LOG=setup.log`; the **Before you choose** page must name each part that starts unticked, the components page must match it, and the log must have a `DETECTED:` line. Then run setup again: the page must not appear for that reason and the log must say `PRETICK: not applied`.
- **The Marketplace notes as pages.** CI reads them from the log of a silent run; nobody has yet seen the **Before you choose** page and the last page with a Marketplace edition of Fadester for OBS in Stream Deck. To check by hand: install the Marketplace edition (or copy a plugin folder to `%APPDATA%\Elgato\StreamDeck\Plugins\com.jbrick2070.fadester-for-obs.sdPlugin`), run setup, and read both pages; Stream Deck must not be asked to import anything.
- **The pages in each language.** Both scripts compile with all 13 languages (Inno Setup 6, placeholder inputs); nobody has yet read the wizard on a Windows set to each language.
- **A standard user elevating with an administrator's account** (`ORIGINAL-USER`): the CI runners sign in as one administrator, so this path has only been read, not run. To check it by hand: sign in as a standard user with OpenDeck or the Store edition of Fadester Companion, run setup with `/LOG=setup.log`, type an administrator's credentials, and read the first page and the log: `ORIGINAL-USER` must name the standard user's `AppData\Roaming` folder, not the administrator's, and no line `Could not ask who owns the desktop` should appear.
- **No real-PC run yet.** The CI runners have no OBS, Stream Deck or OpenDeck. So nobody has yet seen Stream Deck's own import, the OpenDeck task with OpenDeck itself, or the plugins loading in OBS after a suite install.
- **Code signing and Smart App Control** behaviour are untested until a certificate exists.
- **Pins wait for publication.** `components.json` pins Midi Fadester 0.9.0 and Fadester for OBS 0.12.16 (never pin 0.12.0 to 0.12.15: those stop at start in Stream Deck). Playlister 0.5.0 stays pinned: 0.5.2 stayed a draft and the next one published is 1.5.0. The pins are the last published files, so the setup built for a draft of release 1.5.0 carries that commit's own Fadester for OBS, VJster extension and Fadester Companion (all 1.5.0) beside the published Midi Fadester 0.9.0 and Playlister 0.5.0; it leaves a newer Midi Fadester or Playlister on the PC alone. Once the 1.5.0 releases are published, the pins move ([PUBLISHING.md](../PUBLISHING.md), "Version numbers at a release", step 8).
- **Visual Sidechain has no component any more.** It is part of Midi Fadester since 0.9.0. Midi Fadester's own installer removes an old separate Visual Sidechain; when Midi Fadester is not run (unticked, or a newer one is already installed), setup notes the old plugin (`OLD-VS`) on its first page and in its summary.
