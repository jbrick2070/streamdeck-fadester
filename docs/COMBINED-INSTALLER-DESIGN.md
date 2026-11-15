# Combined Windows Installer for the Three OBS Plugins — Design Note

> **STATUS (2026-11-15): Option B is built.**
>
> - **Where:** [`installer/`](../installer/README.md) holds the build, and `.github/workflows/suite-installer.yml` runs the tests (manual only).
> - **Toolchain:** chaining is done in Inno Setup Pascal rather than WiX Burn, so no new toolchain is added. The properties Option B asks for are kept: each plugin's own AppId, real version, standalone upgrades and individual uninstall.
> - **Companion:** Fadester Companion gained its own standalone installer for the suite to chain.
> - **Still open:** code signing, and a run on a real PC with OBS, Stream Deck and OpenDeck (see the installer README).
> - **History:** the analysis below is unchanged from the original design note.

---

## 1. Current state (verified in repository code)

All three OBS Studio 33 plugins build separate Inno Setup installers from near-identical templates (`cmake/windows/resources/installer-Windows.iss.in`) driven by each repository's `buildspec.json`:

| Plugin | Repository & current `buildspec.json` version | Inno Setup `AppId` (`uuids.windowsApp`) | Install directory (`DefaultDirName`) | Installer template |
|---|---|---|---|---|
| **Midi Fadester** | `jbrick2070/midi-fadester` (`0.6.0`, `buildspec.json:39-47`) | `{8F4A92C1-5B3E-4D17-9A62-3C8E71D40F59}` | `{commonappdata}\obs-studio\plugins\midi-fadester` | `MF/cmake/windows/resources/installer-Windows.iss.in:7-29` |
| **Visual Sidechain** | `jbrick2070/visual-sidechain` (`0.6.0`, `buildspec.json:36-44`) | `{7C4A92E8-4B19-4F03-9A56-3D8E21B05C7F}` | `{commonappdata}\obs-studio\plugins\visual-sidechain` | `VS/cmake/windows/resources/installer-Windows.iss.in:11-32` |
| **Playlister** | `jbrick2070/obs-playlister` (`0.5.0`, `buildspec.json:36-44`) | `{E1214DB1-63FD-4CB4-84CE-825EF8D2C21D}` | `{commonappdata}\obs-studio\plugins\obs-playlister` | `PL/cmake/windows/resources/installer-Windows.iss.in:11-32` |

Key facts verified from those files:

1. `{commonappdata}\obs-studio\plugins\<plugin-name>` resolves on standard Windows installs to `C:\ProgramData\obs-studio\plugins\<plugin-name>\` (`bin\64bit\<plugin>.dll` and `data\...`), which is OBS Studio's standard machine-wide third-party plugin path (`DisableDirPage=yes` in all three `.iss.in` files).
2. Writing to `C:\ProgramData\` requires administrator elevation (one UAC prompt per unsigned/signed installer executable), and none of the three standalone installers are currently Authenticode-signed (`SD/PUBLISHING.md:13`, `SUITE-AUDIT-2026-11-14.md:316`).
3. Each plugin remains an independent binary with its own release cadence and version (`SUITE-AUDIT-2026-11-14.md:66` — *"A combined installer is fine (P1-5); a combined binary is not"*). Standalone per-plugin installers must continue to ship for users who want or update a single plugin.

---

## 2. Architecture options

### Option A — Single Inno Setup multi-component installer (`[Components]`)

One Inno Setup script (`Fadester-OBS-Plugins-Setup.exe`) with its own suite `AppId` GUID and three `[Components]` checkboxes:

- `[x] Midi Fadester <mf_version>` -> `{commonappdata}\obs-studio\plugins\midi-fadester`
- `[x] Visual Sidechain <vs_version>` -> `{commonappdata}\obs-studio\plugins\visual-sidechain`
- `[x] Playlister <pl_version>` -> `{commonappdata}\obs-studio\plugins\obs-playlister`

**Pros:**
- Uses the exact same Inno Setup tool (`iscc.exe`) already present on `windows-latest` GitHub Actions runners and already used by all three OBS plugin repos.
- Native single wizard with component checkboxes, disk-space readout, single UAC elevation prompt, and built-in `CloseApplications` / mutex handling if `obs64.exe` has a plugin `.dll` locked.
- Only one outer `.exe` (plus the three plugin `.dll` binaries inside) needs to be signed.

**Cons & edge cases that must be handled explicitly:**
- **Dual uninstaller registration hazard:** If a user first installs **Midi Fadester `0.6.0`** via the combined installer and later upgrades to **Midi Fadester `0.6.1`** via its standalone installer, Windows **Installed apps** will have *two* entries (`Fadester OBS Plugins` and `Midi Fadester`), both pointing at files under `C:\ProgramData\obs-studio\plugins\midi-fadester\`. Uninstalling the older combined entry later could delete the newer standalone `0.6.1` files unless guarded.
- **Component deselection on re-run:** By default in Inno Setup, unchecking an already-installed `[Components]` item on a re-run does *not* delete its files unless `[InstallDelete]` is authored (which we should **not** do automatically).

### Option B — WiX Burn bootstrapper bundle chaining the three standalone installers

One WiX Toolset (`WixToolset.BootstrapperApplication`) bundle executable (`Fadester-OBS-Plugins-Bundle.exe`) that embeds or downloads the three exact standalone Inno Setup installers (`midi-fadester-<ver>-Windows-Installer.exe`, `visual-sidechain-<ver>-Windows-Installer.exe`, `obs-playlister-<ver>-Windows-Installer.exe`) and runs the selected ones silently (`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`) under a single elevated transaction.

**Pros:**
- **Zero conflict with standalone upgrades or uninstalls:** Every plugin is still installed and registered under its own existing Inno Setup `AppId` (`{8F4A92C1-...}`, `{7C4A92E8-...}`, `{E1214DB1-...}`). Upgrading **Visual Sidechain** later with its standalone `.exe` upgrades that exact `AppId` cleanly, and each plugin can still be uninstalled individually from **Installed apps**.
- Each plugin manifestly keeps its own version number in Windows **Installed apps** without a synthetic "suite version" pretending all three plugins share one semver.
- Single UAC prompt and single SmartScreen download gate for the outer bundle.

**Cons:**
- Adds WiX v4/v5 (`dotnet tool install --global wix`) to the release build pipeline alongside Inno Setup.
- Both the outer Burn bundle `.exe` (plus Burn engine via `wix burn detach` / `reattach`) *and* the three inner standalone `.exe` installers (plus the three `.dll` files) must be Authenticode-signed if signing is enabled.

### Option C — Keep standalone installers only (status quo + `START-HERE.md` links)

Do not ship a combined installer; rely on `docs/START-HERE.md` to tell each user which 1–3 plugins their hardware actually needs.

**Pros:** Zero new build/release surface, zero dual-uninstaller edge cases.
**Cons:** A user installing all three OBS plugins clicks through three browser downloads, three SmartScreen prompts (while unsigned), and three UAC prompts.

---

## 3. Versioning, upgrade, and uninstall rules (required whichever option is chosen)

1. **Each plugin keeps its own version.**
   - Never assign a shared version to the plugins themselves. If a combined installer filename needs an identifier, use a date stamp or manifest tag (for example `Fadester-OBS-Plugins-2026.11-Windows-x64.exe`) and display each embedded plugin's exact `buildspec.json` version next to its checkbox (`Midi Fadester 0.6.0`, `Visual Sidechain 0.6.0`, `Playlister 0.5.0`).
2. **Never downgrade a newer standalone install silently.**
   - Before overwriting `{commonappdata}\obs-studio\plugins\<name>\bin\64bit\<name>.dll`, compare the target DLL's `PE FileVersion` (or existing Inno Setup `DisplayVersion` under `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\{<UUID_APP>}_is1`) against the bundled plugin version. If the installed plugin is **newer** than the version inside the combined installer, skip that component by default and say why (`Midi Fadester 0.7.0 is already installed; bundled version is 0.6.0`).
3. **Independent uninstall without collateral loss.**
   - Uninstalling one plugin must remove only `C:\ProgramData\obs-studio\plugins\<that-plugin>\` and never touch the other two plugin folders.
   - Uninstalling **never** deletes user settings, scene collections, shader files outside the plugin `data\` folder, whole-mix journals, or `%APPDATA%\obs-studio\plugin_config\`.
   - Under **Option B (WiX Burn)**, independent per-plugin `AppId` entries come for free (`Visible="yes"` on each `ExePackage` in the Burn `Chain`). Under **Option A (Inno Setup)**, the combined installer would need custom Pascal `[Code]` to invoke existing standalone uninstallers or refuse to remove directories whose installed version differs.
4. **OBS running check (`obs64.exe`).**
   - Because Windows locks loaded plugin `.dll` files while OBS Studio is open, the installer must check whether `obs64.exe` is running before copying files and ask the user to close OBS cleanly (never force-kill `obs64.exe`, which could interrupt a live stream or recording).
5. **Portable OBS mode awareness.**
   - `{commonappdata}\obs-studio\plugins\` works for standard OBS Studio installs. Users running OBS in `portable_mode` need plugins extracted into `<OBS-folder>\obs-plugins\64bit\` + `<OBS-folder>\data\obs-plugins\<name>\`; keep the standalone `.zip` release artifacts alongside any installer for portable OBS setups.

---

## 4. Windows SmartScreen, Smart App Control, and code signing

1. **Unsigned installer behavior on Windows 10/11:**
   - Downloading an unsigned `.exe` from GitHub Releases marks it with Mark-of-the-Web (`Zone.Identifier`), triggering Microsoft Defender SmartScreen (*"Windows protected your PC — Unknown publisher"*). Combining three unsigned installers into one reduces three SmartScreen + UAC prompts to one, **but** SmartScreen still blocks the unsigned `.exe` behind *"More info -> Run anyway"*.
2. **Windows 11 Smart App Control (SAC) and plugin `.dll` files:**
   - On Windows 11 machines with **Smart App Control** in *On* mode, Windows blocks **unsigned `.dll` binaries** loaded by signed host processes (`obs64.exe` is signed by OBS Project), even if the user clicked through an installer prompt — or blocks the unsigned installer outright with **no "Run anyway" button**.
   - Therefore, if code signing is adopted, **sign the `.dll` binaries inside each plugin package (`midi-fadester.dll`, `visual-sidechain.dll`, `obs-playlister.dll`) first**, and then sign the standalone `.exe` installers and the combined `.exe` installer/bundle with RFC 3161 SHA-256 timestamping (`signtool sign /fd SHA256 /tr <tsa-url> /td SHA256`).
3. **Signing certificate options and SmartScreen reputation:**
   - Since industry CA changes in 2023–2024, private keys for standard OV and EV Authenticode certificates must be stored on FIPS 140-2 Level 2+ hardware tokens/HSMs (not exportable `.pfx` files in GitHub Secrets), **or** signed via a cloud HSM service such as **Azure Artifact Signing** (formerly Azure Trusted Signing), DigiCert KeyLocker, or SSL.com eSigner from GitHub Actions OIDC.
   - Note that standard OV certificates no longer grant instant SmartScreen bypass on first release and build reputation per certificate/hash over downloads; cloud-managed services such as Azure Artifact Signing have specific publisher/region eligibility rules.

---

## 5. What was verified vs what was not verified

### Verified directly in these four repositories
- Exact Inno Setup `.iss.in` scripts, `DefaultDirName` (`{commonappdata}\obs-studio\plugins\<name>`), `DisableDirPage=yes`, and `buildspec.json` `windowsApp` GUIDs across `midi-fadester`, `visual-sidechain`, and `obs-playlister`.
- Absence of any signing step in `.github/workflows/` across `midi-fadester`, `visual-sidechain`, and `obs-playlister` (`SD/PUBLISHING.md:13`).
- `Fadester Companion` already ships separately on the Microsoft Store (`9PN7D3P2X7F4`, Store-signed MSIX) and as an unsigned standalone ZIP (`tourbox/README.md`), and `Fadester for OBS` ships as a `.streamDeckPlugin` archive (`SD/PUBLISHING.md`).

### Not verified (requires owner investigation and decision)
- Current pricing, individual vs legal-entity eligibility, and country availability for **Azure Artifact Signing**, **SSL.com / DigiCert / Sectigo** OV/EV HSM signing, or **SignPath Foundation** open-source signing (because these are GPL-2.0-or-later open-source repositories).
- Live Windows 11 Smart App Control behavior with the current unsigned `.dll` builds on a fresh SAC-enabled Windows 11 install.
- Which repository should own the combined installer release workflow (`jbrick2070/streamdeck-fadester` vs a dedicated release repo pulling pinned GitHub Release assets + SHA-256 checksums from `midi-fadester`, `visual-sidechain`, and `obs-playlister`).

---

## 6. Owner decisions needed before implementation

1. **Proceed with a combined Windows OBS plugin installer?** (`Option B: WiX Burn chaining the three standalone Inno installers` is recommended over `Option A` if built, because it preserves each plugin's existing `AppId`, version number, and standalone upgrade/uninstall behavior cleanly; `Option C` keeps standalone installers only.)
2. **Which repository hosts the combined installer build and GitHub Releases?**
3. **Code-signing path:** remain unsigned for now, apply for open-source signing (for example SignPath) or Azure Artifact Signing, or use an HSM-backed OV/EV certificate — signing `.dll` binaries as well as `.exe` installers.
